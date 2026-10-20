/**
 * FilmProcessor Colour Analysis — numerical measurements over decoded integer samples.
 *
 * Everything here is a pure function over decoded integer samples, so it carries
 * no DCP concept and no I/O. SMPTE ST 428-1 s4.3 defines the cinema encoding as
 *
 *     CV = INT[ 4095 * ( L * T / 52.37 ) ^ (1/2.6) ]      T in {X, Y, Z}
 *
 * with reference luminance L = 48 cd/m^2. Decoding is the inverse,
 * L_T = 52.37 * (CV/4095)^2.6, and DCI calibration white (SMPTE RP 431-2) is
 * x = 0.3140, y = 0.3510 at 48.00 cd/m^2 — CV X'Y'Z' 3794 / 3960 / 3890.
 *
 * That encoding is no longer hard-coded here. It lives in `colour-space.js` as
 * the `DCP_XYZ` descriptor and is the DEFAULT of every entry point below, so a
 * caller that names no space measures a DCP exactly as this module always has —
 * same literals, same operation order, same doubles. Passing a different space
 * swaps the transfer, the component names and the white point; it must never
 * change what the DCP path computes.
 */

import { DCP_XYZ, resolveColourSpace } from './colour-space.js';

export { BT2100_HLG, BT2100_PQ, COLOUR_SPACES, DCP_XYZ, resolveColourSpace } from './colour-space.js';

// Standard DCI reference values, shared with the colour-space descriptor.
export const ST428_PEAK_LUMINANCE = DCP_XYZ.peakLuminance;
export const DCI_REFERENCE_LUMINANCE = DCP_XYZ.referenceLuminance;
export const DCI_WHITE_X = DCP_XYZ.whiteX;
export const DCI_WHITE_Y = DCP_XYZ.whiteY;
export const COMPONENT_NAMES = DCP_XYZ.componentNames;

/**
 * Code value to luminance under `space`.
 *
 * For the default DCP space this is the inverse of ST 428-1 s4.3 and the result
 * is absolute cd/m^2. For a display-referred space it is relative light in
 * 0..1 — `space.luminanceUnit` says which.
 */
export function luminanceFromCode(codeValue, maxCode = 4095, space = DCP_XYZ) {
  const normalized = Math.max(0, Math.min(1, codeValue / maxCode));
  return space.decode(normalized);
}

/** Forward direction, used to state what a given luminance should have encoded to. */
export function codeFromLuminance(luminance, maxCode = 4095, space = DCP_XYZ) {
  return Math.round(maxCode * space.encode(luminance));
}

/**
 * Measure one decoded frame.
 *
 * @param {Int32Array} samples component-interleaved integers, X'Y'Z' by default
 * @param {object} [options] `options.space` selects the colour space; omitting
 *        it measures as ST 428-1 X'Y'Z', which is what every DCP caller does.
 * @returns per-component occupancy, the frame's brightest neutral, and the
 *          horizontal plateau structure banding is read from.
 */
