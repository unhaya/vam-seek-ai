/**
 * ColorEstimator - Level 2: Statistical Color Recovery
 *
 * After ChannelSeparator extracts grayscale frames, ColorEstimator
 * attempts to recover the missing two color channels per frame.
 *
 * Known information per frame:
 *   Past frame:    R channel exact, G and B unknown
 *   Present frame: G channel exact, R and B unknown
 *   Future frame:  B channel exact, R and G unknown
 *
 * Recovery strategies (in priority order):
 *   1. Static regions: all channels known from VAM-RGB cell directly
 *   2. Cross-channel ratio: use global R:G:B ratio from static regions
 *   3. Fallback: replicate known channel (grayscale)
 *
 * No AI. Statistical estimation only.
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

class ColorEstimator {
  /**
   * @param {object} [options]
   * @param {number} [options.staticThreshold=0.04] - Channel divergence threshold for static detection
   */
  constructor(options = {}) {
    this.staticThreshold = options.staticThreshold ?? 0.04;
  }

  /**
   * Estimate full-color frame from a single known channel.
   *
   * @param {object} grayscaleFrame - { data: Uint8ClampedArray, width, height } from ChannelSeparator
   * @param {'R'|'G'|'B'} knownChannel - Which channel this frame preserves
   * @param {object} vamrgbCell - { data: Uint8ClampedArray, width, height } original VAM-RGB cell
   * @returns {{
   *   frame: { data: Uint8ClampedArray, width: number, height: number },
   *   quality: Float32Array
   * }}
   *   frame: estimated full-color frame
   *   quality: per-pixel quality score (1.0 = from static region, 0.5 = ratio-estimated, 0.0 = grayscale fallback)
   */
  estimate(grayscaleFrame, knownChannel, vamrgbCell) {
    const { width, height } = vamrgbCell;
    const pixelCount = width * height;
    const bufferSize = pixelCount * 4;
    const thresholdAbs = this.staticThreshold * 255;

    const outData = new Uint8ClampedArray(bufferSize);
    const quality = new Float32Array(pixelCount);

    // Step 1: Compute global channel ratios from static regions
    const ratios = this._computeChannelRatios(vamrgbCell, thresholdAbs);

    // Step 2: Per-pixel estimation
    for (let i = 0; i < bufferSize; i += 4) {
      const pixelIdx = i / 4;

      const cellR = vamrgbCell.data[i];
      const cellG = vamrgbCell.data[i + 1];
      const cellB = vamrgbCell.data[i + 2];

      const maxDiv = Math.max(
        Math.abs(cellR - cellG),
        Math.abs(cellG - cellB),
        Math.abs(cellR - cellB)
      );

      const isStatic = maxDiv <= thresholdAbs;

      if (isStatic) {
        // Strategy 1: Static region — full color known
        outData[i] = cellR;
        outData[i + 1] = cellG;
        outData[i + 2] = cellB;
        outData[i + 3] = 255;
        quality[pixelIdx] = 1.0;
      } else if (ratios) {
        // Strategy 2: Use global ratio to estimate missing channels
        const known = grayscaleFrame.data[i]; // known channel value (replicated as grayscale)
        const estimated = this._applyRatio(known, knownChannel, ratios);
        outData[i] = estimated.r;
        outData[i + 1] = estimated.g;
        outData[i + 2] = estimated.b;
        outData[i + 3] = 255;
        quality[pixelIdx] = 0.5;
      } else {
        // Strategy 3: No ratio data — grayscale fallback
        const known = grayscaleFrame.data[i];
        outData[i] = known;
        outData[i + 1] = known;
        outData[i + 2] = known;
        outData[i + 3] = 255;
        quality[pixelIdx] = 0.0;
      }
    }

    return {
      frame: { data: outData, width, height },
      quality
    };
  }

  /**
   * Estimate all three temporal frames at once.
   *
   * @param {object} separated - Output from ChannelSeparator.separate()
   * @param {object} vamrgbCell - Original VAM-RGB cell
   * @returns {{
   *   past:    { frame, quality },
   *   present: { frame, quality },
   *   future:  { frame, quality }
   * }}
   */
  estimateAll(separated, vamrgbCell) {
    return {
      past: this.estimate(separated.past, 'R', vamrgbCell),
      present: this.estimate(separated.present, 'G', vamrgbCell),
      future: this.estimate(separated.future, 'B', vamrgbCell)
    };
  }

  /**
   * Compute average R:G:B ratios from static (R≈G≈B) regions.
   *
   * Returns null if no static pixels found (entire image is motion).
   *
   * @param {object} vamrgbCell
   * @param {number} thresholdAbs
   * @returns {object|null} { rToG, rToB, gToR, gToB, bToR, bToG, meanR, meanG, meanB }
   * @private
   */
  _computeChannelRatios(vamrgbCell, thresholdAbs) {
    const { data } = vamrgbCell;
    let sumR = 0, sumG = 0, sumB = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const maxDiv = Math.max(
        Math.abs(r - g),
        Math.abs(g - b),
        Math.abs(r - b)
      );

      if (maxDiv <= thresholdAbs) {
        sumR += r;
        sumG += g;
        sumB += b;
        count++;
      }
    }

    if (count === 0) return null;

    const meanR = sumR / count;
    const meanG = sumG / count;
    const meanB = sumB / count;

    // Avoid division by zero: if a mean channel is 0, ratio is undefined
    return {
      meanR, meanG, meanB,
      rToG: meanR > 0 ? meanG / meanR : 1,
      rToB: meanR > 0 ? meanB / meanR : 1,
      gToR: meanG > 0 ? meanR / meanG : 1,
      gToB: meanG > 0 ? meanB / meanG : 1,
      bToR: meanB > 0 ? meanR / meanB : 1,
      bToG: meanB > 0 ? meanG / meanB : 1
    };
  }

  /**
   * Apply channel ratios to estimate missing channels.
   *
   * @param {number} knownValue - The known channel's pixel value (0-255)
   * @param {'R'|'G'|'B'} knownChannel
   * @param {object} ratios - From _computeChannelRatios
   * @returns {{ r: number, g: number, b: number }}
   * @private
   */
  _applyRatio(knownValue, knownChannel, ratios) {
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));

    switch (knownChannel) {
      case 'R':
        return {
          r: knownValue,
          g: clamp(knownValue * ratios.rToG),
          b: clamp(knownValue * ratios.rToB)
        };
      case 'G':
        return {
          r: clamp(knownValue * ratios.gToR),
          g: knownValue,
          b: clamp(knownValue * ratios.gToB)
        };
      case 'B':
        return {
          r: clamp(knownValue * ratios.bToR),
          g: clamp(knownValue * ratios.bToG),
          b: knownValue
        };
      default:
        return { r: knownValue, g: knownValue, b: knownValue };
    }
  }
}

// Support both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColorEstimator;
}
if (typeof window !== 'undefined') {
  window.ColorEstimator = ColorEstimator;
}
