import { assert, instantiate } from "./helpers.js";

Deno.test("each error code has its text and an unknown code has the unknown text", async () => {
  const { exports } = await instantiate();
  const text = (code) => {
    const pointer = exports.gain_map_error_text(code);
    return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, exports.gain_map_error_text_length()));
  };
  assert(text(0) === "success", text(0));
  assert(text(exports.gain_map_error_numeric.value) === "numeric value", text(exports.gain_map_error_numeric.value));
  assert(text(exports.gain_map_error_mpf.value) === "MPF entry offset or length is invalid", text(exports.gain_map_error_mpf.value));
  assert(text(exports.gain_map_error_unsupported.value) === "unsupported feature", text(exports.gain_map_error_unsupported.value));
  assert(text(exports.gain_map_error_unsupported.value + 1) === "unknown error", "one past the last code");
  assert(text(-1) === "unknown error", "a negative code");
});

Deno.test("the gain map extent is the image extent divided by the scale, rounded up", async () => {
  const { exports } = await instantiate();
  assert(exports.gain_map_map_extent(7, 1) === 7, "scale 1");
  assert(exports.gain_map_map_extent(7, 2) === 4, "7 / 2 rounds up");
  assert(exports.gain_map_map_extent(8, 4) === 2, "8 / 4");
  assert(exports.gain_map_map_extent(9, 8) === 2, "9 / 8 rounds up");
  assert(exports.gain_map_map_extent(9, 3) === 0, "scale 3 is no scale");
});

Deno.test("eight-bit quantization clamps, rounds half up and makes alpha opaque; dequantization divides by 255", async () => {
  const { exports } = await instantiate();
  const source = exports.gain_map_alloc(6 * 4);
  const target = exports.gain_map_alloc(8);
  new Float32Array(exports.memory.buffer, source, 6).set([-0.5, 0.5 / 255, 2, 1 / 255, Number.NaN, 0.5]);
  assert(exports.gain_map_quantize_rgba8(source, 2, 3, target) === 0, "RGB quantization succeeds");
  const bytes = Array.from(new Uint8Array(exports.memory.buffer, target, 8));
  assert(bytes.join() === "0,1,255,255,1,0,128,255", `quantized ${bytes}`);
  assert(exports.gain_map_quantize_rgba8(source, 1, 2, target) !== 0, "two channels are no layout");
  const floats = exports.gain_map_alloc(2 * 12);
  assert(exports.gain_map_dequantize_rgb(target, 2, floats) === 0, "dequantization succeeds");
  const values = Array.from(new Float32Array(exports.memory.buffer, floats, 6));
  const expected = [0, 1, 255, 1, 0, 128].map((byte) => Math.fround(byte / 255));
  assert(values.join() === expected.join(), `dequantized ${values}`);
});