export function measureFrame(samples, width, height, components, bitDepth, options = {}) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isInteger(components) || components < 1 || components > 4 || !Number.isInteger(bitDepth) || bitDepth < 1 || bitDepth > 16 || !ArrayBuffer.isView(samples) || !Number.isSafeInteger(samples.length) || samples.length < width * height * components) throw new TypeError('Expected complete interleaved integer samples, positive dimensions, 1–4 components and 1–16 bit depth');
  const space = options.space || DCP_XYZ;
  // maxCode stays derived from the essence, not the space: bit depth is a
  // property of what was decoded, not of how it is interpreted.
  const maxCode = (1 << bitDepth) - 1;
  const bins = maxCode + 1;
  const compCount = Math.min(components, space.componentCount);
  const pixels = width * height;

  const histograms = [];
  const totals = [];
  const mins = [];
  const maxes = [];
  const belowRange = [];
  const aboveRange = [];
  const runValues = [];
  const runLengths = [];
  const widestRuns = [];

  for (let c = 0; c < compCount; c++) {
    histograms.push(new Uint32Array(bins));
    totals.push(0);
    mins.push(Number.POSITIVE_INFINITY);
    maxes.push(Number.NEGATIVE_INFINITY);
    belowRange.push(0);
    aboveRange.push(0);
    runValues.push(NaN);
    runLengths.push(0);
    widestRuns.push(0);
  }

  // One row-major pass carries the histogram, the extremes, the running mean and
  // the horizontal plateau runs together. Splitting these into separate passes
  // cost three extra reads per sample for no benefit.
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < compCount; c++) {
      runValues[c] = NaN;
      runLengths[c] = 0;
    }
    const rowBase = y * width * components;
    for (let x = 0; x < width; x++) {
      const base = rowBase + x * components;
      for (let c = 0; c < compCount; c++) {
        const value = samples[base + c];
        if (!Number.isInteger(value)) throw new TypeError("Samples must be finite integers");
        if (value < mins[c]) mins[c] = value;
        if (value > maxes[c]) maxes[c] = value;
        totals[c] += value;
        if (value < 0) {
          belowRange[c] += 1;
        } else if (value > maxCode) {
          aboveRange[c] += 1;
        } else {
          histograms[c][value] += 1;
        }
        if (value === runValues[c]) {
          runLengths[c] += 1;
        } else {
          if (runLengths[c] > widestRuns[c]) widestRuns[c] = runLengths[c];
          runValues[c] = value;
          runLengths[c] = 1;
        }
      }
    }
    for (let c = 0; c < compCount; c++) {
      if (runLengths[c] > widestRuns[c]) widestRuns[c] = runLengths[c];
    }
  }

  const componentMetrics = [];
  for (let c = 0; c < compCount; c++) {
    const occupancy = summarizeOccupancy(histograms[c], space.dominantCoverage);
    componentMetrics.push({
      name: space.componentNames[c] || `C${c}`,
      distinctCodeValues: occupancy.distinct,
      dominantCodeValues: occupancy.dominant,
      coverage: occupancy.distinct / bins,
      largestGap: occupancy.largestGap,
      largestGapFrom: occupancy.largestGapFrom,
      largestGapTo: occupancy.largestGapTo,
      gapsWiderThanOne: occupancy.gapsWiderThanOne,
      min: mins[c] === Number.POSITIVE_INFINITY ? 0 : mins[c],
      max: maxes[c] === Number.NEGATIVE_INFINITY ? 0 : maxes[c],
      mean: totals[c] / pixels,
      belowRange: belowRange[c],
      aboveRange: aboveRange[c],
      widestPlateau: widestRuns[c],
    });
  }

  return {
    width,
    height,
    components,
    bitDepth,
    maxCode,
    colourSpace: space.id,
    histograms,
    componentMetrics,
    // A white point is only measurable where the decoded samples ARE X, Y, Z.
    // For an RGB-primaries space chromaticity needs an RGB->XYZ matrix that
    // this build does not carry, so the white is withheld rather than invented.
    referenceWhite:
      compCount < 3 || !space.samplesAreTristimulus
        ? null
        : measureReferenceWhite(samples, pixels, components, maxes[1], maxCode, space),
    gradientProfile:
      options.scanline === false
        ? null
        : profileScanline(samples, width, height, components, space.scanlineComponent, space),
  };
}

/**
 * Streaming accumulator.
 *
 * Frames are folded in as they arrive and their histograms discarded, so heap
 * is flat in the number of frames analysed. Retaining them cost ~50 KB per
 * frame — 6.7 GB on a 144,000-frame feature, which a browser tab does not have.
 *
 * The bins are Float64Array, not Uint32Array. Uint32 wraps at 4.29e9, which on a
 * 2K raster is one code value filling 2,445 frames — 102 seconds of black leader
 * or a fade. The wrap was silent, and a bin landing on an exact multiple of 2^32
 * read as UNOCCUPIED, so the reported distinct-value count fell and a gap
 * appeared where none existed. Float64 holds integer counts exactly to 2^53,
 * which is 5.1 million frames of 2K Scope.
 */
export function createAccumulator() {
  return {
    frameCount: 0,
    width: 0,
    height: 0,
    components: 0,
    bitDepth: 0,
    maxCode: 0,
    bins: 0,
    colourSpace: undefined,
    components_: null,
    referenceWhite: null,
    gradientProfile: null,
    tracks: [],
  };
}

