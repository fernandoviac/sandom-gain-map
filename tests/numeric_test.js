import {
  allocate,
  assert,
  assertNear,
  copyIn,
  imageRecord,
  instantiate,
} from "./helpers.js";

const log2 = Math.log2;
const offset = 1 / 64;

Deno.test("generation preserves full extrema, odd-edge boxes, quantization, and constant ranges", async () => {
  const instance = await instantiate();
  const { exports } = instance;
  const width = 3;
  const height = 3;
  const basePixels = new Float32Array(width * height * 4);
  const alternatePixels = new Float32Array(width * height * 4);
  const values = [
    [0, 0, 0],
    [0.25, 0.5, 1],
    [1, 0.25, 0.5],
    [0.5, 1, 0.25],
    [2, 0.75, 0.125],
    [0.125, 2, 0.75],
    [0.75, 0.125, 2],
    [4, 1.5, 0.375],
    [0.375, 4, 1.5],
  ];
  for (let index = 0; index < values.length; index++) {
    basePixels[index * 4 + 3] = 1;
    alternatePixels.set([...values[index], 1], index * 4);
  }
  const baseData = copyIn(instance, basePixels);
  const alternateData = copyIn(instance, alternatePixels);
  const base = imageRecord(instance, {
    data: baseData,
    length: basePixels.byteLength,
    width,
    height,
    rowStride: width * 16,
    sample: 2,
    layout: 1,
    flags: 3,
  });
  const alternate = imageRecord(instance, {
    data: alternateData,
    length: alternatePixels.byteLength,
    width,
    height,
    rowStride: width * 16,
    sample: 2,
    layout: 1,
    flags: 2,
  });
  const options = allocate(instance, 104);
  assert(exports.gain_map_options_init(options) === 0);
  new DataView(exports.memory.buffer).setUint32(options, 2, true);
  const gainData = allocate(instance, 2 * 2 * 3 * 4);
  const gain = imageRecord(instance, {
    data: gainData,
    length: 48,
    width: 0,
    height: 0,
    rowStride: 0,
    sample: 2,
    layout: 0,
    flags: 2,
  });
  const metadata = allocate(instance, 152);
  assert(
    exports.gain_map_generate(base, alternate, options, gain, metadata) === 0,
    `generate error ${exports.gain_map_error_code()}/${exports.gain_map_error_field()}`,
  );

  const view = new DataView(exports.memory.buffer);
  assert(
    view.getUint32(gain + 8, true) === 2 &&
      view.getUint32(gain + 12, true) === 2,
    "ceiling-sized reduced dimensions",
  );
  for (let channel = 0; channel < 3; channel++) {
    const logs = values.map((pixel) =>
      log2((pixel[channel] + offset) / offset)
    );
    assertNear(
      view.getFloat64(metadata + channel * 8, true),
      Math.min(...logs),
      2e-12,
      `minimum ${channel}`,
    );
    assertNear(
      view.getFloat64(metadata + 24 + channel * 8, true),
      Math.max(...logs),
      2e-12,
      `maximum ${channel}`,
    );
  }

  const actual = new Float32Array(exports.memory.buffer, gainData, 12);
  const expected = new Float32Array(12);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const members = [];
      for (let y = ty * 2; y < Math.min(height, (ty + 1) * 2); y++) {
        for (let x = tx * 2; x < Math.min(width, (tx + 1) * 2); x++) {
          members.push(y * width + x);
        }
      }
      for (let channel = 0; channel < 3; channel++) {
        const logs = values.map((pixel) =>
          log2((pixel[channel] + offset) / offset)
        );
        const min = Math.min(...logs);
        const range = Math.max(...logs) - min;
        let sum = Math.fround(0);
        for (const index of members) {
          const normalized = range === 0
            ? 0
            : Math.max(0, Math.min(1, (logs[index] - min) / range));
          const stored = Math.fround(normalized);
          sum = Math.fround(sum + stored / members.length);
        }
        expected[(ty * 2 + tx) * 3 + channel] = Math.fround(
          Math.floor(sum * 255 + 0.5) / 255,
        );
      }
    }
  }
  actual.forEach((value, index) =>
    assertNear(value, expected[index], 1e-7, `reduced recovery ${index}`)
  );
});

Deno.test("constant channel ranges reconstruct at display-headroom boundaries", async () => {
  const instance = await instantiate();
  const { exports } = instance;
  const basePixels = new Uint8Array([0, 0, 0, 255]);
  const alternatePixels = new Float32Array([1, 2, 3, 1]);
  const base = imageRecord(instance, {
    data: copyIn(instance, basePixels),
    length: 4,
    width: 1,
    height: 1,
    rowStride: 4,
    sample: 0,
    layout: 1,
    flags: 3,
  });
  const alternate = imageRecord(instance, {
    data: copyIn(instance, alternatePixels),
    length: 16,
    width: 1,
    height: 1,
    rowStride: 16,
    sample: 2,
    layout: 1,
    flags: 2,
  });
  const floatBasePixels = new Float32Array([0, 0, 0, 1]);
  const floatBase = imageRecord(instance, {
    data: copyIn(instance, floatBasePixels),
    length: 16,
    width: 1,
    height: 1,
    rowStride: 16,
    sample: 2,
    layout: 1,
    flags: 3,
  });
  const options = allocate(instance, 104);
  assert(exports.gain_map_options_init(options) === 0);
  const gainData = allocate(instance, 12);
  const gain = imageRecord(instance, {
    data: gainData,
    length: 12,
    width: 0,
    height: 0,
    rowStride: 0,
    sample: 2,
    layout: 0,
    flags: 2,
  });
  const metadata = allocate(instance, 152);
  assert(
    exports.gain_map_generate(floatBase, alternate, options, gain, metadata) ===
      0,
  );
  const recovery = new Float32Array(exports.memory.buffer, gainData, 3);
  recovery.forEach((value, channel) =>
    assert(value === 0, `constant range recovery ${channel}`)
  );

  const outputData = allocate(instance, 16);
  const output = imageRecord(instance, {
    data: outputData,
    length: 16,
    width: 0,
    height: 0,
    rowStride: 0,
    sample: 2,
    layout: 1,
    flags: 2,
  });
  assert(exports.gain_map_reconstruct(base, gain, metadata, 1, output) === 0);
  new Float32Array(exports.memory.buffer, outputData, 3).forEach((
    value,
    channel,
  ) => assertNear(value, 0, 1e-7, `minimum-headroom channel ${channel}`));
  const maxHeadroom = new DataView(exports.memory.buffer).getFloat64(
    metadata + 128,
    true,
  );
  assert(
    exports.gain_map_reconstruct(
      base,
      gain,
      metadata,
      2 ** maxHeadroom,
      output,
    ) === 0,
  );
  new Float32Array(exports.memory.buffer, outputData, 3).forEach((
    value,
    channel,
  ) =>
    assertNear(
      value,
      alternatePixels[channel],
      2e-5,
      `maximum-headroom channel ${channel}`,
    )
  );
  const generationSummary = allocate(instance, 40);
  assert(
    exports.gain_map_measure_generation_error(
      floatBase,
      alternate,
      gain,
      metadata,
      2 ** maxHeadroom,
      generationSummary,
    ) === 0,
    `generation measurement error ${exports.gain_map_error_code()}/${exports.gain_map_error_field()}`,
  );
  assertNear(
    new DataView(exports.memory.buffer).getFloat64(generationSummary, true),
    0,
    2e-5,
    "constant-range generation error",
  );
});
