const root = new URL("../", import.meta.url);
const wasm = await Deno.readFile(new URL("dist/gain-map.wasm", root));
const imports = { gain_map: { jpeg_encode: () => 0, jpeg_decode: () => 0 } };
const deno = await WebAssembly.instantiate(wasm, imports);
if (
  deno.instance.exports.gain_map_init() !== 0 ||
  deno.instance.exports.gain_map_abi_version() !== 1
) {
  throw new Error("Deno direct instantiation failed");
}

let binary = "";
for (let offset = 0; offset < wasm.length; offset += 0x8000) {
  binary += String.fromCharCode(...wasm.subarray(offset, offset + 0x8000));
}
const encoded = btoa(binary);
const html =
  `<!doctype html><meta charset="utf-8"><body>RUNNING<script type="module">
try {
  const text = ${JSON.stringify(encoded)};
  const raw = atob(text);
  const bytes = Uint8Array.from(raw, value => value.charCodeAt(0));
  const imports = { gain_map: { jpeg_encode: () => 0, jpeg_decode: () => 0 } };
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  const status = instance.exports.gain_map_init();
  document.body.textContent = status === 0 && instance.exports.gain_map_abi_version() === 1 ? "GAIN_MAP_BROWSER_PASS" : "GAIN_MAP_BROWSER_FAIL";
} catch (error) {
  document.body.textContent = "GAIN_MAP_BROWSER_FAIL " + error;
}
</script>`;
const directory = await Deno.makeTempDir({
  prefix: "sandom-gain-map-browser-",
});
try {
  const page = `${directory}/index.html`;
  await Deno.writeTextFile(page, html);
  const configured = Deno.env.get("BROWSER_BIN");
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  let browser = null;
  for (const candidate of candidates) {
    try {
      const info = await Deno.stat(candidate);
      if (info.isFile) {
        browser = candidate;
        break;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  if (browser === null) {
    throw new Error("No Chrome/Chromium binary; set BROWSER_BIN");
  }
  const run = await new Deno.Command(browser, {
    args: [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--allow-file-access-from-files",
      "--virtual-time-budget=5000",
      "--dump-dom",
      `file://${page}`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const output = new TextDecoder().decode(run.stdout);
  if (!run.success || !output.includes("GAIN_MAP_BROWSER_PASS")) {
    throw new Error(
      `Browser direct instantiation failed: ${
        new TextDecoder().decode(run.stderr)
      }\n${output}`,
    );
  }
  console.log(
    JSON.stringify({ deno: "pass", browser: "pass", executable: browser }),
  );
} finally {
  await Deno.remove(directory, { recursive: true });
}