export function foldFrame(accumulator, frame) {
  if (!frame) {
    return accumulator;
  }

  // Folding a frame whose container differs from the one the accumulator was
  // primed with would silently drop every code value above the primed maxCode,
  // producing a report that says a component reached full scale and that nothing
  // is outside the container. Exclude it and count it instead. A frame measured
  // under a different colour space is the same class of error one level up:
  // its code values mean something else, so summing the histograms would
  // produce a distribution of nothing in particular.
  if (
    accumulator.components_ &&
    (frame.width !== accumulator.width ||
      frame.height !== accumulator.height ||
      frame.bitDepth !== accumulator.bitDepth ||
      frame.colourSpace !== accumulator.colourSpace ||
      frame.componentMetrics.length !== accumulator.components_.length)
  ) {
    accumulator.mismatched = (accumulator.mismatched || 0) + 1;
    return accumulator;
  }

  if (!accumulator.components_) {
    accumulator.width = frame.width;
    accumulator.height = frame.height;
    accumulator.components = frame.components;
    accumulator.bitDepth = frame.bitDepth;
    accumulator.maxCode = frame.maxCode;
    accumulator.bins = frame.maxCode + 1;
    accumulator.colourSpace = frame.colourSpace;
    accumulator.components_ = frame.componentMetrics.map((metric) => ({
      name: metric.name,
      histogram: new Float64Array(accumulator.bins),
      sampleCount: 0,
      weightedMean: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      belowRange: 0,
      aboveRange: 0,
      widestPlateau: 0,
    }));
  }

  const framePixels = frame.width * frame.height;
  for (let c = 0; c < accumulator.components_.length; c++) {
    const into = accumulator.components_[c];
    const histogram = frame.histograms[c];
    const metric = frame.componentMetrics[c];
    if (histogram) {
      for (let v = 0; v < histogram.length && v < into.histogram.length; v++) {
        if (histogram[v]) {
          into.histogram[v] += histogram[v];
        }
      }
    }
    into.sampleCount += framePixels;
    into.weightedMean += metric.mean * framePixels;
    if (metric.min < into.min) into.min = metric.min;
    if (metric.max > into.max) into.max = metric.max;
    into.belowRange += metric.belowRange;
    into.aboveRange += metric.aboveRange;
    if (metric.widestPlateau > into.widestPlateau) into.widestPlateau = metric.widestPlateau;
  }

  const white = frame.referenceWhite;
  if (white?.neutralFound) {
    if (!accumulator.referenceWhite || white.codeValues[1] > accumulator.referenceWhite.codeValues[1]) {
      accumulator.referenceWhite = white;
    }
  } else {
    accumulator.framesWithoutNeutral = (accumulator.framesWithoutNeutral || 0) + 1;
  }

  // One frame's scanline, kept with its provenance so it is never mistaken for
  // a package-wide figure.
  if (!accumulator.gradientProfile && frame.gradientProfile) {
    accumulator.gradientProfile = {
      ...frame.gradientProfile,
      frameIndex: frame.frameIndex ?? 0,
      trackIndex: frame.trackIndex ?? 0,
    };
  }

  accumulator.frameCount += 1;
  return accumulator;
}

export function finalizeAccumulator(accumulator) {
  if (!accumulator?.components_ || !accumulator.frameCount) {
    return null;
  }

  const bins = accumulator.bins;
  const space = resolveColourSpace(accumulator.colourSpace);
  const componentMetrics = accumulator.components_.map((into) => {
    const occupancy = summarizeOccupancy(into.histogram, space.dominantCoverage);
    return {
      name: into.name,
      histogram: into.histogram,
      distinctCodeValues: occupancy.distinct,
      dominantCodeValues: occupancy.dominant,
      coverage: occupancy.distinct / bins,
      largestGap: occupancy.largestGap,
      largestGapFrom: occupancy.largestGapFrom,
      largestGapTo: occupancy.largestGapTo,
      gapsWiderThanOne: occupancy.gapsWiderThanOne,
      gapExamples: occupancy.gapExamples,
      min: into.min === Number.POSITIVE_INFINITY ? 0 : into.min,
      max: into.max === Number.NEGATIVE_INFINITY ? 0 : into.max,
      mean: into.weightedMean / into.sampleCount,
      belowRange: into.belowRange,
      aboveRange: into.aboveRange,
      widestPlateau: into.widestPlateau,
    };
  });

  return {
    frameCount: accumulator.frameCount,
    mismatchedFrames: accumulator.mismatched || 0,
    width: accumulator.width,
    height: accumulator.height,
    components: accumulator.components,
    bitDepth: accumulator.bitDepth,
    maxCode: accumulator.maxCode,
    colourSpace: accumulator.colourSpace,
    componentMetrics,
    referenceWhite: accumulator.referenceWhite,
    framesWithoutNeutral: accumulator.framesWithoutNeutral || 0,
    gradientProfile: accumulator.gradientProfile,
    tracks: accumulator.tracks,
  };
}

