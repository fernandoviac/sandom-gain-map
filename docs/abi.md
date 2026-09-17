# WebAssembly ABI version 1

## Instantiation and imports

Instantiate the bytes at `@sandom/gain-map/gain-map.wasm` with exactly these
imports:

```text
gain_map.jpeg_encode(request: i32) -> i32
gain_map.jpeg_decode(request: i32) -> i32
```

Each import receives a pointer to a 48-byte codec request in the module's
exported private memory. It performs one complete JPEG operation synchronously,
writes only within the request's declared output span, records the produced
length in request byte 40, and returns zero. A nonzero host result becomes error
21 with the host result in `gain_map_error_field()`. The callback must not grow
memory, call another gain-map operation, retain a pointer, or throw across the
WebAssembly boundary.

Call `gain_map_init() -> i32` once before any operation other than allocation,
free, ABI/error queries, and `gain_map_options_init`. Initialization is
idempotent and initializes the byte-for-byte composed color kernel. Require both
`gain_map_abi_version() == 1` and immutable global
`gain_map_abi_version_global == 1`.

`memory` starts at two pages, may grow to 4,096 pages (256 MiB), and is never
imported. `gain_map_set_memory_limit(bytes)` can lower the allocator ceiling.
All pointers are unsigned 32-bit offsets in this memory. Local records are
little-endian. Wire writers use the byte order required by JPEG, ISO, TIFF, and
MPF. Callers pass records and byte/image buffers only in live spans returned by
`gain_map_alloc` or `gain_map_result_alloc`; offsets below 65,536 are reserved
for the composed kernel, static data, and operation scratch.

## Return and error convention

Status operations return zero on success and the stable error code on failure.
Byte writers and size queries return a positive byte count on success and zero
on failure. `gain_map_alloc` returns a nonzero pointer or zero. Boolean semantic
comparison returns one when equal and zero when unequal or invalid. After any
failure read `gain_map_error_code()` and `gain_map_error_field()`; after a
capacity failure also read `gain_map_required_size()`.

Every operation first clears prior error state. Validation order is:

1. initialization where required;
2. record and byte-span bounds;
3. alignment, enum, layout, dimension, stride, and size arithmetic;
4. numeric finiteness and domain constraints in ascending record/sample order;
5. output capacity and nonoverlap;
6. format version/flags, bounded structure, semantic profile, duplicates,
   contradictions, and trailing bytes in encounter order;
7. allocation or host codec result.

An ordinary malformed input returns an error and never traps. Output records and
buffers are not published until their inputs pass the preceding validation
phases.

| Code | Exported global                  | Meaning                                      |
| ---: | -------------------------------- | -------------------------------------------- |
|    0 | —                                | success                                      |
|    1 | `gain_map_error_not_initialized` | initialization required                      |
|    2 | `gain_map_error_span`            | memory span out of bounds                    |
|    3 | `gain_map_error_alignment`       | sample/record alignment                      |
|    4 | `gain_map_error_dimensions`      | zero, mismatched, or overflowing dimensions  |
|    5 | `gain_map_error_layout`          | unsupported image layout/encoding            |
|    6 | `gain_map_error_sample`          | unsupported sample type                      |
|    7 | `gain_map_error_numeric`         | non-finite or invalid numeric input          |
|    8 | `gain_map_error_record`          | invalid record field or enum                 |
|    9 | `gain_map_error_capacity`        | output capacity or overlap                   |
|   10 | `gain_map_error_allocation`      | allocator ceiling/growth failure             |
|   11 | `gain_map_error_stale`           | unknown, freed, or stale allocation/lease    |
|   12 | `gain_map_error_iso_version`     | unsupported ISO minimum version              |
|   13 | `gain_map_error_iso_flags`       | unknown ISO flags                            |
|   14 | `gain_map_error_truncated`       | bounded record/segment ends early            |
|   15 | `gain_map_error_rational`        | zero denominator or rational overflow        |
|   16 | `gain_map_error_xmp`             | malformed supported Ultra HDR XMP            |
|   17 | `gain_map_error_jpeg`            | malformed JPEG marker/scan structure         |
|   18 | `gain_map_error_mpf`             | malformed MPF TIFF/index/entry               |
|   19 | `gain_map_error_profile`         | recognized but unsupported adaptive profile  |
|   20 | `gain_map_error_contradiction`   | ISO/XMP/package declarations disagree        |
|   21 | `gain_map_error_codec`           | coarse host codec failed                     |
|   22 | `gain_map_error_overflow`        | checked integer arithmetic overflow          |
|   23 | `gain_map_error_trailing`        | bytes follow a closed record or package      |
|   24 | `gain_map_error_duplicate`       | duplicate singleton description/index        |
|   25 | `gain_map_error_unsupported`     | unsupported direction/channel/format feature |

