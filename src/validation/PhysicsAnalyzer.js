/**
 * PhysicsAnalyzer - Observer 1: Independent Physics Measurement
 *
 * Computes motion intensity from raw pixel data only.
 * Has ZERO knowledge of AI output. This is the "ground truth" side
 * of the two-observer validation model.
 *
 * Input: ImageData (RGBA pixel buffer) from a VAM-RGB encoded cell
 * Output: PhysicsProfile with intensity, direction, and regional map
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

class PhysicsAnalyzer {
  /**
   * @param {object} options
   * @param {number} [options.motionThreshold=0.05] - P above this = hasMotion
   * @param {number} [options.regionGridSize=4] - NxN regional motion map
   * @param {number} [options.colorSepWeight=0.6] - Weight for colorSeparation in P
   * @param {number} [options.fringeWeight=0.4] - Weight for directionalFringe in P
   */
  constructor(options = {}) {
    this.motionThreshold = options.motionThreshold ?? 0.05;
    this.regionGridSize = options.regionGridSize ?? 4;
    this.colorSepWeight = options.colorSepWeight ?? 0.6;
    this.fringeWeight = options.fringeWeight ?? 0.4;
  }

  /**
   * Compute full physics profile for a single VAM-RGB cell.
   *
   * @param {object} imageData - { data: Uint8ClampedArray, width: number, height: number }
   * @param {number} cellIndex - Cell index in grid
   * @param {number} timestamp - Cell timestamp in seconds
   * @returns {object} PhysicsProfile
   */
  analyze(imageData, cellIndex, timestamp) {
    const colorSeparation = this.computeColorSeparation(imageData);
    const directionalFringe = this.computeDirectionalFringe(imageData);
    const regionalMotion = this.computeRegionalMotion(imageData);

    const physicsIntensity =
      this.colorSepWeight * colorSeparation +
      this.fringeWeight * directionalFringe.magnitude;

    return {
      cellIndex,
      timestamp,
      physicsIntensity: Math.round(physicsIntensity * 1000) / 1000,
      colorSeparation: Math.round(colorSeparation * 1000) / 1000,
      directionalFringe,
      regionalMotion,
      hasMotion: physicsIntensity > this.motionThreshold
    };
  }

  /**
   * Batch-analyze all cells in a grid.
   *
   * @param {Array<{imageData: object, cellIndex: number, timestamp: number}>} cells
   * @returns {Array<object>} Array of PhysicsProfiles
   */
  analyzeAll(cells) {
    return cells.map(c => this.analyze(c.imageData, c.cellIndex, c.timestamp));
  }

  /**
   * RGB channel divergence magnitude.
   * In a static scene, R=G=B (grayscale) so separation = 0.
   * In a moving scene, channels diverge proportionally to motion speed.
   *
   * Formula: average of max(|R-G|, |G-B|, |R-B|) / 255 per pixel
   * Matches existing _calculateColorSeparation() in vam-rgb.js
   *
   * @param {object} imageData - { data, width, height }
   * @returns {number} 0.0-1.0
   */
  computeColorSeparation(imageData) {
    const { data, width, height } = imageData;
    const pixelCount = width * height;
    if (pixelCount === 0) return 0;

    let totalDivergence = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const divergence = Math.max(
        Math.abs(r - g),
        Math.abs(g - b),
        Math.abs(r - b)
      ) / 255;

      totalDivergence += divergence;
    }

    return Math.round((totalDivergence / pixelCount) * 1000) / 1000;
  }

  /**
   * Directional fringe analysis via channel centroid displacement.
   *
   * Computes center-of-mass for R, G, B channels separately.
   * R = Past (T-0.5s), B = Future (T+0.5s).
   * The vector from R-centroid to B-centroid indicates motion direction.
   *
   * If object moves RIGHT: B-centroid shifts right, R-centroid shifts left.
   * If object moves DOWN: B-centroid shifts down, R-centroid shifts up.
   *
   * @param {object} imageData - { data, width, height }
   * @returns {object} { dx, dy, magnitude, angleDeg }
   */
  computeDirectionalFringe(imageData) {
    const { data, width, height } = imageData;

    let rSumX = 0, rSumY = 0, rTotal = 0;
    let bSumX = 0, bSumY = 0, bTotal = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const b = data[idx + 2];

        rSumX += x * r; rSumY += y * r; rTotal += r;
        bSumX += x * b; bSumY += y * b; bTotal += b;
      }
    }

    // Centroids (default to center if channel is all-zero)
    const halfW = width / 2;
    const halfH = height / 2;
    const rCx = rTotal > 0 ? rSumX / rTotal : halfW;
    const rCy = rTotal > 0 ? rSumY / rTotal : halfH;
    const bCx = bTotal > 0 ? bSumX / bTotal : halfW;
    const bCy = bTotal > 0 ? bSumY / bTotal : halfH;

    // Displacement: R(Past) → B(Future)
    const dx = bCx - rCx;
    const dy = bCy - rCy;

    // Normalize magnitude by image diagonal
    const diagonal = Math.sqrt(width * width + height * height);
    const magnitude = diagonal > 0 ? Math.sqrt(dx * dx + dy * dy) / diagonal : 0;

    // Angle in degrees (0 = right, 90 = down, per standard image coords)
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    // Normalize to [0, 360)
    const normalizedAngle = ((angleDeg % 360) + 360) % 360;

    return {
      dx: Math.round(dx * 100) / 100,
      dy: Math.round(dy * 100) / 100,
      magnitude: Math.round(magnitude * 1000) / 1000,
      angleDeg: Math.round(normalizedAngle * 10) / 10
    };
  }

  /**
   * Regional motion map: divide cell into NxN sub-regions.
   * Compute colorSeparation per region.
   * Enables spatial verification ("motion in top-left corner").
   *
   * @param {object} imageData - { data, width, height }
   * @returns {Float32Array} size = gridSize * gridSize, row-major
   */
  computeRegionalMotion(imageData) {
    const { data, width, height } = imageData;
    const N = this.regionGridSize;
    const regionW = Math.floor(width / N);
    const regionH = Math.floor(height / N);

    const result = new Float32Array(N * N);

    for (let ry = 0; ry < N; ry++) {
      for (let rx = 0; rx < N; rx++) {
        let totalDiv = 0;
        let count = 0;

        const startX = rx * regionW;
        const startY = ry * regionH;
        const endX = rx === N - 1 ? width : startX + regionW;
        const endY = ry === N - 1 ? height : startY + regionH;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            totalDiv += Math.max(
              Math.abs(r - g),
              Math.abs(g - b),
              Math.abs(r - b)
            ) / 255;

            count++;
          }
        }

        result[ry * N + rx] = count > 0
          ? Math.round((totalDiv / count) * 1000) / 1000
          : 0;
      }
    }

    return result;
  }
}

// Support both Node.js (tests, main process) and browser (renderer)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PhysicsAnalyzer;
}
if (typeof window !== 'undefined') {
  window.PhysicsAnalyzer = PhysicsAnalyzer;
}
