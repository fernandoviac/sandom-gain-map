const expected = new Set([
  "package.json",
  "README.md",
  "DESIGN.md",
  "LICENSE",
  "NOTICE",
  "dist/gain-map.wasm",
  "dist/gain-map.wat",
  "dist/gain-map.build.json",
  "src/gain-map.manifest.json",
  "src/gain-map-module.watpart",
  "src/gain-map-abi.watpart",
  "src/gain-map-core.watpart",
  "src/gain-map-metadata.watpart",
  "src/gain-map-jpeg.watpart",
  "docs/abi.md",
  "docs/composition.md",
  "docs/legal/wat-assembler.md",
]);

const result = await new Deno.Command("npm", {
  args: ["pack", "--dry-run", "--json", "--ignore-scripts"],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!result.success) {
  throw new Error(new TextDecoder().decode(result.stderr).trim());
}
const report = JSON.parse(new TextDecoder().decode(result.stdout));
const files = new Set(report[0]?.files?.map(({ path }) => path));
for (const path of expected) {
  if (!files.has(path)) throw new Error(`Package is missing ${path}`);
}
for (const path of files) {
  if (!expected.has(path)) {
    throw new Error(`Package contains unexpected ${path}`);
  }
}
for (const path of files) {
  if (/\.(?:js|mjs|cjs|ts|tsx|jsx|d\.ts|c|cc|cpp|h|hpp|rs)$/.test(path)) {
    throw new Error(`Package contains prohibited runtime source ${path}`);
  }
}
const packageJson = JSON.parse(
  await Deno.readTextFile(new URL("../package.json", import.meta.url)),
);
const expectedExports = {
  "./gain-map.wasm": "./dist/gain-map.wasm",
  "./gain-map.wat": "./dist/gain-map.wat",
  "./gain-map.build.json": "./dist/gain-map.build.json",
  "./gain-map.manifest.json": "./src/gain-map.manifest.json",
  "./watpart/*": "./src/*.watpart",
};
// Named subpaths, not a bare root export: a consumer asks for the file it
// wants by name, the way every sibling library is asked. A root export leaves
// `@sandom/gain-map/gain-map.wasm` unresolvable, which is how it reached a
// consumer's clean install as ERR_PACKAGE_PATH_NOT_EXPORTED.
if (
  JSON.stringify(packageJson.exports) !== JSON.stringify(expectedExports)
) {
  throw new Error(
    `Package exports must name each published file: ${
      JSON.stringify(expectedExports)
    }`,
  );
}
const wasm = await Deno.readFile(
  new URL("../dist/gain-map.wasm", import.meta.url),
);
const module = new WebAssembly.Module(wasm);
const imports = WebAssembly.Module.imports(module).map((
  { module, name, kind },
) => ({ module, name, kind }));
if (
  JSON.stringify(imports) !== JSON.stringify([
    { module: "gain_map", name: "jpeg_encode", kind: "function" },
    { module: "gain_map", name: "jpeg_decode", kind: "function" },
  ])
) throw new Error(`Unexpected import surface: ${JSON.stringify(imports)}`);
console.log(
  JSON.stringify({
    kind: "sandom/gain-map-package-check",
    files: files.size,
    imports,
  }),
);