`error_field` is a record byte offset for records, an argument index for scalar
arguments, a byte offset for ISO/JPEG/MPF/XMP, or a sample index.
Alternate-image sample failures set bit 30. Codec errors report the host status.

## Memory records

Every size and offset below also has an immutable exported global with the
`gain_map_` prefix and the names shown by the tables.

### Image descriptor (`image_size = 32`)

| Offset | Type | Global suffix                 | Meaning                          |
| -----: | ---- | ----------------------------- | -------------------------------- |
|      0 | u32  | `image_data_offset`           | pixel data pointer               |
|      4 | u32  | `image_data_length_offset`    | complete accessible byte span    |
|      8 | u32  | `image_width_offset`          | positive width                   |
|     12 | u32  | `image_height_offset`         | positive height                  |
|     16 | u32  | `image_row_stride_offset`     | bytes between row starts         |
|     20 | u32  | `image_sample_type_offset`    | 0 u8, 1 u16, 2 f32               |
|     24 | u32  | `image_channel_layout_offset` | 0 RGB, 1 RGBA                    |
|     28 | u32  | `image_flags_offset`          | bit 0 encoded sRGB, bit 1 opaque |

Sample and layout values are also exported as `gain_map_sample_u8`,
`gain_map_sample_u16`, `gain_map_sample_f32`, `gain_map_layout_rgb`, and
`gain_map_layout_rgba`; flag bits are `gain_map_image_flag_srgb` and
`gain_map_image_flag_opaque`. Row padding is allowed. The minimum data span is
`rowStride * (height - 1) + width * channels * sampleBytes`.

Generation accepts an encoded-sRGB f32 RGBA base and a linear-Rec.2020 f32 RGBA
alternate of equal dimensions; both must have alpha exactly one. The gain output
is f32 RGB. Reconstruction accepts encoded-sRGB u8/u16/f32 RGB/RGBA base data
and f32 RGB gain data no larger than the base. Reconstructed output is f32 RGBA
linear Rec.2020.

### Generation options (`options_size = 104`)

| Offset | Type  | Global suffix                          | Meaning                          |
| -----: | ----- | -------------------------------------- | -------------------------------- |
|      0 | u32   | `options_scale_offset`                 | 1, 2, 4, or 8                    |
|      4 | u32   | `options_base_quality_offset`          | integer 0..100 for codec request |
|      8 | u32   | `options_map_quality_offset`           | integer 0..100 for codec request |
|     12 | u32   | —                                      | reserved zero                    |
|     16 | 3×f64 | `options_gamma_offset`                 | positive map gamma               |
|     40 | 3×f64 | `options_base_offset`                  | positive base offsets            |
|     64 | 3×f64 | `options_alternate_offset`             | positive alternate offsets       |
|     88 | f64   | `options_maximum_display_boost_offset` | finite value at least one        |
|     96 | u32   | `options_flags_offset`                 | zero in ABI v1                   |
|    100 | u32   | —                                      | reserved zero                    |

`gain_map_options_init(ptr)` writes release defaults: qualities 90, scale 1,
gamma 1, offsets 1/64, maximum display boost 4.

### Metadata (`metadata_size = 152`)

| Offset | Type  | Global suffix                   | Meaning                          |
| -----: | ----- | ------------------------------- | -------------------------------- |
|      0 | 3×f64 | `metadata_min_offset`           | minimum logarithmic gain         |
|     24 | 3×f64 | `metadata_max_offset`           | maximum logarithmic gain         |
|     48 | 3×f64 | `metadata_gamma_offset`         | positive map gamma               |
|     72 | 3×f64 | `metadata_base_offset`          | base offset                      |
|     96 | 3×f64 | `metadata_alternate_offset`     | alternate offset                 |
|    120 | f64   | `metadata_headroom_min_offset`  | minimum log2 display headroom    |
|    128 | f64   | `metadata_headroom_max_offset`  | maximum log2 display headroom    |
|    136 | u32   | `metadata_flags_offset`         | bit 0: ISO base color space flag |
|    140 | u32   | `metadata_profile_offset`       | 0 generated, 1 ISO, 2 Ultra HDR  |
|    144 | u32   | `metadata_channel_count_offset` | original wire count, 1 or 3      |
|    148 | u32   | —                               | ISO writer version or zero       |

The only calculation contract in ABI v1 is linear Rec. 2020, D65, 203 cd/m²
reference white with an SDR base. The ISO base-color-space flag is retained for
inspection; it does not select an arbitrary host color transform.

