export function assert(condition, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

export function assertNear(actual, expected, tolerance, message) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${message}: ${actual} not within ${tolerance} of ${expected}`,
    );
  }
}

export async function instantiate() {
  const bytes = await Deno.readFile(
    new URL("../dist/gain-map.wasm", import.meta.url),
  );
  let instance;
  const imports = {
    gain_map: {
      jpeg_encode(request) {
        const view = new DataView(instance.exports.memory.buffer);
        view.setUint32(request + 40, 0, true);
        return 0;
      },
      jpeg_decode(request) {
        const view = new DataView(instance.exports.memory.buffer);
        view.setUint32(request + 40, 0, true);
        return 0;
      },
    },
  };
  ({ instance } = await WebAssembly.instantiate(bytes, imports));
  assert(instance.exports.gain_map_init() === 0, "initialization");
  assert(instance.exports.gain_map_abi_version() === 1, "ABI version");
  return instance;
}

export function allocate(instance, bytes) {
  const pointer = instance.exports.gain_map_alloc(bytes);
  assert(
    pointer !== 0,
    `allocate ${bytes}: error ${instance.exports.gain_map_error_code()}`,
  );
  return pointer;
}

export function copyIn(instance, source) {
  const bytes = source instanceof Uint8Array
    ? source
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const pointer = allocate(instance, bytes.byteLength);
  new Uint8Array(instance.exports.memory.buffer, pointer, bytes.byteLength).set(
    bytes,
  );
  return pointer;
}

export function imageRecord(instance, image) {
  const pointer = allocate(instance, 32);
  const view = new DataView(instance.exports.memory.buffer);
  view.setUint32(pointer, image.data, true);
  view.setUint32(pointer + 4, image.length, true);
  view.setUint32(pointer + 8, image.width, true);
  view.setUint32(pointer + 12, image.height, true);
  view.setUint32(pointer + 16, image.rowStride, true);
  view.setUint32(pointer + 20, image.sample ?? 2, true);
  view.setUint32(pointer + 24, image.layout ?? 1, true);
  view.setUint32(pointer + 28, image.flags ?? 0, true);
  return pointer;
}

export function bytesAt(instance, pointer, length) {
  return new Uint8Array(instance.exports.memory.buffer, pointer, length)
    .slice();
}

export function hexBytes(text) {
  return Uint8Array.from(
    text.match(/../g) ?? [],
    (part) => Number.parseInt(part, 16),
  );
}

export function writeMetadata(instance, pointer, values) {
  const view = new DataView(instance.exports.memory.buffer);
  for (
    const [base, key] of [[0, "min"], [24, "max"], [48, "gamma"], [
      72,
      "baseOffset",
    ], [96, "alternateOffset"]]
  ) {
    values[key].forEach((value, channel) =>
      view.setFloat64(pointer + base + channel * 8, value, true)
    );
  }
  view.setFloat64(pointer + 120, values.headroomMin, true);
  view.setFloat64(pointer + 128, values.headroomMax, true);
  view.setUint32(pointer + 136, 1, true);
  view.setUint32(pointer + 140, 0, true);
  view.setUint32(pointer + 144, 3, true);
}

export function minimalJpeg(width, height) {
  return Uint8Array.of(
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x08,
    0x08,
    (height >>> 8) & 255,
    height & 255,
    (width >>> 8) & 255,
    width & 255,
    0x03,
    0xff,
    0xda,
    0x00,
    0x02,
    0xff,
    0xd9,
  );
}
