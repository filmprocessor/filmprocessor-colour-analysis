/**
 * FilmProcessor Colour Analysis — colour-space profiles.
 *
 * `colour-metrics.js` used to hold the ST 428-1 cinema encoding as a set of file
 * scope constants and two inline `Math.pow` calls. That was correct and is still
 * the default, but it made every measurement in the module implicitly a DCP
 * measurement. This file lifts the space out into frozen descriptors so the same
 * occupancy, plateau and range arithmetic can run over other encodings without
 * a second copy of the measurement code.
 *
 * THE INVARIANT: `DCP_XYZ` is the default everywhere. Every constant below is
 * the same literal the module used before, so `Math.pow(v, space.gamma)` and
 * `Math.pow(v, 2.6)` are the same IEEE-754 double and the same operation. A DCP
 * package must measure bit-identically to what it measured before this file
 * existed. Never replace a literal here with a derived value — `52.37` and
 * `48 * 1.09104...` are different doubles.
 *
 * PROVENANCE. Every transfer constant is taken from ITU-T H.273 (V4) Table 3. Nothing here is reconstructed from memory. Where a figure a profile
 * would need was not in that table it is left `null` rather than guessed, and
 * the measurement that needs it is skipped — a withheld number is a correct
 * report, an invented one is not.
 *
 * Descriptor contract:
 *   decode(signal)     normalised code signal in 0..1 -> luminance
 *   encode(luminance)  luminance -> normalised code signal (>= 0, may exceed 1)
 *   luminanceUnit      'cd/m2' when decode returns absolute luminance,
 *                      'relative' when it returns a display-referred 0..1 value
 *   whiteX / whiteY    null when the space has no verified white point, which
 *                      switches the reference-white measurement off entirely
 *   samplesAreTristimulus
 *                      true only when the decoded samples ARE X, Y, Z, so that
 *                      chromaticity is X/(X+Y+Z) with no matrix. False spaces
 *                      would need an RGB->XYZ matrix that is not published here.
 */

// ── SMPTE ST 428-1 (DCP X'Y'Z') ────────────────────────────────────────────
// CV = INT[ 4095 * ( L * T / 52.37 ) ^ (1/2.6) ], reference luminance
// L = 48 cd/m^2, DCI calibration white x 0.3140 y 0.3510 (SMPTE RP 431-2).
// Design record 3.2: "ST 428-1 transfer | V = (48*Lo/52.37)^(1/2.6); Lo = 1 =>
// 48 cd/m^2. The only 2.6-family code point in H.273".

const ST428_PEAK = 52.37;
const ST428_GAMMA = 2.6;
// Stored, never recomputed as 1 / space.gamma inside a loop. Both evaluate to
// the same double today; keeping it as one binding stops a later edit pairing a
// different gamma with a stale inverse.
const ST428_INVERSE_GAMMA = 1 / 2.6;

export const DCP_XYZ = Object.freeze({
  id: 'st428-xyz',
  label: "ST 428-1 X'Y'Z' (DCP)",
  componentNames: Object.freeze(["X'", "Y'", "Z'"]),
  componentCount: 3,
  scanlineComponent: 1,
  samplesAreTristimulus: true,
  luminanceUnit: 'cd/m2',
  peakLuminance: ST428_PEAK,
  gamma: ST428_GAMMA,
  inverseGamma: ST428_INVERSE_GAMMA,
  referenceLuminance: 48.0,
  whiteX: 0.3140,
  whiteY: 0.3510,
  // The DCI-P3 reference projector primaries, SMPTE RP 431-2 — the same
  // standard this profile already cites for the calibration white point. They
  // are here so a chromaticity plot can draw the gamut a measured white is
  // being judged inside; nothing in the measurement chain reads them. A profile
  // whose primaries are not in the verified table leaves this null and the
  // gamut is not drawn, on the same rule as every other withheld figure.
  primaries: Object.freeze({
    red: Object.freeze({ x: 0.680, y: 0.320 }),
    green: Object.freeze({ x: 0.265, y: 0.690 }),
    blue: Object.freeze({ x: 0.150, y: 0.060 }),
  }),
  neutralTolerance: 0.05,
  neutralLuminanceFloor: 0.98,
  dominantCoverage: 0.99,
  signalLabel: "X'Y'Z'",
  containerStandard: 'ST 428-1',
  whiteLabel: 'DCI white',
  referenceWhiteLabel: 'DCI calibration white',
  referenceWhiteName: 'DCI reference white',
  referenceWhiteStandard: 'SMPTE RP 431-2',
  cicp: Object.freeze({ primaries: 10, transfer: 17, matrix: 0 }),
  decode: (signal) => ST428_PEAK * Math.pow(signal, ST428_GAMMA),
  encode: (luminance) => Math.pow(Math.max(0, luminance / ST428_PEAK), ST428_INVERSE_GAMMA),
});

// ── BT.2100 PQ (SMPTE ST 2084) ─────────────────────────────────────────────
// ITU-T H.273 (V4) Table 3:
//   c1 = 107/128 = 0.8359375     c2 = 2413/128 = 18.8515625
//   c3 = 2392/128 = 18.6875      m  = 2523/32  = 78.84375
//   n  = 1305/8192 = 0.1593017578125         Lo = 1 => 10000 cd/m^2
// Every denominator is a power of two, so the ratios below are exact doubles
// and equal their decimal representations.

