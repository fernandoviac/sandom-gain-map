# @sandom/gain-map

`@sandom/gain-map` is a pure-WebAssembly adaptive HDR gain-map library. It owns
SDR-base preparation, gain generation and reconstruction, deterministic
reduction, numeric error facts, adaptive-record validation, ISO 21496-1, Ultra
HDR v1 XMP, bounded JPEG/MPF inspection, APP/MPF framing, and package assembly
around caller-supplied JPEG codestreams.

Two consumption forms, one artifact. An ESM consumer fetches the binary from an
immutable published library set —
`https://cdn.urania-libs.com/set/<set-hash>/sandom-gain-map/dist/gain-map.wasm`,
where `<set-hash>` names one reviewed set whose bytes never change. An npm
consumer imports `@sandom/gain-map/gain-map.wasm`. Both resolve the same
byte-identical `dist/gain-map.wasm`.

Repository source and Deno configuration import the stable Urania Libraries
prefix and resolve it through an import map, per the programme's import-map
specification. That prefix is an internal identity, not a public address: the
CDN set is the address.

## Artifacts

`@sandom/gain-map/gain-map.wasm` resolves to `dist/gain-map.wasm`; there is no
runtime loader. The npm file set also contains the reproducible
`dist/gain-map.wat`, `dist/gain-map.build.json`, maintained `src/*.watpart`,
`src/gain-map.manifest.json`, and contract documents for audit and composition.

Production source is maintained `.wat`/`.watpart` only. There is no production
JavaScript, TypeScript, declaration file, native source, generated source logic,
runtime wrapper, or compatibility alias. Repository JavaScript is build/test
tooling and is excluded from the package.

The module has private memory and exactly two imports:

```javascript
const imports = {
  gain_map: {
    jpeg_encode(requestPointer) {
      // Decode the 48-byte request in instance.exports.memory, encode one
      // complete RGBA image, write into its declared output span, set length,
      // and return zero. No per-pixel callback occurs.
      return 0;
    },
    jpeg_decode(requestPointer) {
      // Decode one complete JPEG into the declared output image span.
      return 0;
    },
  },
};
const response = await fetch(
  "https://cdn.urania-libs.com/set/<set-hash>/sandom-gain-map/dist/gain-map.wasm",
);
const { instance } = await WebAssembly.instantiate(
  await response.arrayBuffer(),
  imports,
);
if (
  instance.exports.gain_map_init() !== 0 ||
  instance.exports.gain_map_abi_version() !== 1
) {
  throw new Error("unsupported @sandom/gain-map ABI");
}
```

The same `WebAssembly.instantiate` call works in a browser after obtaining the
bytes with `fetch`. The imports are required by the frozen module shape, but
callers that already own JPEG codecs can use `gain_map_package` and
`gain_map_inspect` directly with complete codestream spans; metadata and package
work never invokes a codec.

## Numeric profile

The release profile uses an opaque f32 linear-Rec.2020 D65 render at 203 cd/m²
reference white, an encoded-sRGB SDR JPEG base, and one f32/8-bit RGB gain map.
`gain_map_prepare_base` composes `@sandom/color` 0.3.0 in the same module for
the BT.2390, CSS Color 4 gamut-map, matrix, and transfer work. Generation uses
per-channel complete-image gain extrema, positive default offsets of 1/64, gamma
1, explicit scale 1/2/4/8, one eight-bit recovery quantization, and f64 metadata
arithmetic. Reconstruction uses centered bilinear recovery and display headroom
independent of the gain extrema.

ISO metadata is authoritative. Packages write ISO 21496-1 and Ultra HDR v1 for
the same map, with XMP produced from the round-tripped ISO rationals. Inspection
accepts ISO-only, Ultra-HDR-only, and dual packages, prefers ISO in dual
packages, and rejects contradictions. Ordinary JPEG/MPF and unsupported legacy
Apple gain-map forms remain ordinary instead of being misclassified.

JPEG entropy coding is intentionally not implemented here. The caller supplies
its chosen codec through two coarse synchronous imports or supplies complete
base/gain JPEG codestreams to the package operation.

## Contract and build

See [the ABI](docs/abi.md), [composition contract](docs/composition.md), and
[design](DESIGN.md). The source manifest pins the accepted `@sandom/color`
component and digest. WAT is assembled in process by `tools/wat-assembler`, so
no WABT on `PATH` is required; see
[the assembler provenance](docs/legal/wat-assembler.md).

```sh
deno task build
deno task test
deno task test:browser
deno task package:check
deno task build:check
```

The build writes deterministic WAT, WASM, and a digest record. Tests instantiate
the WASM directly in Deno and a browser, compare independent numeric/metadata
vectors, inspect maintained external JPEG fixtures, exercise caller-supplied
codestream packaging, and reject a malformed corpus without traps.
