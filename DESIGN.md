# Design

## Authority and runtime

The maintained implementation is the ordered `.watpart` source named by
`src/gain-map.manifest.json`. The build composes the exact embeddable
`color-kernel.watpart` from `@sandom/color` 0.1.0, assembles the result in
process with the vendored `tools/wat-assembler`, compiles it with
`WebAssembly.compile` to validate it, and records every source and artifact
digest. No generated source logic or runtime language binding exists.

The package exposes an independent WebAssembly module with private memory. Its
only imports are synchronous whole-image `gain_map.jpeg_encode` and
`gain_map.jpeg_decode` effects. A host crosses this boundary once per complete
codestream, never per pixel or scanline. Callers may bypass the imports and pass
codec-produced JPEG codestream spans directly to `gain_map_package` and
`gain_map_inspect`.

`docs/abi.md` is the complete primitive ABI contract. Every enum, record size,
field offset, and error code is also an immutable WebAssembly global. Multi-byte
fields are little-endian except ISO, JPEG, TIFF, and MPF wire fields, whose
standards define their byte order.

## Calculation pipeline

The calculation space is linear Rec. 2020, D65, with 203 cd/m² reference white.
`gain_map_prepare_base` applies the composed color kernel's BT.2390 transform,
CSS Color 4 gamut mapping, Rec. 2020-to-sRGB matrix route, and sRGB transfer.
`gain_map_generate` decodes that sRGB base back to the calculation space inside
the same instance before measuring gain. There is no host color or pixel
callback.

Generation uses f64 ratio, logarithm, extrema, normalization, and metadata work.
It computes complete-image channel extrema, preserves a zero recovery value for
a constant channel range, applies positive per-channel offsets and gamma, and
writes f32 recovery samples. Reduction scales are exactly 1, 2, 4, or 8. Output
dimensions use ceilings; each edge box uses its real population; accumulation
demotes after every addition to match the maintained Float32Array order. The
single map quantization is `floor(value * 255 + 0.5) / 255`.

Reconstruction uses centered pixel coordinates, clamped bilinear edges, inverse
map gamma, and independent display-headroom weighting. The base descriptor can
contain unsigned 8-bit, unsigned 16-bit, or float32 encoded-sRGB RGB/RGBA data
with padding. Output is opaque f32 linear-Rec.2020 RGBA. Error measurement owns
maximum and mean channel error, RMS, relative Rec.2020 luminance error, clipped
pixels, and stable channel-order changes.

## Metadata and package model

The 152-byte adaptive metadata record carries five fixed three-channel f64
arrays, display headroom, calculation-space flags, source profile, and original
channel count. Generation requires positive offsets; imported ISO and Ultra HDR
metadata permit zero offsets. All records require an SDR base, positive gamma,
finite values, ordered gain bounds, and ordered nonnegative headroom.

ISO 21496-1 is authoritative. The writer uses explicit denominators of 1,000,000
and collapses to one channel only when every channel-valued field is exactly
equal. The reader also accepts the standard common-denominator form, expands a
one-channel record, rejects unsupported versions/flags/HDR direction, and
rejects truncation, zero denominators, and trailing bytes.

Ultra HDR v1 XMP has one canonical serialization. Scalar records use attributes;
channel records use three-item RDF sequences. Packaging derives XMP from the
round-tripped ISO record, so both forms describe the same rationalized
reconstruction. Semantic comparison uses an inclusive absolute tolerance of
0.000001. The bounded parser recognizes decimal and exponent forms, never
resolves entities or external resources, and rejects an HDR base.

JPEG inspection walks marker and entropy regions with explicit file bounds,
requires exactly one supported start-of-frame record, parses either-endian MPF
TIFF indexes, and validates image offsets and lengths before following them.
Adaptive packages require exactly two images, matching primary declarations,
matching auxiliary length, no trailing bytes, required secondary descriptions,
and noncontradictory ISO/XMP metadata. ISO is selected when both exist. Ordinary
JPEGs and nonadaptive MPF files remain ordinary; legacy Apple MPF files are not
misclassified.

Packaging accepts two complete caller-supplied JPEG codestreams. It preserves
each codestream, inserts primary ISO/XMP/MPF and secondary ISO/XMP APP segments,
uses TIFF-relative MPF offsets, and leaves the primary image independently
decodable. Inputs and output must not overlap. APP 16-bit and MPF 32-bit limits
are checked before publication.

## Ownership, concurrency, and GPU boundary

Inputs are borrowed read-only for a synchronous call. Caller-provided output
spans remain caller-owned. `gain_map_alloc` allocations remain live until
`gain_map_free`; generation-bearing result leases remain live until
`gain_map_result_release`. Freed or stale leases cannot alias a reused block. No
partial output is published before validation succeeds. Memory growth can
invalidate host views, so a host refreshes them after allocation or codec calls.

The color scratch, metadata parser scratch, JPEG scanner scratch, and allocator
are private mutable state. Calls on one instance are serialized; concurrent work
uses separate instances. Codec callbacks must complete synchronously before
returning and must not retain borrowed pointers.

An optional GPU generation/reconstruction path is intentionally outside this
release. It may be added only after measured f64/f32 precision and ownership
evidence. Metadata, rational arithmetic, deterministic reduction/error order,
JPEG traversal, MPF, and package assembly remain WebAssembly work.
