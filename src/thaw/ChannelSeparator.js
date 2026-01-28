/**
 * ChannelSeparator - Level 1: Mathematical Inverse of _mergeRGB()
 *
 * _mergeRGB() freezes three temporal frames into one RGB image:
 *   output.R = past.R
 *   output.G = present.G
 *   output.B = future.B
 *
 * ChannelSeparator thaws them back:
 *   past    = (R, R, R)    grayscale from Red channel
 *   present = (G, G, G)    grayscale from Green channel
 *   future  = (B, B, B)    grayscale from Blue channel
 *
 * No interpretation. No AI. Pure computation.
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

class ChannelSeparator {
  /**
   * Separate a VAM-RGB cell into three temporal grayscale frames.
   *
   * Each output frame contains one channel replicated across R, G, B.
   * This is the exact inverse of _mergeRGB(): no information is added or lost.
   *
   * @param {object} vamrgbCell - { data: Uint8ClampedArray, width: number, height: number }
   * @returns {{
   *   past:    { data: Uint8ClampedArray, width: number, height: number },
   *   present: { data: Uint8ClampedArray, width: number, height: number },
   *   future:  { data: Uint8ClampedArray, width: number, height: number },
   *   confidenceMap: Float32Array
   * }}
   */
  separate(vamrgbCell) {
    const { data, width, height } = vamrgbCell;
    const pixelCount = width * height;
    const bufferSize = pixelCount * 4;

    const pastData = new Uint8ClampedArray(bufferSize);
    const presentData = new Uint8ClampedArray(bufferSize);
    const futureData = new Uint8ClampedArray(bufferSize);
    const confidenceMap = new Float32Array(pixelCount);

    for (let i = 0; i < bufferSize; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Past frame: R channel as grayscale
      pastData[i] = r;
      pastData[i + 1] = r;
      pastData[i + 2] = r;
      pastData[i + 3] = 255;

      // Present frame: G channel as grayscale
      presentData[i] = g;
      presentData[i + 1] = g;
      presentData[i + 2] = g;
      presentData[i + 3] = 255;

      // Future frame: B channel as grayscale
      futureData[i] = b;
      futureData[i + 1] = b;
      futureData[i + 2] = b;
      futureData[i + 3] = 255;

      // Confidence: how static this pixel is
      // Static pixel: R ≈ G ≈ B → confidence → 1.0
      // Moving pixel: R ≠ G ≠ B → confidence → 0.0
      const maxDiv = Math.max(
        Math.abs(r - g),
        Math.abs(g - b),
        Math.abs(r - b)
      );
      const pixelIdx = i / 4;
      confidenceMap[pixelIdx] = 1.0 - (maxDiv / 255);
    }

    return {
      past: { data: pastData, width, height },
      present: { data: presentData, width, height },
      future: { data: futureData, width, height },
      confidenceMap
    };
  }

  /**
   * Extract original color from static regions.
   *
   * Where R ≈ G ≈ B (no motion), the original color is preserved intact
   * because all three temporal frames show the same static content.
   * In these regions, the VAM-RGB cell IS the original color.
   *
   * Where R ≠ G ≠ B (motion), the color is a temporal composite
   * and cannot be trusted as original color. These pixels are masked out.
   *
   * @param {object} vamrgbCell - { data: Uint8ClampedArray, width: number, height: number }
   * @param {number} [threshold=0.04] - Max channel divergence (0-1) to consider static.
   *                                     0.04 ≈ 10/255, tolerates compression noise.
   * @returns {{
   *   colorFrame: { data: Uint8ClampedArray, width: number, height: number },
   *   mask: Uint8Array
   * }}
   */
  extractStaticColor(vamrgbCell, threshold = 0.04) {
    const { data, width, height } = vamrgbCell;
    const pixelCount = width * height;
    const bufferSize = pixelCount * 4;
    const thresholdAbs = threshold * 255;

    const colorData = new Uint8ClampedArray(bufferSize);
    const mask = new Uint8Array(pixelCount);

    for (let i = 0; i < bufferSize; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const pixelIdx = i / 4;

      const maxDiv = Math.max(
        Math.abs(r - g),
        Math.abs(g - b),
        Math.abs(r - b)
      );

      if (maxDiv <= thresholdAbs) {
        // Static region: original color preserved
        colorData[i] = r;
        colorData[i + 1] = g;
        colorData[i + 2] = b;
        colorData[i + 3] = 255;
        mask[pixelIdx] = 1;
      } else {
        // Motion region: masked out (transparent black)
        colorData[i] = 0;
        colorData[i + 1] = 0;
        colorData[i + 2] = 0;
        colorData[i + 3] = 0;
        mask[pixelIdx] = 0;
      }
    }

    return {
      colorFrame: { data: colorData, width, height },
      mask
    };
  }

  /**
   * Compute per-pixel motion vectors from channel displacement.
   *
   * At each pixel, the difference between R (past) and B (future)
   * indicates local temporal change. This is NOT a full optical flow —
   * it's the per-pixel version of PhysicsAnalyzer's directional fringe.
   *
   * @param {object} vamrgbCell - { data: Uint8ClampedArray, width: number, height: number }
   * @returns {Float32Array} Per-pixel signed displacement (B - R) / 255, range [-1, 1]
   */
  computeTemporalDelta(vamrgbCell) {
    const { data, width, height } = vamrgbCell;
    const pixelCount = width * height;
    const delta = new Float32Array(pixelCount);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const b = data[i + 2];
      delta[i / 4] = (b - r) / 255;
    }

    return delta;
  }
}

// Support both Node.js (tests, main process) and browser (renderer)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChannelSeparator;
}
if (typeof window !== 'undefined') {
  window.ChannelSeparator = ChannelSeparator;
}