### Coarse JPEG codec request (`codec_request_size = 48`)

| Offset | Type  | Global suffix                               | Meaning                          |
| -----: | ----- | ------------------------------------------- | -------------------------------- |
|      0 | u32   | `codec_input_offset`                        | complete input span pointer      |
|      4 | u32   | `codec_input_length_offset`                 | input span byte length           |
|      8 | u32   | `codec_output_offset`                       | caller-owned output span pointer |
|     12 | u32   | `codec_output_capacity_offset`              | output capacity                  |
|  16/20 | 2×u32 | `codec_width_offset`, `codec_height_offset` | image dimensions                 |
|     24 | u32   | `codec_row_stride_offset`                   | decoded row byte stride          |
|     28 | u32   | `codec_sample_type_offset`                  | image sample enum                |
|     32 | u32   | `codec_channel_layout_offset`               | image layout enum                |
|     36 | u32   | `codec_quality_offset`                      | encode quality 0..100            |
|     40 | u32   | `codec_output_length_offset`                | host-produced byte length        |
|     44 | u32   | `codec_flags_offset`                        | zero in ABI v1                   |

For encode, input is a complete image described by offsets 16..36 and the
wrapper validates its row extent before the import. For decode, input is one
complete JPEG codestream; the host fills image fields and output length. Both
operations require nonempty, bounded, nonoverlapping input/output spans. The
wrapper clears output length before the import and accepts only a positive
length no greater than capacity afterward.

### Error summary (`error_summary_size = 40`)

Offsets 0, 8, 16, and 24 are f64 maximum absolute channel error, mean absolute
channel error, root mean square channel error, and mean relative Rec.2020
luminance error. Offsets 32 and 36 are u32 clipped-pixel and channel-order-error
counts. Their globals end in `error_maximum_offset`, `error_mean_offset`,
`error_rms_offset`, `error_luminance_offset`, `error_clipped_offset`, and
`error_channel_order_offset`.

### Result lease (`result_size = 16`)

Offsets 0/4/8/12 are u32 pointer, length, kind, and allocation generation. Their
globals end in `result_pointer_offset`, `result_length_offset`,
`result_kind_offset`, and `result_generation_offset`. A lease is exclusively
owned until `gain_map_result_release(record)`. Release verifies the live block
and generation, frees it, and clears all four fields. A second release is stale.
General `gain_map_alloc(size)` allocations instead use `gain_map_free(pointer)`.

### Inspection (`inspection_size = 64`)

|   Offset | Type  | Meaning                                               |
| -------: | ----- | ----------------------------------------------------- |
|        0 | u32   | is adaptive gain-map JPEG                             |
|        4 | u32   | compatibility: 0 ordinary, 1 ISO, 2 Ultra HDR, 3 dual |
|        8 | u32   | selected metadata source: 1 ISO, 2 Ultra HDR          |
|    12/16 | 2×u32 | primary offset/length                                 |
| 20/24/28 | 3×u32 | primary width/height/channels                         |
|    32/36 | 2×u32 | gain-map offset/length                                |
| 40/44/48 | 3×u32 | gain-map width/height/channels                        |
|       52 | u32   | MPF image count, or zero                              |
|    56/60 | 2×u32 | MPF payload file offset/length, or zero               |

Compatibility constants are exported as `gain_map_compatibility_ordinary`,
`_iso`, `_ultra_hdr`, and `_dual`. MPF entry records are 16 bytes: attributes,
byte length, TIFF-relative data offset, and file-relative absolute offset. XMP
info records are 8 bytes: kind (0 unrelated, 1 primary directory, 2 secondary
metadata) and declared auxiliary length.

## Operations

```text
gain_map_init() -> status
gain_map_set_memory_limit(bytes) -> status
gain_map_alloc(bytes) -> pointer-or-zero
gain_map_free(pointer) -> status
gain_map_result_alloc(result16, bytes, kind) -> status
gain_map_result_release(result16) -> status
gain_map_error_code() -> error
gain_map_error_field() -> operation-specific detail
gain_map_required_size() -> bytes
```

`gain_map_init` is idempotent and is required before semantic operations.
Allocation pointers are eight-byte aligned. The optional memory limit applies to
future growth and is bounded to 256 MiB.

