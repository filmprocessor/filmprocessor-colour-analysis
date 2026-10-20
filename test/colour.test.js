/**
 * Colour measurement regressions.
 *
 * These pin the numbers the page reports. A QC tool whose figures drift is worse
 * than no QC tool, because a wrong number still looks like a measurement — so
 * each case here is one that produced a wrong answer at some point during
 * development, plus the analytic anchors that prove the chains are right rather
 * than merely stable.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BT2100_HLG,
  BT2100_PQ,
  COLOUR_SPACES,
  DCP_XYZ,
  codeFromLuminance,
  createAccumulator,
  finalizeAccumulator,
  foldFrame,
  luminanceFromCode,
  measureFrame,
  resolveColourSpace,
} from "../src/index.js";

// ── SMPTE ST 428-1 transfer ────────────────────────────────────────────────

test("ST 428-1 decode and encode are inverses at the DCI anchor", () => {
  // DCI reference white is 48 cd/m2 at 12-bit code value 3960 (RP 431-2).
  assert.equal(codeFromLuminance(48, 4095), 3960);
  assert.ok(Math.abs(luminanceFromCode(3960, 4095) - 48) < 0.01);
  assert.equal(luminanceFromCode(0, 4095), 0);
});

// ── Reference white ────────────────────────────────────────────────────────

const WIDTH = 64;
const HEIGHT = 8;

function frameOf(fill) {
  const samples = new Int32Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    fill(samples, i * 3, i);
  }
  return samples;
}

test("a correct DCI white beats a brighter tinted highlight", () => {
  // DCI white is CV 3794 / 3960 / 3890. The highlight is brighter in Y' but
  // clearly tinted, so neutrality must decide, not brightness.
  const samples = frameOf((s, at) => {
    s[at] = 3794;
    s[at + 1] = 3960;
    s[at + 2] = 3890;
  });
  samples[0] = 3900;
  samples[1] = 4000;
  samples[2] = 3200;

  const white = measureFrame(samples, WIDTH, HEIGHT, 3, 12).referenceWhite;
  assert.equal(white.neutralFound, true);
  assert.equal(white.codeValues[1], 3960, "the tinted highlight was chosen as reference white");
  assert.ok(Math.abs(white.x - 0.314) < 0.002 && Math.abs(white.y - 0.351) < 0.002);
});

test("reference white is the brightest neutral, not the most neutral", () => {
  // On a black-to-white ramp the most neutral pixel is a dark one. Ranking by
  // neutrality alone reported reference white as 0.09 cd/m2 instead of 41.75.
  const samples = new Int32Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const at = (y * WIDTH + x) * 3;
      const level = Math.round((x / (WIDTH - 1)) * 3900);
      // Slightly off-neutral at the top, exactly neutral near black — the shape
      // that made "most neutral" pick the wrong end.
      samples[at] = Math.round(level * 0.958);
      samples[at + 1] = level;
      samples[at + 2] = Math.round(level * 0.995);
    }
  }

  const white = measureFrame(samples, WIDTH, HEIGHT, 3, 12).referenceWhite;
  assert.equal(white.neutralFound, true);
  assert.ok(
    white.codeValues[1] > 3500,
    `expected the bright end, got Y' CV ${white.codeValues[1]}`,
  );
  assert.ok(white.luminance > 30, `expected a bright reference white, got ${white.luminance} cd/m2`);
});

test("a valid 48 cd/m2 white beats a slightly more neutral darker sample", () => {
  // The tie-break band must be in luminance. Expressed in code values, 2% of
  // full scale is ~2.5 cd/m2 near white, so a marginally more neutral CV 3879
  // displaced a valid CV 3960 white and the page reported 45.49 cd/m2.
  const samples = frameOf((s, at) => {
    s[at] = 3794;
    s[at + 1] = 3960;
    s[at + 2] = 3890;
  });
  // One pixel: darker, but closer to DCI white than the 3794/3960/3890 anchor.
  samples[0] = 3716;
  samples[1] = 3879;
  samples[2] = 3810;

  const white = measureFrame(samples, WIDTH, HEIGHT, 3, 12).referenceWhite;
  assert.equal(white.codeValues[1], 3960, `a darker sample won: Y' CV ${white.codeValues[1]}`);
  assert.ok(
    Math.abs(white.luminance - 48) < 0.05,
    `expected ~48 cd/m2, got ${white.luminance}`,
  );
});

test("a frame with no neutral withholds the white point instead of inventing one", () => {
  const samples = frameOf((s, at) => {
    s[at] = 3000;
    s[at + 1] = 4095;
    s[at + 2] = 500;
  });
  const accumulator = createAccumulator();
  foldFrame(accumulator, { ...measureFrame(samples, WIDTH, HEIGHT, 3, 12), frameIndex: 0 });
  const aggregate = finalizeAccumulator(accumulator);

  assert.equal(aggregate.referenceWhite, null);
});

test("ordinary programme peak neutrals retain their measured luminance", () => {
  const samples = frameOf((s, at) => {
    s[at] = 2874;
    s[at + 1] = 3000;
    s[at + 2] = 2947;
  });
  const accumulator = createAccumulator();
  foldFrame(accumulator, { ...measureFrame(samples, WIDTH, HEIGHT, 3, 12), frameIndex: 0 });
  const aggregate = finalizeAccumulator(accumulator);

  assert.ok(aggregate.referenceWhite.luminance < 30);
});

test("ordinary limited-palette content keeps code-value occupancy descriptive", () => {
  const samples = frameOf((s, at) => {
    s[at] = 1800;
    s[at + 1] = 1900;
    s[at + 2] = 1850;
  });
  const accumulator = createAccumulator();
  foldFrame(accumulator, { ...measureFrame(samples, WIDTH, HEIGHT, 3, 12), frameIndex: 0 });
  const aggregate = finalizeAccumulator(accumulator);

  assert.deepEqual(aggregate.componentMetrics.map((component) => component.distinctCodeValues), [1, 1, 1]);
});

test("ordinary hard programme edges keep gaps and scanline plateaus descriptive", () => {
  const samples = frameOf((s, at, pixel) => {
    const white = pixel % WIDTH >= WIDTH / 2;
    s[at] = white ? 3794 : 0;
    s[at + 1] = white ? 3960 : 0;
    s[at + 2] = white ? 3890 : 0;
  });
  const accumulator = createAccumulator();
  foldFrame(accumulator, { ...measureFrame(samples, WIDTH, HEIGHT, 3, 12), frameIndex: 0 });
  const aggregate = finalizeAccumulator(accumulator);

  assert.deepEqual(aggregate.componentMetrics.map((component) => component.distinctCodeValues), [2, 2, 2]);
  assert.ok(aggregate.componentMetrics.every((component) => component.largestGap > 3000));
  assert.equal(aggregate.gradientProfile.plateaus, 2);
});

// ── Accumulator ────────────────────────────────────────────────────────────

test("the aggregate histogram holds counts past the 32-bit boundary", () => {
  // A Uint32Array wrapped here, and a bin landing on an exact multiple of 2^32
  // read as unoccupied — deleting a code value from the reported distribution.
  const pixels = 1024;
  const perFrame = 1024;
  const frames = 4096;
  const build = () => ({
    width: 32,
    height: 32,
    components: 3,
    bitDepth: 12,
    maxCode: 4095,
    histograms: [0, 1, 2].map(() => {
      const h = new Uint32Array(4096);
      h[100] = perFrame;
      return h;
    }),
    componentMetrics: [0, 1, 2].map(() => ({
      name: "c",
      min: 100,
      max: 100,
      mean: 100,
      belowRange: 0,
      aboveRange: 0,
      widestPlateau: 1,
    })),
    referenceWhite: null,
    gradientProfile: null,
    frameIndex: 0,
  });

  const accumulator = createAccumulator();
  for (let i = 0; i < frames; i++) foldFrame(accumulator, build());
  const aggregate = finalizeAccumulator(accumulator);

  assert.equal(aggregate.componentMetrics[1].histogram[100], frames * perFrame);
  assert.equal(aggregate.componentMetrics[1].distinctCodeValues, 1);
  assert.equal(pixels, 1024);
});

test("frames of a different container are excluded and counted, not folded", () => {
  const make = (bitDepth) => ({
    width: 32,
    height: 32,
    components: 3,
    bitDepth,
    maxCode: (1 << bitDepth) - 1,
    histograms: [0, 1, 2].map(() => new Uint32Array(1 << bitDepth)),
    componentMetrics: [0, 1, 2].map(() => ({
      name: "c",
      min: 0,
      max: 0,
      mean: 0,
      belowRange: 0,
      aboveRange: 0,
      widestPlateau: 0,
    })),
    referenceWhite: null,
    gradientProfile: null,
    frameIndex: 0,
  });

  const accumulator = createAccumulator();
  foldFrame(accumulator, make(12));
  foldFrame(accumulator, make(16));
  const aggregate = finalizeAccumulator(accumulator);

  assert.equal(aggregate.frameCount, 1);
  assert.equal(aggregate.mismatchedFrames, 1);
  assert.equal(aggregate.bitDepth, 12);
});

// ── Colour-space profiles ──────────────────────────────────────────────────
//
// The measurement code is parameterised by a colour-space descriptor, and the
// ST 428-1 descriptor is the default of every entry point. The whole point of
// that arrangement is that a DCP keeps measuring EXACTLY as it did before the
// parameterisation existed, so these tests pin identity rather than tolerance.
// The literals below were captured from the unparameterised module and must
// only ever change if the transfer itself is deliberately corrected.

const ST428_LUMINANCE_GOLDEN = [
  [0, 0],
  [1, 2.1243321314561296e-8],
  [16, 0.000028703468058269775],
  [64, 0.001055092049319822],
  [255, 0.03839077569030523],
  [1024, 1.425615161007196],
  [2048, 8.643314068027983],
  [3794, 42.941327587099025],
  [3890, 45.823829617476584],
  [3960, 47.99874712433684],
  [4094, 52.33675570191348],
  [4095, 52.37],
];

const ST428_CODE_GOLDEN = [
  [0, 0],
  [0.01, 152],
  [1, 893],
  [12, 2323],
  [24, 3033],
  [48, 3960],
  [52.37, 4095],
];

test("the ST 428-1 transfer is bit-identical after parameterisation", () => {
  // The DCI anchor test above allows 0.01 cd/m2, which a transfer shifted by
  // 1e-6 would still satisfy. These are strictEqual on the exact doubles.
  for (const [codeValue, luminance] of ST428_LUMINANCE_GOLDEN) {
    assert.strictEqual(luminanceFromCode(codeValue), luminance, `CV ${codeValue}`);
    assert.strictEqual(luminanceFromCode(codeValue, 4095, DCP_XYZ), luminance, `CV ${codeValue} explicit`);
  }
  for (const [luminance, codeValue] of ST428_CODE_GOLDEN) {
    assert.strictEqual(codeFromLuminance(luminance), codeValue, `${luminance} cd/m2`);
    assert.strictEqual(codeFromLuminance(luminance, 4095, DCP_XYZ), codeValue, `${luminance} cd/m2 explicit`);
  }
});

test("the default colour space is the DCP space", () => {
  const fixtures = {
    // The three frames the reference-white and plateau regressions above use.
    tintedHighlight: (() => {
      const samples = frameOf((s, at) => {
        s[at] = 3794;
        s[at + 1] = 3960;
        s[at + 2] = 3890;
      });
      samples[0] = 3900;
      samples[1] = 4000;
      samples[2] = 3200;
      return samples;
    })(),
    darkerNeutral: (() => {
      const samples = frameOf((s, at) => {
        s[at] = 3794;
        s[at + 1] = 3960;
        s[at + 2] = 3890;
      });
      samples[0] = 3716;
      samples[1] = 3879;
      samples[2] = 3810;
      return samples;
    })(),
    hardEdges: frameOf((s, at, pixel) => {
      const white = pixel % WIDTH >= WIDTH / 2;
      s[at] = white ? 3794 : 0;
      s[at + 1] = white ? 3960 : 0;
      s[at + 2] = white ? 3890 : 0;
    }),
  };

  for (const [name, samples] of Object.entries(fixtures)) {
    assert.deepStrictEqual(
      measureFrame(samples, WIDTH, HEIGHT, 3, 12),
      measureFrame(samples, WIDTH, HEIGHT, 3, 12, { space: DCP_XYZ }),
      `${name} measured differently with the space named explicitly`,
    );
  }

  assert.equal(measureFrame(fixtures.hardEdges, WIDTH, HEIGHT, 3, 12).colourSpace, "st428-xyz");
  assert.equal(resolveColourSpace(undefined), DCP_XYZ);
  assert.equal(resolveColourSpace("no-such-space"), DCP_XYZ);
  assert.equal(resolveColourSpace("bt2100-pq"), BT2100_PQ);
});

test("a colour-space descriptor is frozen and measurement does not mutate it", () => {
  const snapshot = (space) =>
    JSON.stringify(
      Object.entries(space)
        .filter(([, value]) => typeof value !== "function")
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );

  for (const space of Object.values(COLOUR_SPACES)) {
    assert.ok(Object.isFrozen(space), `${space.id} is not frozen`);
    assert.ok(Object.isFrozen(space.componentNames), `${space.id} component names are not frozen`);

    const before = snapshot(space);
    const samples = frameOf((s, at) => {
      s[at] = 1800;
      s[at + 1] = 1900;
      s[at + 2] = 1850;
    });
    measureFrame(samples, WIDTH, HEIGHT, 3, 12, { space });
    assert.equal(snapshot(space), before, `${space.id} was mutated by a measurement`);
  }
});

test("every profile round-trips code value to luminance and back", () => {
  for (const space of Object.values(COLOUR_SPACES)) {
    for (const maxCode of [255, 1023, 4095, 65535]) {
      const codeValues = [
        0,
        1,
        2,
        7,
        Math.round(maxCode * 0.25),
        Math.round(maxCode * 0.5),
        Math.round(maxCode * 0.75),
        maxCode - 1,
        maxCode,
      ];
      for (const codeValue of codeValues) {
        const luminance = luminanceFromCode(codeValue, maxCode, space);
        assert.ok(Number.isFinite(luminance), `${space.id} CV ${codeValue} decoded to ${luminance}`);
        assert.ok(luminance >= 0, `${space.id} CV ${codeValue} decoded negative`);
        assert.equal(
          codeFromLuminance(luminance, maxCode, space),
          codeValue,
          `${space.id} ${maxCode}-scale CV ${codeValue} did not round-trip`,
        );
      }
    }
  }
});

test("the PQ profile reaches 10000 cd/m2 at full scale and 0 at black", () => {
  // ST 2084 via the H.273 Table 3 constants: Lo = 1 corresponds to 10000 cd/m2,
  // and the EOTF's max(V^(1/m) - c1, 0) term makes the bottom of the range an
  // exact zero rather than a very small positive number.
  assert.strictEqual(luminanceFromCode(0, 4095, BT2100_PQ), 0);
  assert.strictEqual(luminanceFromCode(4095, 4095, BT2100_PQ), 10000);
  assert.strictEqual(codeFromLuminance(10000, 4095, BT2100_PQ), 4095);
  assert.ok(Math.abs(luminanceFromCode(2081, 4095, BT2100_PQ) - 100) < 0.5);
  assert.equal(BT2100_PQ.cicp.transfer, 16);
  assert.equal(BT2100_PQ.luminanceUnit, "cd/m2");
});

test("the HLG piecewise form is the one its published constants belong to", () => {
  // a, b and c are only meaningful inside sqrt(3E) below E = 1/12 and
  // a*ln(12E - b) + c above it: the two halves meet at E = 1/12 only if
  // a*ln(1 - b) + c === sqrt(3/12) === 0.5. If the constants and the piecewise
  // structure ever disagree, this is where it shows.
  assert.ok(
    Math.abs(BT2100_HLG.hlgA * Math.log(1 - BT2100_HLG.hlgB) + BT2100_HLG.hlgC - 0.5) < 1e-8,
    "the HLG constants do not satisfy the OETF continuity condition",
  );
  assert.strictEqual(BT2100_HLG.decode(0), 0);
  assert.strictEqual(BT2100_HLG.decode(0.5), 1 / 12);
  assert.ok(Math.abs(BT2100_HLG.decode(1) - 1) < 1e-7);
  // HLG carries no absolute luminance, so none is claimed.
  assert.equal(BT2100_HLG.luminanceUnit, "relative");
  assert.equal(BT2100_HLG.peakLuminance, null);
  assert.equal(BT2100_HLG.cicp.transfer, 18);
});

test("a profile with no verified white point withholds the white instead of borrowing DCI's", () => {
  const samples = frameOf((s, at) => {
    s[at] = 3000;
    s[at + 1] = 4095;
    s[at + 2] = 500;
  });

  for (const space of [BT2100_PQ, BT2100_HLG]) {
    const frame = measureFrame(samples, WIDTH, HEIGHT, 3, 12, { space });
    assert.equal(frame.colourSpace, space.id);
    assert.equal(frame.referenceWhite, null, `${space.id} invented a white point`);
    assert.deepEqual(
      frame.componentMetrics.map((component) => component.name),
      ["R'", "G'", "B'"],
    );
    assert.equal(frame.gradientProfile.component, "G'");

    const accumulator = createAccumulator();
    foldFrame(accumulator, { ...frame, frameIndex: 0 });
    const aggregate = finalizeAccumulator(accumulator);

    assert.equal(aggregate.colourSpace, space.id);
  }
});

test("frames measured under different colour spaces are excluded, not summed", () => {
  const samples = frameOf((s, at) => {
    s[at] = 1800;
    s[at + 1] = 1900;
    s[at + 2] = 1850;
  });

  const accumulator = createAccumulator();
  foldFrame(accumulator, { ...measureFrame(samples, WIDTH, HEIGHT, 3, 12), frameIndex: 0 });
  foldFrame(accumulator, {
    ...measureFrame(samples, WIDTH, HEIGHT, 3, 12, { space: BT2100_PQ }),
    frameIndex: 1,
  });
  const aggregate = finalizeAccumulator(accumulator);

  assert.equal(aggregate.frameCount, 1);
  assert.equal(aggregate.mismatchedFrames, 1);
  assert.equal(aggregate.colourSpace, "st428-xyz");
});


test("invalid image extents and non-integer samples are rejected", () => {
  assert.throws(() => measureFrame(new DataView(new ArrayBuffer(12)), 1, 1, 3, 12), TypeError);
  assert.throws(() => measureFrame(new Int32Array(2), 1, 1, 3, 12), TypeError);
  assert.throws(() => measureFrame(new Int32Array(3), 1, 1, 3, 32), TypeError);
  assert.throws(() => measureFrame(new Float32Array([NaN, 0, 0]), 1, 1, 3, 12), TypeError);
});
