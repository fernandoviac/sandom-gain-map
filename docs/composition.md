# WAT composition

`src/gain-map.manifest.json` is the source-composition authority. Its ordered
components are:

1. `gain-map-module.watpart` — private memory, imports, error state, allocator;
2. `@sandom/color/color-kernel.watpart` — exact embeddable color kernel;
3. `gain-map-abi.watpart` — immutable ABI globals and lifetime records;
4. `gain-map-core.watpart` — preparation, generation, recovery, error facts;
5. `gain-map-metadata.watpart` — ISO and Ultra HDR metadata;
6. `gain-map-jpeg.watpart` — JPEG/MPF inspection and package assembly.

The build wraps these parts, unchanged and in order, in one `(module ...)`. It
does not generate WAT, rewrite symbols, or infer an embeddable component list.
The manifest composes the exact maintained `color-kernel.watpart`; it does not
copy a per-pixel implementation. The build resolves
`https://cdn.urania-libs.com/set/ba4d1b20b3a0b4eb/sandom-color/` through the repository
`import-map.json`. It verifies the color version, embeddable manifest fields,
the single color kernel component, its 9,728-byte scratch extent, required
`memory`/`$COLOR_BASE` symbols, and pinned source SHA-256
`49b194439527432abddda668ed36020aad2b5f8723a368c544eadbf2da7a72de`.

The containing module supplies private memory and `$COLOR_BASE = 0`. Bytes
0..9,727 belong to the composed color kernel. Static metadata text and internal
scratch occupy reserved bytes below 65,536. The gain-map allocator begins at
65,536. Neither component imports memory or calls a host per pixel.

The composed color component retains the export surface and semantics frozen by
`@sandom/color` 0.3.0: transfer functions, matrix/vector operations, tagged
conversion, Lab/OKLab, HLG/PQ, BT.2390, CSS Color 4 gamut mapping, CSS parsing,
and matrix reads. Those functions share the same private scratch and are
serialized with gain-map calls. Gain-map ABI versioning does not fork or retune
them. A future color-kernel digest or embeddable-contract change requires an
explicit gain-map manifest and ABI review.

`tools/build-wasm.js` assembles the composition in process with the vendored
`tools/wat-assembler`, so the build needs no WABT on `PATH`; see
[the assembler provenance](legal/wat-assembler.md). The binding compiles every
result with `WebAssembly.compile`, which is the validation a separate
`wasm-validate` spawn used to provide. The tool writes:

- `dist/gain-map.wat`, the exact wrapped composition;
- `dist/gain-map.wasm`, the validated module;
- `dist/gain-map.build.json`, assembler and validator identity, dependency
  identity, ordered component digests, aggregate digest, and binary digest.

`--check` reproduces all three in memory and rejects a missing or stale byte.
The npm publication output contains the maintained local WAT parts and manifest,
the composed WAT/WASM/build record, and documentation. It does not ship the
JavaScript build or test tools. Source consumers resolve the color component
through the Urania Libraries specifier and a reviewed import map; npm never
resolves programme source dependencies.
