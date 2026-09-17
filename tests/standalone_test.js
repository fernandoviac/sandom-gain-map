import { allocate, assert, instantiate } from "./helpers.js";

Deno.test("module has the frozen two-import surface and instantiates directly", async () => {
  const bytes = await Deno.readFile(
    new URL("../dist/gain-map.wasm", import.meta.url),
  );
  const module = new WebAssembly.Module(bytes);
  assert(
    JSON.stringify(WebAssembly.Module.imports(module)) === JSON.stringify([
      { module: "gain_map", name: "jpeg_encode", kind: "function" },
      { module: "gain_map", name: "jpeg_decode", kind: "function" },
    ]),
    "import surface",
  );
  const instance = await instantiate();
  assert(
    instance.exports.memory instanceof WebAssembly.Memory,
    "private exported memory",
  );
  assert(
    instance.exports.gain_map_image_size.value === 32,
    "image record global",
  );
  assert(
    instance.exports.gain_map_metadata_size.value === 152,
    "metadata record global",
  );
  assert(
    instance.exports.gain_map_options_size.value === 104,
    "options record global",
  );
});

Deno.test("allocator and result leases reject stale release after reuse", async () => {
  const instance = await instantiate();
  const { exports } = instance;
  const result = allocate(instance, 16);
  assert(
    exports.gain_map_result_alloc(result, 128, 7) === 0,
    "result allocation",
  );
  const view = new DataView(exports.memory.buffer);
  const first = view.getUint32(result, true);
  const generation = view.getUint32(result + 12, true);
  assert(first !== 0 && generation !== 0, "live result fields");
  assert(exports.gain_map_result_release(result) === 0, "first release");
  assert(
    exports.gain_map_result_release(result) ===
      exports.gain_map_error_stale.value,
    "stale release",
  );
  const pointer = exports.gain_map_alloc(128);
  assert(pointer === first, "freed capacity reuse");
  assert(exports.gain_map_free(pointer) === 0, "general allocation release");
});

Deno.test("coarse JPEG callback is one bounded whole-image operation", async () => {
  const bytes = await Deno.readFile(
    new URL("../dist/gain-map.wasm", import.meta.url),
  );
  let instance;
  let decodeCalls = 0;
  const instantiated = await WebAssembly.instantiate(bytes, {
    gain_map: {
      jpeg_encode() {
        throw new Error("unexpected encode");
      },
      jpeg_decode(request) {
        decodeCalls += 1;
        const view = new DataView(instance.exports.memory.buffer);
        const output = view.getUint32(request + 8, true);
        const capacity = view.getUint32(request + 12, true);
        assert(capacity >= 4, "codec capacity");
        new Uint8Array(instance.exports.memory.buffer, output, 4).set([
          1,
          2,
          3,
          4,
        ]);
        view.setUint32(request + 40, 4, true);
        return 0;
      },
    },
  });
  instance = instantiated.instance;
  assert(instance.exports.gain_map_init() === 0, "initialization");
  const input = allocate(instance, 4);
  const output = allocate(instance, 16);
  const request = allocate(instance, 48);
  new Uint8Array(instance.exports.memory.buffer, input, 4).set([
    0xff,
    0xd8,
    0xff,
    0xd9,
  ]);
  const view = new DataView(instance.exports.memory.buffer);
  view.setUint32(request, input, true);
  view.setUint32(request + 4, 4, true);
  view.setUint32(request + 8, output, true);
  view.setUint32(request + 12, 16, true);
  assert(
    instance.exports.gain_map_jpeg_decode(request) === 0,
    "decode callback status",
  );
  assert(decodeCalls === 1, "exactly one host crossing");
  assert(view.getUint32(request + 40, true) === 4, "produced length");
  assert(
    new Uint8Array(instance.exports.memory.buffer, output, 4).join(",") ===
      "1,2,3,4",
    "codec output",
  );
});
