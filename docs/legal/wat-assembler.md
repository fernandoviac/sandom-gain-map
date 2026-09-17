# Vendored WAT assembler

`tools/wat-assembler/wat-assembler.wasm` is the WebAssembly-hosted assembler
that the build uses instead of a native `wat2wasm`. This record holds its
origin, version, modifications, and build procedure. The machine-readable form
is
[`tools/wat-assembler/identity.json`](../../tools/wat-assembler/identity.json).

The assembler is build tooling. `package.json` lists the published files
explicitly and `tools/` is not among them, and `tools/check-package.js`
enumerates the permitted archive entries and rejects any other, so no npm
artifact carries it; only the `dist/gain-map.wasm` it produces is published.

## Origin and version

The wrapper around the crate is programme-authored (Apache-2.0, Copyright 2026
DevBlanket AB). This repository vendors the built artifact only; the wrapper
source and the `Cargo.lock` that pins its dependencies live in the SandScript
repository. The wrapper compiles against the Bytecode Alliance `wat` crate,
which performs the parsing and encoding:

| Crate           | Version | License                                             |
| --------------- | ------- | --------------------------------------------------- |
| `wat`           | 1.259.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `wast`          | 259.0.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `wasm-encoder`  | 0.259.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| `bumpalo`       | 3.20.3  | MIT OR Apache-2.0                                   |
| `leb128fmt`     | 0.1.0   | MIT OR Apache-2.0                                   |
| `memchr`        | 2.8.3   | Unlicense OR MIT                                    |
| `unicode-width` | 0.2.2   | MIT OR Apache-2.0                                   |

That is the complete linked closure; the `Cargo.lock` in SandScript pins it
exactly. Upstream source: <https://github.com/bytecodealliance/wasm-tools>.
This repository elects Apache-2.0 for every dual-licensed crate, whose text is
at [`LICENSE`](../../LICENSE).

The same artifact is vendored in SandScript, which adopted it first. Every copy
shares
`sha256
af95dc1c00b4710f887df1780360ea4ab88c3698d391a61b4bb08685d28b68a3`.

## Modifications

No upstream crate is patched. The wrapper adds two mechanical behaviours:

- a four-call host protocol (`assembler_input_reserve`, `assembler_assemble`,
  `assembler_result_ptr`, `assembler_result_len`);
- removal of the `name` custom section, which the `wat` crate always emits and
  `wat2wasm` omits. Every other section, custom sections included, is copied
  verbatim.

The assembler artifact imports nothing, so `tools/wat-assembler/assemble.js`
only instantiates it and copies bytes across the boundary. The binding adds one
mechanical step: the `wat` crate encodes without validating, while `wat2wasm`
refused an invalid module, so the binding compiles each result with
`WebAssembly.compile` — the engine that will run it — and reports a failure
there as a build error.

One consequence is worth recording: the `wat` crate enables every WebAssembly
proposal, while the build previously called `wat2wasm` with no `--enable-*`
flag. The maintained source is unaffected, but a future component using a
post-MVP feature would now assemble where it used to be refused.

The build also spawned `wasm-validate` on the module `wat2wasm` had just
written. Its only purpose was validating that output, which
`WebAssembly.compile` now does on the same bytes, so the second spawn was
removed rather than reproduced. `dist/gain-map.build.json` records the engine in
its `validator` field.

## Build procedure

This repository vendors `tools/wat-assembler/wat-assembler.wasm` and does not
build it. The rebuild procedure, the pinned container, and the Apache-2.0
wrapper source live in the SandScript repository.

A version bump arrives here as a new vendored binary: its digest must match
`identity.json`, and `deno task build:check` must then show the generated
artifacts unchanged. A changed binary byte means the encoder changed, not the
source.

## Encoder equivalence

Checked 2026-09-16 against the committed artifact that `wat2wasm` 1.0.39
produced. The assembler reproduces `dist/gain-map.wasm` (46,952 bytes, the
aggregate of five repository components and the two `@sandom/color` embeddable
components) byte for byte, so the cutover re-baselined nothing.
`dist/gain-map.wat` and every digest in `dist/gain-map.build.json` are
unchanged; only that record's `compiler` and `validator` fields now name the
assembler and the engine.

No source change was required. The repository contains no explicitly written
empty `else` branch, the one form on which the `wat` crate and `wat2wasm`
encodings diverge.

`deno task build:check` reassembles and compares all three generated artifacts,
so the equivalence is asserted rather than remembered. Before the cutover that
check needed `wat2wasm` and `wasm-validate` 1.0.39 on `PATH` and failed outright
without them.
