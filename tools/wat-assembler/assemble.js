// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 DevBlanket AB

/**
 * Handwritten binding for the WebAssembly-hosted WAT assembler.
 *
 * `wat-assembler.wasm` imports nothing, so this binding only instantiates
 * it, copies bytes in, and copies bytes out. It selects no behaviour and
 * transforms no source: that is the assembler's job and the WAT's.
 *
 * The build tools call `assembleWat` where they used to spawn `wat2wasm`,
 * so `deno task wasm` needs no toolchain on `PATH` and no `--allow-run`.
 * Output is byte-identical to `wat2wasm --enable-threads`; see
 * `docs/legal/wat-assembler.md` for the provenance and the build procedure.
 */

const ASSEMBLER_URL = new URL('./wat-assembler.wasm', import.meta.url);

let exports = null;

async function assembler() {
  if (exports === null) {
    const bytes = await Deno.readFile(ASSEMBLER_URL);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    exports = instance.exports;
  }
  return exports;
}

/**
 * Assemble WAT text into a WebAssembly module.
 *
 * @param {string} source WAT text, already assembled from its components.
 * @param {string} label Name used in the failure message.
 * @returns {Promise<Uint8Array>} The encoded module.
 */
export async function assembleWat(source, label) {
  const wasm = await assembler();
  const input = new TextEncoder().encode(source);

  const inputPointer = wasm.assembler_input_reserve(input.length);
  new Uint8Array(wasm.memory.buffer, inputPointer, input.length).set(input);

  const failed = wasm.assembler_assemble() !== 0;
  const resultPointer = wasm.assembler_result_ptr();
  const resultLength = wasm.assembler_result_len();
  const result = new Uint8Array(
    wasm.memory.buffer.slice(resultPointer, resultPointer + resultLength),
  );

  if (failed) {
    throw new Error(`WAT assembly failed for ${label}:\n${new TextDecoder().decode(result)}`);
  }

  // The `wat` crate encodes without validating, while `wat2wasm` refused an
  // invalid module. Compile the result with the engine that will run it, so
  // a type or structure error still stops the build instead of reaching a
  // test as a confusing instantiation failure.
  try {
    await WebAssembly.compile(result);
  } catch (error) {
    throw new Error(`WAT assembly produced an invalid module for ${label}:\n${error.message}`);
  }
  return result;
}

/**
 * Assemble WAT text and write the module beside its source.
 *
 * @param {string} source WAT text.
 * @param {string} label Name used in the failure message.
 * @param {string} wasmPath Destination for the encoded module.
 * @returns {Promise<Uint8Array>} The bytes that were written.
 */
export async function assembleWatToFile(source, label, wasmPath) {
  const module = await assembleWat(source, label);
  await Deno.writeFile(wasmPath, module);
  return module;
}