function summarizeOccupancy(histogram, dominantCoverage = DCP_XYZ.dominantCoverage) {
  let distinct = 0;
  let previous = -1;
  let largestGap = 0;
  let largestGapFrom = 0;
  let largestGapTo = 0;
  let gapsWiderThanOne = 0;
  const gapExamples = [];
  const populations = [];
  let population = 0;

  for (let value = 0; value < histogram.length; value++) {
    if (!histogram[value]) {
      continue;
    }
    distinct += 1;
    populations.push(histogram[value]);
    population += histogram[value];
    if (previous >= 0) {
      const gap = value - previous;
      if (gap > 1) {
        gapsWiderThanOne += 1;
        if (gapExamples.length < 8) {
          gapExamples.push({ from: previous, to: value, gap });
        }
      }
      if (gap > largestGap) {
        largestGap = gap;
        largestGapFrom = previous;
        largestGapTo = value;
      }
    }
    previous = value;
  }

  // Lossy JPEG 2000 puts a thin scatter of extra code values around every edge
  // in the picture. Counting them as tonal levels overstates how much tone the
  // essence really carries, so report the smallest set of code values that
  // together account for 99% of samples alongside the raw occupied count.
  populations.sort((a, b) => b - a);
  const target = population * dominantCoverage;
  let covered = 0;
  let dominant = 0;
  for (const count of populations) {
    if (covered >= target) {
      break;
    }
    covered += count;
    dominant += 1;
  }

  return { distinct, dominant, largestGap, largestGapFrom, largestGapTo, gapsWiderThanOne, gapExamples };
}

/** Plateau and step structure along the frame's middle row. */
function profileScanline(samples, width, height, components, component, space = DCP_XYZ) {
  if (width < 2 || height < 1) {
    return null;
  }

  const row = height >> 1;
  const rowBase = row * width * components + component;
  const plateaus = [];
  let runValue = samples[rowBase];
  let runStart = 0;

  for (let x = 1; x <= width; x++) {
    const value = x < width ? samples[rowBase + x * components] : null;
    if (value !== runValue) {
      plateaus.push({ value: runValue, start: runStart, width: x - runStart });
      runValue = value;
      runStart = x;
    }
  }

  const widths = plateaus.map((plateau) => plateau.width).sort((a, b) => a - b);
  const steps = [];
  for (let i = 1; i < plateaus.length; i++) {
    steps.push(Math.abs(plateaus[i].value - plateaus[i - 1].value));
  }
  const sortedSteps = [...steps].sort((a, b) => a - b);

  const stepCounts = new Map();
  for (const step of steps) {
    stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
  }

  return {
    row,
    component: space.componentNames[component],
    plateaus: plateaus.length,
    maxPlateauWidth: widths.length ? widths[widths.length - 1] : 0,
    minPlateauWidth: widths.length ? widths[0] : 0,
    medianPlateauWidth: median(widths),
    maxStep: sortedSteps.length ? sortedSteps[sortedSteps.length - 1] : 0,
    minStep: sortedSteps.length ? sortedSteps[0] : 0,
    medianStep: median(sortedSteps),
    stepHistogram: [...stepCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([step, count]) => ({ step, count })),
  };
}

/**
 * The brightest neutral sample in the frame: the peak Y', with X' and Z'
 * averaged across every pixel that reaches it, so a large flat white patch is
 * measured rather than one arbitrary pixel.
 */
// How far from the space's white a sample may sit and still be called neutral
// lives on the descriptor as `neutralTolerance`. For the DCP space it is 0.05:
// wide enough to admit a legitimately mis-set white point (the 0.0147 error this
// page was built to find), narrow enough to exclude a saturated highlight.