```text
gain_map_prepare_base(alternate, sourcePeakF64, output) -> status
gain_map_generate(base, alternate, options, gainImage, metadata) -> status
gain_map_reconstruct(base, gainImage, metadata, displayBoostF64, output) -> status
gain_map_measure_error(reference, reconstructed, summary) -> status
gain_map_measure_generation_error(base, alternate, gainImage, metadata,
                                  displayBoostF64, summary) -> status
gain_map_metadata_validate(metadata) -> status
gain_map_metadata_equal(left, right) -> boolean
```

For output image descriptors, the caller sets data pointer and data length;
WebAssembly fills the remaining fields and validates capacity. Gain dimensions
are `ceil(base / scale)`. `prepare_base` gets `sourcePeak` in cd/m².
`measure_generation_error` compares reconstruction from the stored,
potentially reduced eight-bit recovery map with the unquantized per-pixel
logarithmic gain derived from the same base and alternate inputs. This preserves
generation-stage error facts without a host numeric implementation.

```text
gain_map_iso_encoded_size(metadata) -> bytes-or-zero
gain_map_iso_encode(metadata, output, capacity) -> bytes-or-zero
gain_map_iso_decode(bytes, length, metadata) -> status
gain_map_xmp_secondary_encode(metadata, output, capacity) -> bytes-or-zero
gain_map_xmp_primary_encode(gainLength, output, capacity) -> bytes-or-zero
gain_map_xmp_decode(text, length, metadata, xmpInfo) -> status
gain_map_app_segment(marker, payload, length, output, capacity) -> bytes-or-zero
gain_map_mpf_write(primaryLength, auxiliaryLength, auxiliaryOffset,
                   output, capacity) -> bytes-or-zero
gain_map_jpeg_dimensions(bytes, length, start, result16) -> status
gain_map_mpf_inspect(bytes, length, start, entries, entryCapacity,
                     countResult) -> status
gain_map_inspect(bytes, length, inspection, metadata) -> status
gain_map_inspect_profiles(bytes, length, inspection, selectedMetadata,
                          isoMetadata, xmpMetadata, presenceBits) -> status
gain_map_package(baseJpeg, baseLength, gainJpeg, gainLength, metadata,
                 output, capacity) -> bytes-or-zero
gain_map_jpeg_encode(codecRequest) -> status
gain_map_jpeg_decode(codecRequest) -> status
```

`result16` from dimensions contains width, height, channel count, and JPEG byte
length. `gain_map_package` always writes the dual ISO-and-Ultra-HDR profile and
constructs XMP from decoded ISO rational values.
`gain_map_inspect_profiles` performs the same validation as `gain_map_inspect`
while preserving both decoded descriptions for host-facing inspection objects;
`presenceBits` uses bit 0 for ISO and bit 1 for Ultra HDR.
Call `gain_map_package` once with an adequate nonoverlapping output span; on
capacity failure, allocate
`gain_map_required_size()` bytes and retry. JPEG encode/decode imports are never
used by numeric, metadata, inspection, MPF, APP, or package operations.

## Wire and numeric rules

ISO minimum/writer version is 0. Writer flags are `0x40` scalar and `0xc0`
three-channel. Unknown flag mask `0x33` and backward direction bit `0x04`
reject; common denominator bit `0x08` decodes. Every writer fraction uses a
denominator of 1,000,000 and `floor(value * 1,000,000 + 0.5)` numerator
rounding. Signed fields are min/max/base offset/alternate offset; gamma/headroom
are unsigned.

Ultra HDR secondary XMP is UTF-8/ASCII and writes fixed decimal values from the
six-decimal ISO rational grid, trimming trailing zeros. Scalar metadata uses
attributes; otherwise each channel field is a three-item RDF sequence. Primary
XMP declares one Primary JPEG and one GainMap JPEG. APP1 uses namespace
`http://ns.adobe.com/xap/1.0/\0`; APP2 ISO uses `urn:iso:std:iso:ts:21496:-1\0`.

Generation and reconstruction implement:

```text
logGain[c] = log2((alternate[c] + alternateOffset[c]) /
                  (base[c] + baseOffset[c]))
normalized[c] = range[c] == 0 ? 0 :
  clamp((logGain[c] - min[c]) / range[c], 0, 1)
stored[c] = normalized[c] ^ gamma[c]
weight = clamp((log2(displayBoost) - headroomMin) /
               (headroomMax - headroomMin), 0, 1)
recovery[c] = centeredBilinear(stored)[c] ^ (1 / gamma[c])
output[c] = max(0, (base[c] + baseOffset[c]) *
                     2 ^ ((min[c] + range[c] * recovery[c]) * weight) -
                   alternateOffset[c])
```

`headroomMin` is zero. Generated `headroomMax` is the maximum of 1/1024, all
channel maximum log gains, and `log2(maximumDisplayBoost)`.
