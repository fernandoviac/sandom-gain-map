import { assembleWat } from "./wat-assembler/assemble.js";

const root = new URL("../", import.meta.url);
const sourceDirectory = new URL("src/", root);
const distDirectory = new URL("dist/", root);
const manifestUrl = new URL("gain-map.manifest.json", sourceDirectory);
const importMapUrl = new URL("import-map.json", root);
const check = Deno.args.length === 1 && Deno.args[0] === "--check";
if ((!check && Deno.args.length !== 0) || Deno.args.length > 1) {
  throw new Error(
    "Usage: deno run --allow-read --allow-write tools/build-wasm.js [--check]",
  );
}

const encoder = new TextEncoder();
const hex = (bytes) =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
const digest = async (value) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? encoder.encode(value) : value,
      ),
    ),
  );
const exists = async (url) => {
  try {
    await Deno.stat(url);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
};

// The build record names the encoder that produced the binary. The vendored
// assembler carries its own identity, so the record follows a version bump
// instead of restating one.
const assemblerVersion = JSON.parse(
  await Deno.readTextFile(
    new URL("wat-assembler/identity.json", import.meta.url),
  ),
).dependencies.find(({ name }) => name === "wat").version;

const manifestText = await Deno.readTextFile(manifestUrl);
const manifest = JSON.parse(manifestText);
if (
  manifest?.kind !== "sandom/webassembly-source-manifest" ||
  manifest.version !== 1 || manifest.module !== "gain-map" ||
  manifest.colorDependency?.specifier !==
    "https://cdn.urania-libs.com/set/ba4d1b20b3a0b4eb/sandom-color/" ||
  !Array.isArray(manifest.components) || manifest.components.length < 3
) {
  throw new Error("Invalid gain-map WebAssembly source manifest");
}

const importMap = JSON.parse(await Deno.readTextFile(importMapUrl));
const libraryPrefix = "https://cdn.urania-libs.com/set/ba4d1b20b3a0b4eb/";
const localLibraryRoot = importMap?.imports?.[libraryPrefix];
if (typeof localLibraryRoot !== "string") {
  throw new Error("import-map.json must map the programme library prefix");
}
const colorSpecifier = manifest.colorDependency.specifier;
if (!colorSpecifier.startsWith(libraryPrefix)) {
  throw new Error("Color dependency must use the programme library prefix");
}
const colorRoot = new URL(
  colorSpecifier.replace(libraryPrefix, localLibraryRoot),
  importMapUrl,
);
if (!(await exists(new URL("package.json", colorRoot)))) {
  throw new Error(
    `@sandom/color ${manifest.colorDependency.version} is missing from the local programme import map`,
  );
}
const colorPackage = JSON.parse(
  await Deno.readTextFile(new URL("package.json", colorRoot)),
);
const colorManifest = JSON.parse(
  await Deno.readTextFile(
    new URL(manifest.colorDependency.manifest, colorRoot),
  ),
);
if (
  colorPackage.name !== "@sandom/color" ||
  colorPackage.version !== manifest.colorDependency.version ||
  colorManifest?.kind !== "sandom/webassembly-source-manifest" ||
  colorManifest.module !== "color" ||
  JSON.stringify(colorManifest.embeddable?.components) !==
    JSON.stringify(manifest.colorDependency.components) ||
  colorManifest.embeddable.scratchBytes !== 9728 ||
  JSON.stringify(colorManifest.embeddable.requires) !==
    JSON.stringify(["memory", "$COLOR_BASE"])
) {
  throw new Error(
    "Resolved @sandom/color does not satisfy the frozen embeddable contract",
  );
}
const colorSentinel = "@sandom/color:embeddable";
const expandedComponents = manifest.components.flatMap((component) =>
  component === colorSentinel
    ? manifest.colorDependency.components.map((name) => ({
      component: `${colorSpecifier}src/${name}`,
      color: name,
    }))
    : [{ component, color: null }]
);

const componentRecords = [];
const componentTexts = [];
const seen = new Set();
for (const { component, color } of expandedComponents) {
  if (
    typeof component !== "string" || component.includes("..") ||
    seen.has(component)
  ) {
    throw new Error(
      `Invalid or duplicate gain-map component ${JSON.stringify(component)}`,
    );
  }
  seen.add(component);
  let url;
  let identity;
  if (color !== null) {
    url = new URL(`src/${color}`, colorRoot);
    identity = component;
  } else {
    url = new URL(component, sourceDirectory);
    identity = `src/${component}`;
  }
  const text = await Deno.readTextFile(url);
  const componentDigest = await digest(text);
  if (
    color !== null &&
    componentDigest !== manifest.colorDependency.sourceDigests[color]
  ) {
    throw new Error(`@sandom/color ${color} digest changed: ${componentDigest}`);
  }
  componentRecords.push({ path: identity, digest: componentDigest });
  componentTexts.push(text.endsWith("\n") ? text : `${text}\n`);
}
const aggregate = `(module\n${componentTexts.join("")}\n)\n`;
const sourceDigest = await digest(JSON.stringify({
  manifest: JSON.parse(manifestText),
  components: componentRecords,
}));
const aggregateDigest = await digest(aggregate);
// The wat crate encodes without validating, so the binding compiles every
// result with WebAssembly.compile. That is the validation the separate
// wasm-validate spawn used to perform, done by the engine that will run the
// module, so no second validator is needed.
const wasm = await assembleWat(aggregate, "gain-map.wat");
const binaryDigest = await digest(wasm);
const record = `${
  JSON.stringify(
    {
      kind: "sandom/gain-map-build",
      version: 1,
      compiler: `wat-assembler (wat ${assemblerVersion})`,
      validator: "WebAssembly.compile",
      colorPackage: { name: colorPackage.name, version: colorPackage.version },
      sourceDigest,
      aggregateDigest,
      binaryDigest,
      components: componentRecords,
    },
    null,
    2,
  )
}\n`;
const outputs = [
  [new URL("gain-map.wat", distDirectory), encoder.encode(aggregate)],
  [new URL("gain-map.wasm", distDirectory), wasm],
  [new URL("gain-map.build.json", distDirectory), encoder.encode(record)],
];
if (check) {
  for (const [url, expected] of outputs) {
    let actual;
    try {
      actual = await Deno.readFile(url);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(`Missing generated artifact ${url.pathname}`);
      }
      throw error;
    }
    if (
      actual.length !== expected.length ||
      actual.some((byte, index) => byte !== expected[index])
    ) {
      throw new Error(`Generated artifact is stale: ${url.pathname}`);
    }
  }
} else {
  await Deno.mkdir(distDirectory, { recursive: true });
  for (const [url, bytes] of outputs) await Deno.writeFile(url, bytes);
}
console.log(JSON.stringify({ sourceDigest, aggregateDigest, binaryDigest }));