function measureReferenceWhite(samples, pixels, components, peakY, maxCode, space = DCP_XYZ) {
  // peakY comes from the main pass, so this costs one traversal rather than two.
  if (!Number.isFinite(peakY)) {
    return null;
  }

  const neutralTolerance = space.neutralTolerance;
  const whiteX = space.whiteX;
  const whiteY = space.whiteY;

  // Brightest NEUTRAL, not simply brightest. Averaging X' and Z' over every
  // pixel at peak Y' without a neutrality test lets one saturated highlight —
  // brighter than the actual white patch — become "reference white", and the
  // page then reports a white-point error against content whose white is fine.
  // Brightest neutral, with neutrality deciding only between equally bright
  // candidates.
  //
  // Both halves are load-bearing and each was wrong on its own. Ranking purely
  // by brightness let a tinted highlight inside a loose tolerance beat a correct
  // DCI white, and the page then failed the white it should have passed. Ranking
  // purely by neutrality was worse: on a black-to-white ramp the most neutral
  // pixel is a dark one, so reference white read 0.09 cd/m2 instead of 41.75.
  // So: take the brightest neutral, then among candidates within a narrow
  // luminance band of it, prefer the most neutral.
  //
  // Chromaticity is X/(X+Y+Z), Y/(X+Y+Z) with no matrix anywhere. That is only
  // valid because the decoded samples ARE tristimulus X, Y, Z — the caller has
  // already checked `space.samplesAreTristimulus`. Routing this through an
  // identity matrix instead would be exact but would triple the per-pixel cost
  // in a loop that runs twice, and is one edit from becoming non-identity.
  const chromaticityOf = (base) => {
    const X = luminanceFromCode(samples[base], maxCode, space);
    const Y = luminanceFromCode(samples[base + 1], maxCode, space);
    const Z = luminanceFromCode(samples[base + 2], maxCode, space);
    const sum = X + Y + Z;
    return sum > 0 ? Math.hypot(X / sum - whiteX, Y / sum - whiteY) : Infinity;
  };

  let brightestNeutralY = -Infinity;
  for (let i = 0; i < pixels; i++) {
    const base = i * components;
    const y = samples[base + 1];
    if (y <= brightestNeutralY) {
      continue;
    }
    if (chromaticityOf(base) <= neutralTolerance) {
      brightestNeutralY = y;
    }
  }

  if (brightestNeutralY === -Infinity) {
    // No neutral sample anywhere in the frame. Report the fact rather than
    // inventing a white point from whatever happened to be brightest.
    return { neutralFound: false, codeValues: null, pixelCount: 0, luminance: null, x: null, y: null };
  }

  // The band is in LUMINANCE, not code value. ST 428-1 is a 2.6 power law, so
  // 2% of full-scale code value is about 2.5 cd/m2 near white — wide enough for
  // a slightly more neutral CV 3879 sample to displace a valid 48 cd/m2 white at
  // CV 3960 and report 45.49.
  const brightestLuminance = luminanceFromCode(brightestNeutralY, maxCode, space);
  const floor = brightestLuminance * space.neutralLuminanceFloor;
  let best = null;
  for (let i = 0; i < pixels; i++) {
    const base = i * components;
    const y = samples[base + 1];
    if (y > brightestNeutralY || luminanceFromCode(y, maxCode, space) < floor) {
      continue;
    }
    const distance = chromaticityOf(base);
    if (distance > neutralTolerance) {
      continue;
    }
    if (!best || distance < best.distance) {
      best = { y, distance };
    }
  }

  if (!best) {
    // No neutral sample anywhere in the frame. Report the fact rather than
    // inventing a white point from whatever happened to be brightest.
    return { neutralFound: false, codeValues: null, pixelCount: 0, luminance: null, x: null, y: null };
  }

  // Average across every pixel sharing that peak neutral, so a large flat patch
  // is measured rather than one arbitrary pixel.
  let sumX = 0;
  let sumZ = 0;
  let count = 0;
  for (let i = 0; i < pixels; i++) {
    const base = i * components;
    if (samples[base + 1] !== best.y) {
      continue;
    }
    const X = luminanceFromCode(samples[base], maxCode, space);
    const Y = luminanceFromCode(best.y, maxCode, space);
    const Z = luminanceFromCode(samples[base + 2], maxCode, space);
    const sum = X + Y + Z;
    if (sum <= 0 || Math.hypot(X / sum - whiteX, Y / sum - whiteY) > neutralTolerance) {
      continue;
    }
    sumX += samples[base];
    sumZ += samples[base + 2];
    count += 1;
  }

  const codeValues = [Math.round(sumX / count), best.y, Math.round(sumZ / count)];
  const X = luminanceFromCode(codeValues[0], maxCode, space);
  const Y = luminanceFromCode(codeValues[1], maxCode, space);
  const Z = luminanceFromCode(codeValues[2], maxCode, space);
  const sum = X + Y + Z;

  return {
    neutralFound: true,
    codeValues,
    pixelCount: count,
    tristimulus: { X, Y, Z },
    luminance: Y,
    x: sum > 0 ? X / sum : 0,
    y: sum > 0 ? Y / sum : 0,
  };
}

function median(sorted) {
  if (!sorted.length) {
    return 0;
  }
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
