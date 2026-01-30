/**
 * PhantomValidator - Temporal Buffer for ψ4.0
 *
 * Implements Project τ concepts within ψ4.0:
 * - Delta Calculator: Extract Δ(R→G) motion vector
 * - Future Projector: Generate Phantom(t+k) = G + k×Δ
 * - Verification: Compare Phantom with actual future
 *
 * Core Formula:
 *   Δ = G - R (motion per 0.5s)
 *   Phantom(k) = G + k×Δ = (1+k)G - kR
 *
 * Where:
 *   R = Past frame (T-0.5s)
 *   G = Present frame (T)
 *   B = Future frame (T+0.5s) — Ground Truth for k=1
 *   k = frames ahead (each frame = 0.5s stride)
 *
 * Examples:
 *   k=1: Phantom = 2G - R (T+0.5s)
 *   k=7: Phantom = 8G - 7R (T+3.5s)
 *
 * P_7 = (1/7) Σ match(Phantom(k), F_{t+k}) for k=1..7
 *
 * 「虚数画像は予測ではなく射影」
 *
 * v1.1 - 2026-01-30
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

class PhantomValidator {
  /**
   * @param {object} options
   * @param {number} [options.linearThreshold=0.7] - P_linear above this = linear motion
   */
  constructor(options = {}) {
    this.linearThreshold = options.linearThreshold ?? 0.7;
  }

  /**
   * Compute Phantom image and compare with actual Future (B channel).
   *
   * @param {object} imageData - { data: Uint8ClampedArray, width: number, height: number }
   * @param {number} cellIndex - Cell index in grid
   * @param {number} timestamp - Cell timestamp in seconds
   * @returns {object} PhantomProfile
   */
  analyze(imageData, cellIndex, timestamp) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;

    // Extract delta statistics and compute P_linear
    const { delta, phantomError, pLinear } = this.computePhantomMatch(data, pixelCount);

    return {
      cellIndex,
      timestamp,
      delta: {
        mean: Math.round(delta.mean * 1000) / 1000,
        magnitude: Math.round(delta.magnitude * 1000) / 1000
      },
      phantomError: Math.round(phantomError * 1000) / 1000,
      pLinear: Math.round(pLinear * 1000) / 1000,
      isLinear: pLinear > this.linearThreshold,
      interpretation: this.interpret(pLinear)
    };
  }

  /**
   * Core computation: Δ(R→G) and Phantom vs B comparison.
   *
   * Formula:
   *   Δ = G - R (per-pixel delta)
   *   Phantom = G + Δ = 2G - R
   *   Error = |Phantom - B| = |2G - R - B|
   *   P_linear = 1 - mean(Error) / 255
   *
   * @param {Uint8ClampedArray} data - RGBA pixel data
   * @param {number} pixelCount - Total pixels
   * @returns {object} { delta, phantomError, pLinear }
   */
  computePhantomMatch(data, pixelCount) {
    if (pixelCount === 0) {
      return { delta: { mean: 0, magnitude: 0 }, phantomError: 0, pLinear: 0 };
    }

    let deltaSum = 0;
    let deltaSqSum = 0;
    let errorSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];     // Past
      const g = data[i + 1]; // Present
      const b = data[i + 2]; // Future (Ground Truth)

      // Delta: Present - Past
      const d = g - r;
      deltaSum += d;
      deltaSqSum += d * d;

      // Phantom: Present + Delta = 2*Present - Past
      const phantom = Math.max(0, Math.min(255, 2 * g - r));

      // Error: |Phantom - Actual Future|
      const error = Math.abs(phantom - b);
      errorSum += error;
    }

    const deltaMean = deltaSum / pixelCount;
    const deltaVariance = (deltaSqSum / pixelCount) - (deltaMean * deltaMean);
    const deltaMagnitude = Math.sqrt(Math.max(0, deltaVariance)) / 255;

    const phantomError = errorSum / pixelCount / 255;
    const pLinear = Math.max(0, 1 - phantomError);

    return {
      delta: {
        mean: deltaMean / 255,
        magnitude: deltaMagnitude
      },
      phantomError,
      pLinear
    };
  }

  /**
   * Generate interpretation string for P_linear value.
   *
   * @param {number} pLinear - 0.0 to 1.0
   * @returns {string}
   */
  interpret(pLinear) {
    if (pLinear > 0.9) return 'linear_motion';      // 線形運動
    if (pLinear > 0.7) return 'mostly_linear';      // ほぼ線形
    if (pLinear > 0.5) return 'partial_nonlinear';  // 部分的非線形
    if (pLinear > 0.3) return 'nonlinear_event';    // 非線形イベント
    return 'chaotic';                                // カオス
  }

  /**
   * Batch-analyze all cells in a grid.
   *
   * @param {Array<{imageData: object, cellIndex: number, timestamp: number}>} cells
   * @returns {Array<object>} Array of PhantomProfiles
   */
  analyzeAll(cells) {
    return cells.map(c => this.analyze(c.imageData, c.cellIndex, c.timestamp));
  }

  /**
   * Generate Phantom image buffer for visualization.
   * Returns an ImageData-like object with Phantom values in all RGB channels.
   *
   * @param {object} imageData - { data, width, height }
   * @returns {object} { data: Uint8ClampedArray, width, height }
   */
  generatePhantomImage(imageData) {
    const { data, width, height } = imageData;
    const phantom = new Uint8ClampedArray(data.length);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];     // Past
      const g = data[i + 1]; // Present

      // Phantom = 2G - R (clamped to 0-255)
      const p = Math.max(0, Math.min(255, 2 * g - r));

      phantom[i] = p;     // R
      phantom[i + 1] = p; // G
      phantom[i + 2] = p; // B
      phantom[i + 3] = 255;
    }

    return { data: phantom, width, height };
  }

  /**
   * Generate error visualization: |Phantom - B|
   * Higher values (brighter) = more prediction error.
   *
   * @param {object} imageData - { data, width, height }
   * @returns {object} { data: Uint8ClampedArray, width, height }
   */
  generateErrorImage(imageData) {
    const { data, width, height } = imageData;
    const errorImg = new Uint8ClampedArray(data.length);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];     // Past
      const g = data[i + 1]; // Present
      const b = data[i + 2]; // Future (Ground Truth)

      const phantom = Math.max(0, Math.min(255, 2 * g - r));
      const error = Math.abs(phantom - b);

      // Error as red intensity
      errorImg[i] = error;     // R (error)
      errorImg[i + 1] = 0;     // G
      errorImg[i + 2] = 0;     // B
      errorImg[i + 3] = 255;
    }

    return { data: errorImg, width, height };
  }

  /**
   * Generate Phantom image for k frames ahead.
   * Formula: Phantom(k) = (1+k)G - kR
   *
   * @param {object} imageData - { data, width, height }
   * @param {number} k - Frames ahead (1-7)
   * @returns {object} { data: Uint8ClampedArray, width, height }
   */
  generatePhantomK(imageData, k = 1) {
    const { data, width, height } = imageData;
    const phantom = new Uint8ClampedArray(data.length);

    const coefG = 1 + k;  // Coefficient for G
    const coefR = k;      // Coefficient for R

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];     // Past
      const g = data[i + 1]; // Present

      // Phantom(k) = (1+k)G - kR
      const p = Math.max(0, Math.min(255, coefG * g - coefR * r));

      phantom[i] = p;
      phantom[i + 1] = p;
      phantom[i + 2] = p;
      phantom[i + 3] = 255;
    }

    return { data: phantom, width, height };
  }

  /**
   * Compute P_7: 7-frame prediction accuracy across consecutive cells.
   *
   * Formula: P_7 = (1/7) Σ match(Phantom(k), F_{t+k})
   *
   * @param {Array<object>} cells - Array of 8+ consecutive cells with imageData
   *   cells[0] = source cell (provides R, G for delta)
   *   cells[1..7] = target cells (provide R channel as ground truth for T+k×stride)
   * @returns {object} { p7, perFrame: [{k, pMatch}, ...] }
   */
  computeP7(cells) {
    if (cells.length < 8) {
      return { p7: 0, perFrame: [], error: 'Need 8 consecutive cells for P_7' };
    }

    const sourceData = cells[0].imageData.data;
    const width = cells[0].imageData.width;
    const height = cells[0].imageData.height;
    const pixelCount = width * height;

    const perFrame = [];
    let totalMatch = 0;

    for (let k = 1; k <= 7; k++) {
      const targetData = cells[k].imageData.data;
      let errorSum = 0;

      const coefG = 1 + k;
      const coefR = k;

      for (let i = 0; i < sourceData.length; i += 4) {
        const r = sourceData[i];     // Source Past
        const g = sourceData[i + 1]; // Source Present

        // Phantom(k) = (1+k)G - kR
        const phantom = Math.max(0, Math.min(255, coefG * g - coefR * r));

        // Ground Truth: R channel of target cell (its "Past" = our predicted time)
        const actual = targetData[i];

        errorSum += Math.abs(phantom - actual);
      }

      const pMatch = Math.max(0, 1 - (errorSum / pixelCount / 255));
      perFrame.push({
        k,
        pMatch: Math.round(pMatch * 1000) / 1000,
        interpretation: this.interpret(pMatch)
      });
      totalMatch += pMatch;
    }

    const p7 = totalMatch / 7;

    // Decay rate: P(1) / P(7) — measures error accumulation
    const p1 = perFrame[0].pMatch;
    const pLast = perFrame[6].pMatch;
    const decay = pLast > 0.01 ? p1 / pLast : Infinity;

    return {
      p7: Math.round(p7 * 1000) / 1000,
      perFrame,
      decay: decay === Infinity ? 'Infinity' : Math.round(decay * 100) / 100,
      decayInterpretation: this.interpretDecay(decay),
      interpretation: this.interpret(p7)
    };
  }

  /**
   * Interpret decay rate D = P(1) / P(7).
   *
   * @param {number} decay
   * @returns {string}
   */
  interpretDecay(decay) {
    if (decay < 1.5) return 'uniform_linear';     // 等速直線運動
    if (decay < 2.5) return 'mostly_linear';      // ほぼ線形
    if (decay < 5) return 'human_motion';         // 人間の動き
    if (decay < 10) return 'complex_motion';      // 複雑な動き
    return 'chaotic';                              // カオス/予測不能
  }

  /**
   * Extract delta vector statistics for trajectory analysis.
   *
   * @param {object} imageData - { data, width, height }
   * @returns {object} { meanDelta, stdDelta, direction }
   */
  extractDelta(imageData) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;

    let deltaSum = 0;
    let deltaSqSum = 0;
    let dxSum = 0;
    let dySum = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const d = g - r;

        deltaSum += d;
        deltaSqSum += d * d;

        // Weighted position for direction
        dxSum += d * (x - width / 2);
        dySum += d * (y - height / 2);
      }
    }

    const meanDelta = deltaSum / pixelCount / 255;
    const variance = (deltaSqSum / pixelCount) - (deltaSum / pixelCount) ** 2;
    const stdDelta = Math.sqrt(Math.max(0, variance)) / 255;

    // Normalize direction
    const magnitude = Math.sqrt(dxSum * dxSum + dySum * dySum);
    const direction = magnitude > 0 ? {
      dx: dxSum / magnitude,
      dy: dySum / magnitude,
      angleDeg: Math.atan2(dySum, dxSum) * 180 / Math.PI
    } : { dx: 0, dy: 0, angleDeg: 0 };

    return {
      meanDelta: Math.round(meanDelta * 1000) / 1000,
      stdDelta: Math.round(stdDelta * 1000) / 1000,
      direction: {
        dx: Math.round(direction.dx * 1000) / 1000,
        dy: Math.round(direction.dy * 1000) / 1000,
        angleDeg: Math.round(direction.angleDeg * 10) / 10
      }
    };
  }
}

// Support both Node.js (tests, main process) and browser (renderer)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PhantomValidator };
}
if (typeof window !== 'undefined') {
  window.PhantomValidator = PhantomValidator;
}
