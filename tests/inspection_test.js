import { allocate, assert, copyIn, hexBytes, instantiate } from "./helpers.js";

Deno.test("malformed metadata and JPEG corpus returns stable errors without traps", async () => {
  const corpus = JSON.parse(
    await Deno.readTextFile(
      new URL("fixtures/malformed.json", import.meta.url),
    ),
  );
  const instance = await instantiate();
  const { exports } = instance;
  const metadata = allocate(instance, 152);
  const dimensions = allocate(instance, 16);
  for (const vector of corpus.iso) {
    const bytes = hexBytes(vector.hex);
    const pointer = bytes.length === 0
      ? allocate(instance, 1)
      : copyIn(instance, bytes);
    const status = exports.gain_map_iso_decode(pointer, bytes.length, metadata);
    assert(
      status === vector.error && exports.gain_map_error_code() === vector.error,
      `${vector.name}: ISO status ${status}/${exports.gain_map_error_code()}, expected ${vector.error}`,
    );
  }
  for (const vector of corpus.jpeg) {
    const bytes = hexBytes(vector.hex);
    const pointer = bytes.length === 0
      ? allocate(instance, 1)
      : copyIn(instance, bytes);
    const status = exports.gain_map_jpeg_dimensions(
      pointer,
      bytes.length,
      0,
      dimensions,
    );
    assert(
      status === vector.error && exports.gain_map_error_code() === vector.error,
      `${vector.name}: JPEG status ${status}/${exports.gain_map_error_code()}, expected ${vector.error}`,
    );
  }
});

Deno.test("maintained independent JPEG fixtures preserve adaptive classification", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(new URL("fixtures/fixtures.json", import.meta.url)),
  );
  const instance = await instantiate();
  const { exports } = instance;
  const inspection = allocate(instance, 64);
  const metadata = allocate(instance, 152);
  for (const fixture of manifest.fixtures) {
    const bytes = await Deno.readFile(
      new URL(`fixtures/${fixture.file}`, import.meta.url),
    );
    const pointer = copyIn(instance, bytes);
    const status = exports.gain_map_inspect(
      pointer,
      bytes.length,
      inspection,
      metadata,
    );
    assert(
      status === 0,
      `${fixture.file}: inspect ${status}/${exports.gain_map_error_code()} at ${exports.gain_map_error_field()}`,
    );
    const adaptive =
      new DataView(exports.memory.buffer).getUint32(inspection, true) === 1;
    const expectedAdaptive =
      fixture.expectedInterpretation.startsWith("ISO 21496-1") ||
      fixture.expectedInterpretation.startsWith("Ultra HDR");
    assert(
      adaptive === expectedAdaptive,
      `${fixture.file}: adaptive=${adaptive}, expected ${expectedAdaptive}`,
    );
    assert(
      exports.gain_map_free(pointer) === 0,
      `${fixture.file}: release input`,
    );
  }
});
