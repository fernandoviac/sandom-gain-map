import {
  allocate,
  assert,
  assertNear,
  bytesAt,
  copyIn,
  hexBytes,
  instantiate,
  minimalJpeg,
  writeMetadata,
} from "./helpers.js";

const scalar = {
  min: [0, 0, 0],
  max: [2, 2, 2],
  gamma: [1, 1, 1],
  baseOffset: [1 / 64, 1 / 64, 1 / 64],
  alternateOffset: [1 / 64, 1 / 64, 1 / 64],
  headroomMin: 0,
  headroomMax: 2,
};
const expectedIso = hexBytes(
  "000000004000000000000f4240001e8480000f424000000000000f4240001e8480000f4240000f4240000f424000003d09000f424000003d09000f4240",
);
const expectedSecondaryXmp =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0" hdrgm:BaseRenditionIsHDR="False" hdrgm:GainMapMin="0" hdrgm:GainMapMax="2" hdrgm:Gamma="1" hdrgm:OffsetSDR="0.015625" hdrgm:OffsetHDR="0.015625" hdrgm:HDRCapacityMin="0" hdrgm:HDRCapacityMax="2"/></rdf:RDF></x:xmpmeta>';

Deno.test("ISO explicit and common denominators preserve the frozen record", async () => {
  const instance = await instantiate();
  const { exports } = instance;
  const metadata = allocate(instance, 152);
  writeMetadata(instance, metadata, scalar);
  assert(exports.gain_map_iso_encoded_size(metadata) === 61);
  const output = allocate(instance, 256);
  const length = exports.gain_map_iso_encode(metadata, output, 256);
  assert(length === expectedIso.length, `ISO length ${length}`);
  assert(
    bytesAt(instance, output, length).every((byte, index) =>
      byte === expectedIso[index]
    ),
    "ISO canonical bytes",
  );

  const decoded = allocate(instance, 152);
  assert(exports.gain_map_iso_decode(output, length, decoded) === 0);
  assert(
    exports.gain_map_metadata_equal(metadata, decoded) === 1,
    "ISO semantic round trip",
  );

  const common = new Uint8Array(5 + 4 + 7 * 4);
  const view = new DataView(common.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, 0);
  common[4] = 0x48;
  view.setUint32(5, 1_000_000);
  [0, 2_000_000, 0, 2_000_000, 1_000_000, 15_625, 15_625]
    .forEach((value, index) => view.setUint32(9 + index * 4, value));
  const commonPointer = copyIn(instance, common);
  assert(
    exports.gain_map_iso_decode(commonPointer, common.length, decoded) === 0,
    `common denominator error ${exports.gain_map_error_code()}`,
  );
  assertNear(
    new DataView(exports.memory.buffer).getFloat64(decoded + 128, true),
    2,
    0,
    "common headroom",
  );
});

Deno.test("Ultra HDR canonical scalar text decodes to the same reconstruction", async () => {
  const instance = await instantiate();
  const { exports } = instance;
  const metadata = allocate(instance, 152);
  writeMetadata(instance, metadata, scalar);
  const output = allocate(instance, 2048);
  const length = exports.gain_map_xmp_secondary_encode(metadata, output, 2048);
  const text = new TextDecoder().decode(bytesAt(instance, output, length));
  assert(text === expectedSecondaryXmp, `canonical XMP differs:\n${text}`);
  const decoded = allocate(instance, 152);
  const info = allocate(instance, 8);
  assert(exports.gain_map_xmp_decode(output, length, decoded, info) === 0);
  assert(
    new DataView(exports.memory.buffer).getUint32(info, true) === 2,
    "secondary XMP kind",
  );
  assert(
    exports.gain_map_metadata_equal(metadata, decoded) === 1,
    "XMP semantic round trip",
  );
});

Deno.test("caller-supplied codestreams assemble and inspect as one dual package", async () => {
  const instance = await instantiate();
  const { exports } = instance;
  const metadata = allocate(instance, 152);
  writeMetadata(instance, metadata, scalar);
  const baseBytes = minimalJpeg(8, 6);
  const gainBytes = minimalJpeg(4, 3);
  const base = copyIn(instance, baseBytes);
  const gain = copyIn(instance, gainBytes);
  const output = allocate(instance, 8192);
  const length = exports.gain_map_package(
    base,
    baseBytes.length,
    gain,
    gainBytes.length,
    metadata,
    output,
    8192,
  );
  assert(
    length > baseBytes.length + gainBytes.length,
    `package error ${exports.gain_map_error_code()}/${exports.gain_map_error_field()}`,
  );
  assert(
    bytesAt(instance, output, 2).every((byte, index) =>
      byte === baseBytes[index]
    ),
    "primary starts with SOI",
  );
  const inspection = allocate(instance, 64);
  const decoded = allocate(instance, 152);
  assert(
    exports.gain_map_inspect(output, length, inspection, decoded) === 0,
    `inspect error ${exports.gain_map_error_code()}/${exports.gain_map_error_field()}`,
  );
  const view = new DataView(exports.memory.buffer);
  assert(view.getUint32(inspection, true) === 1, "adaptive package");
  assert(view.getUint32(inspection + 4, true) === 3, "dual compatibility");
  assert(view.getUint32(inspection + 8, true) === 1, "ISO precedence");
  assert(
    view.getUint32(inspection + 20, true) === 8 &&
      view.getUint32(inspection + 24, true) === 6,
    "base dimensions",
  );
  assert(
    view.getUint32(inspection + 40, true) === 4 &&
      view.getUint32(inspection + 44, true) === 3,
    "map dimensions",
  );
  assert(
    exports.gain_map_metadata_equal(decoded, metadata) === 1,
    "package metadata",
  );
  const isoMetadata = allocate(instance, 152);
  const xmpMetadata = allocate(instance, 152);
  const presence = allocate(instance, 4);
  assert(
    exports.gain_map_inspect_profiles(
      output,
      length,
      inspection,
      decoded,
      isoMetadata,
      xmpMetadata,
      presence,
    ) === 0,
    `profile inspection error ${exports.gain_map_error_code()}/${exports.gain_map_error_field()}`,
  );
  assert(
    new DataView(exports.memory.buffer).getUint32(presence, true) === 3 &&
      exports.gain_map_metadata_equal(isoMetadata, xmpMetadata) === 1,
    "dual inspection preserves equal ISO and Ultra HDR records",
  );
  const malformed = bytesAt(instance, output, length).slice();
  const mpfSignature = malformed.findIndex((byte, index) =>
    byte === 0x4d && malformed[index + 1] === 0x50 &&
    malformed[index + 2] === 0x46 && malformed[index + 3] === 0
  );
  assert(mpfSignature >= 0, "MPF signature");
  const malformedView = new DataView(malformed.buffer);
  malformedView.setUint32(
    mpfSignature + 58,
    malformedView.getUint32(mpfSignature + 58, false) + 1,
    false,
  );
  const malformedPointer = copyIn(instance, malformed);
  assert(
    exports.gain_map_inspect(malformedPointer, malformed.length, inspection, decoded) === 18 &&
      exports.gain_map_error_code() === 18,
    "mismatched MPF primary length must reject",
  );
});