const PQ_C1 = 107 / 128;
const PQ_C2 = 2413 / 128;
const PQ_C3 = 2392 / 128;
const PQ_M = 2523 / 32;
const PQ_INVERSE_M = 1 / PQ_M;
const PQ_N = 1305 / 8192;
const PQ_INVERSE_N = 1 / PQ_N;
const PQ_PEAK = 10000;

export const BT2100_PQ = Object.freeze({
  id: 'bt2100-pq',
  label: 'BT.2100 PQ (ST 2084)',
  componentNames: Object.freeze(["R'", "G'", "B'"]),
  componentCount: 3,
  scanlineComponent: 1,
  // Decoded PQ samples are R, G, B display light, not X, Y, Z. Chromaticity
  // would need an RGB->XYZ matrix; the BT.2100 primaries are not in the
  // verified table, so no white point is claimed and no white is measured.
  samplesAreTristimulus: false,
  luminanceUnit: 'cd/m2',
  peakLuminance: PQ_PEAK,
  gamma: null,
  inverseGamma: null,
  referenceLuminance: null,
  whiteX: null,
  whiteY: null,
  // BT.2100 primaries are not in the verified table this file draws from.
  primaries: null,
  neutralTolerance: null,
  neutralLuminanceFloor: null,
  dominantCoverage: 0.99,
  signalLabel: "R'G'B'",
  containerStandard: 'ST 2084',
  whiteLabel: null,
  referenceWhiteLabel: null,
  referenceWhiteName: null,
  referenceWhiteStandard: null,
  cicp: Object.freeze({ primaries: 9, transfer: 16, matrix: null }),
  decode: (signal) => {
    const v = Math.pow(signal, PQ_INVERSE_M);
    const numerator = Math.max(v - PQ_C1, 0);
    const denominator = PQ_C2 - PQ_C3 * v;
    return PQ_PEAK * Math.pow(numerator / denominator, PQ_INVERSE_N);
  },
  encode: (luminance) => {
    const y = Math.pow(Math.max(0, luminance) / PQ_PEAK, PQ_N);
    return Math.pow((PQ_C1 + PQ_C2 * y) / (1 + PQ_C3 * y), PQ_M);
  },
});

// ── BT.2100 HLG ────────────────────────────────────────────────────────────
// ITU-T H.273 (V4) Table 3:
//   a = 0.17883277   b = 0.28466892   c = 0.55991073
// The piecewise form those three constants belong to is pinned by them: the
// OETF is sqrt(3E) below E = 1/12 and a*ln(12E - b) + c above it, and the two
// halves meet only if a*ln(1 - b) + c === sqrt(3/12) === 0.5. That identity
// holds for the values above to within 1e-9 and is asserted by a test, so the
// structure is checked against the verified constants rather than assumed.
//
// HLG is display-referred and carries no absolute luminance of its own. No nit
// figure, reference white or system gamma for HLG appears in the verified
// table, so none is encoded: decode returns relative light in 0..1 and
// luminanceUnit says so.

const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;
const HLG_BREAK_SIGNAL = 0.5;

export const BT2100_HLG = Object.freeze({
  id: 'bt2100-hlg',
  label: 'BT.2100 HLG',
  componentNames: Object.freeze(["R'", "G'", "B'"]),
  componentCount: 3,
  scanlineComponent: 1,
  samplesAreTristimulus: false,
  luminanceUnit: 'relative',
  peakLuminance: null,
  gamma: null,
  inverseGamma: null,
  referenceLuminance: null,
  whiteX: null,
  whiteY: null,
  // BT.2100 primaries are not in the verified table this file draws from.
  primaries: null,
  neutralTolerance: null,
  neutralLuminanceFloor: null,
  dominantCoverage: 0.99,
  signalLabel: "R'G'B'",
  containerStandard: 'BT.2100',
  whiteLabel: null,
  referenceWhiteLabel: null,
  referenceWhiteName: null,
  referenceWhiteStandard: null,
  cicp: Object.freeze({ primaries: 9, transfer: 18, matrix: null }),
  hlgA: HLG_A,
  hlgB: HLG_B,
  hlgC: HLG_C,
  decode: (signal) =>
    signal <= HLG_BREAK_SIGNAL
      ? (signal * signal) / 3
      : (Math.exp((signal - HLG_C) / HLG_A) + HLG_B) / 12,
  encode: (relative) => {
    const e = Math.max(0, relative);
    return e <= 1 / 12 ? Math.sqrt(3 * e) : HLG_A * Math.log(12 * e - HLG_B) + HLG_C;
  },
});

/**
 * Every profile this build can measure, keyed by id.
 *
 * Rec.709 is deliberately absent. Its OETF constants are not in the verified
 * table this file draws from, and a transfer curve guessed from memory would
 * turn a measurement into an assertion. It belongs here once its constants have
 * been verified from a primary source.
 */
export const COLOUR_SPACES = Object.freeze({
  [DCP_XYZ.id]: DCP_XYZ,
  [BT2100_PQ.id]: BT2100_PQ,
  [BT2100_HLG.id]: BT2100_HLG,
});

/**
 * Resolve a profile id to its descriptor, falling back to the DCP space.
 *
 * The fallback is what keeps the invariant: a caller that names nothing, or
 * names something this build does not know, measures exactly as it did before
 * profiles existed rather than failing or picking something else.
 */
export function resolveColourSpace(id) {
  if (!id) {
    return DCP_XYZ;
  }
  if (typeof id === 'object') {
    return id;
  }
  return COLOUR_SPACES[id] || DCP_XYZ;
}
