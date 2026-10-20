# FilmProcessor Colour Analysis

Colour-space transfer functions and precision measurements for decoded images.

Dependency-free ES modules for browsers, workers and Node.js 20+. This package
works on interleaved decoded integer samples; it does not decode image or video
files or provide a complete colour-management pipeline.

## Use

Clone this repository and import `src/index.js`. This package is not published to
npm yet.

```js
import { DCP_XYZ, measureFrame, createAccumulator, foldFrame,
  finalizeAccumulator } from './src/index.js';

const samples = new Int32Array([3794, 3960, 3890]);
const frame = measureFrame(samples, 1, 1, 3, 12, { space: DCP_XYZ });
const accumulator = createAccumulator();
foldFrame(accumulator, frame);
console.log(finalizeAccumulator(accumulator).componentMetrics);
```

`measureFrame(samples, width, height, components, bitDepth, options)` expects
positive dimensions, 1–4 interleaved components and 1–16 bit depth. Values may
fall outside the nominal range; those excursions are counted. `options.space`
selects a descriptor. The default is `DCP_XYZ`, so **select the actual source
encoding explicitly when it is not DCP XYZ**.

## API

- `DCP_XYZ`, `BT2100_PQ`, `BT2100_HLG`, `COLOUR_SPACES`, `resolveColourSpace`:
  frozen transfer-function and measurement descriptors.
- `luminanceFromCode`, `codeFromLuminance`: transfer helpers; pass the maximum
  code value and descriptor when using a non-default encoding.
- `measureFrame`: per-component histograms, code-value occupancy, extremes,
  range excursions, horizontal plateaus and reference-white observations.
- `createAccumulator`, `foldFrame`, `finalizeAccumulator`: aggregate compatible
  frames. Mismatched formats/colour spaces are excluded and counted.

PQ is interpreted as RGB display light. HLG transfer helpers expose relative
scene light without a display OOTF; they do not infer absolute luminance.
Neither profile borrows a DCI white point. Unknown profile names fall back to
DCP XYZ for compatibility; use a known exported descriptor to avoid that fallback.

## Measurement-only API

The package returns numerical measurements. Applications supply their own
thresholds, severity choices and QC verdicts.

Version 0.2.0 removes the former `buildFindings` export and its reporting-only
descriptor threshold. Consumers using that helper must provide their own
interpretation of the returned measurements.

## Scope and limits

Sparse code values and long plateaus can be intentional content. They do not by
themselves prove visible banding, quantization damage or a failed delivery.
Likewise, the brightest neutral in ordinary footage is not necessarily a
calibration patch. This library does not claim full HDR rendering, gamut mapping,
video decoding, perceptual quality scores or standards certification.

## Validation

Run `npm test` and `node examples/white.js`. The synthetic suite covers the DCI
white anchor, transfer round trips, withheld unknown values, histogram counts
past 32 bits and exclusion of mismatched frame formats. No runtime dependencies.

## License

MIT. See `LICENSE` and `NOTICE`.
