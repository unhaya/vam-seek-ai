/**
 * GradientComputer - ψ4.0 Ground Truth Physics Computation
 *
 * Computes actual gradients from VAM-RGB image data.
 * Used to verify AI's physics responses against ground truth.
 *
 * No semantic interpretation. Pure pixel math.
 *
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

class GradientComputer {
  /**
   * @param {object} config
   * @param {number} [config.blockSize=4] - Block size for averaging (ψ4.0 = 4×4)
   */
  constructor(config = {}) {
    this.blockSize = config.blockSize || 4;
  }

  /**
   * Compute all physics values for a VAM-RGB cell image.
   *
   * @param {ImageData|object} imageData - { data: Uint8ClampedArray, width, height }
   * @returns {object} { blocks: Array, stats: object }
   */
  compute(imageData) {
    const { data, width, height } = imageData;
    const BLOCK = this.blockSize;
    const blocksX = Math.ceil(width / BLOCK);
    const blocksY = Math.ceil(height / BLOCK);

    const blocks = [];

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const blockData = this._computeBlock(data, width, height, bx, by, BLOCK);
        blocks.push({
          idx: by * blocksX + bx,
          x: bx,
          y: by,
          ...blockData
        });
      }
    }

    // Compute stats
    const stats = this._computeStats(blocks);

    return { blocks, stats, blocksX, blocksY };
  }

  /**
   * Compute physics values for a single block.
   * @private
   */
  _computeBlock(data, width, height, bx, by, BLOCK) {
    let sumR = 0, sumG = 0, sumB = 0;
    let count = 0;

    const yStart = by * BLOCK;
    const xStart = bx * BLOCK;
    const yEnd = Math.min(yStart + BLOCK, height);
    const xEnd = Math.min(xStart + BLOCK, width);

    // Collect all pixels in block
    const pixels = [];

    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        sumR += r;
        sumG += g;
        sumB += b;
        count++;

        pixels.push({ r, g, b, x, y });
      }
    }

    if (count === 0) {
      return { R: 0, G: 0, B: 0, dRB: 0, dG: 0, dir: '=' };
    }

    const R = Math.round(sumR / count);
    const G = Math.round(sumG / count);
    const B = Math.round(sumB / count);

    // ∇(R-B): temporal change magnitude
    const dRB = Math.round(Math.abs(B - R) / 255 * 1000) / 1000;

    // Direction: future or past
    const dir = B > R ? '→' : (B < R ? '←' : '=');

    // ∇G: max gradient within block (texture/edge indicator)
    const dG = this._computeGradient(pixels, width);

    return { R, G, B, dRB, dG, dir };
  }

  /**
   * Compute max gradient within block pixels.
   * @private
   */
  _computeGradient(pixels, width) {
    if (pixels.length < 2) return 0;

    let maxGrad = 0;

    for (const p of pixels) {
      // Find horizontal neighbor
      const right = pixels.find(q => q.x === p.x + 1 && q.y === p.y);
      if (right) {
        const grad = Math.abs(p.g - right.g) / 255;
        if (grad > maxGrad) maxGrad = grad;
      }

      // Find vertical neighbor
      const down = pixels.find(q => q.x === p.x && q.y === p.y + 1);
      if (down) {
        const grad = Math.abs(p.g - down.g) / 255;
        if (grad > maxGrad) maxGrad = grad;
      }
    }

    return Math.round(maxGrad * 1000) / 1000;
  }

  /**
   * Compute statistics across all blocks.
   * @private
   */
  _computeStats(blocks) {
    if (blocks.length === 0) {
      return { avgDRB: 0, maxDRB: 0, motionBlocks: 0, staticBlocks: 0 };
    }

    let sumDRB = 0;
    let maxDRB = 0;
    let motionBlocks = 0;
    let staticBlocks = 0;

    for (const b of blocks) {
      sumDRB += b.dRB;
      if (b.dRB > maxDRB) maxDRB = b.dRB;
      if (b.dRB > 0.05) {
        motionBlocks++;
      } else {
        staticBlocks++;
      }
    }

    return {
      avgDRB: Math.round(sumDRB / blocks.length * 1000) / 1000,
      maxDRB,
      motionBlocks,
      staticBlocks,
      totalBlocks: blocks.length
    };
  }

  /**
   * Filter blocks by physics conditions.
   *
   * @param {Array} blocks - From compute()
   * @param {object} conditions - { r: [min,max], g: [min,max], b: [min,max], dRB: [min,max] }
   * @returns {Array} Matching blocks
   */
  filter(blocks, conditions) {
    return blocks.filter(b => {
      if (conditions.r && (b.R < conditions.r[0] || b.R > conditions.r[1])) return false;
      if (conditions.g && (b.G < conditions.g[0] || b.G > conditions.g[1])) return false;
      if (conditions.b && (b.B < conditions.b[0] || b.B > conditions.b[1])) return false;
      if (conditions.dRB && (b.dRB < conditions.dRB[0] || b.dRB > conditions.dRB[1])) return false;
      if (conditions.dG && (b.dG < conditions.dG[0] || b.dG > conditions.dG[1])) return false;
      return true;
    });
  }

  /**
   * Find skin-like regions (for De-semantification ground truth).
   *
   * @param {Array} blocks
   * @returns {Array} Blocks matching skin tone ranges
   */
  findSkinRegions(blocks) {
    return blocks.filter(b => {
      // Light skin
      const isLight = b.R >= 140 && b.R <= 255 &&
                      b.G >= 80 && b.G <= 200 &&
                      b.B >= 60 && b.B <= 180;
      // Medium skin
      const isMedium = b.R >= 80 && b.R <= 180 &&
                       b.G >= 50 && b.G <= 140 &&
                       b.B >= 30 && b.B <= 120;
      // Dark skin
      const isDark = b.R >= 40 && b.R <= 120 &&
                     b.G >= 20 && b.G <= 80 &&
                     b.B >= 10 && b.B <= 60;

      return isLight || isMedium || isDark;
    });
  }

  /**
   * Find high-gradient boundaries (fabric edges, etc.).
   *
   * @param {Array} blocks
   * @param {number} [threshold=0.15]
   * @returns {Array} Blocks with high gradient
   */
  findBoundaries(blocks, threshold = 0.15) {
    return blocks.filter(b => b.dG >= threshold);
  }

  /**
   * Find motion regions (R-B divergence).
   *
   * @param {Array} blocks
   * @param {number} [threshold=0.1]
   * @returns {Array} Blocks with temporal change
   */
  findMotion(blocks, threshold = 0.1) {
    return blocks.filter(b => b.dRB >= threshold);
  }

  /**
   * Find static regions.
   *
   * @param {Array} blocks
   * @param {number} [threshold=0.05]
   * @returns {Array} Blocks with no temporal change
   */
  findStatic(blocks, threshold = 0.05) {
    return blocks.filter(b => b.dRB < threshold);
  }
}

module.exports = { GradientComputer };
