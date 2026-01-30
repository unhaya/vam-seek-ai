/**
 * GroundTruthValidator - ψ4.0 Physics Verification
 *
 * Validates AI's physics responses against computed ground truth.
 *
 * R_groundTruth = 1 - (matches / claimed)
 *   = 0: AI's calculations are accurate (狐)
 *   = 1: AI hallucinated all coordinates (狸)
 *
 * No semantic interpretation. Pure coordinate matching.
 *
 * 「AIの計算結果を、俺らの計算結果と照合する」
 *
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

const { GradientComputer } = require('./GradientComputer');

class GroundTruthValidator {
  /**
   * @param {object} config
   * @param {number} [config.toleranceDRB=0.05] - Tolerance for ∇(R-B) matching
   * @param {number} [config.toleranceRGB=15] - Tolerance for R/G/B matching (0-255)
   * @param {number} [config.blockSize=4] - Block size for computation
   */
  constructor(config = {}) {
    this.toleranceDRB = config.toleranceDRB ?? 0.05;
    this.toleranceRGB = config.toleranceRGB ?? 15;
    this.computer = new GradientComputer({ blockSize: config.blockSize || 4 });
  }

  /**
   * Parse AI's JSON physics response.
   *
   * @param {string} aiResponse - AI's response text (should contain JSON array)
   * @returns {Array|null} Parsed blocks or null if parse fails
   */
  parseAIResponse(aiResponse) {
    if (!aiResponse) return null;

    try {
      // Extract JSON array from response
      const jsonMatch = aiResponse.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        // Try object format { blocks: [...] }
        const objMatch = aiResponse.match(/\{[\s\S]*"blocks"[\s\S]*\}/);
        if (objMatch) {
          const obj = JSON.parse(objMatch[0]);
          return obj.blocks || null;
        }
        return null;
      }

      const blocks = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(blocks)) return null;

      // Normalize block format
      return blocks.map(b => ({
        idx: b.idx ?? b.index ?? null,
        x: b.x ?? b.bx ?? null,
        y: b.y ?? b.by ?? null,
        R: b.R ?? b.r ?? null,
        G: b.G ?? b.g ?? null,
        B: b.B ?? b.b ?? null,
        dRB: b.dRB ?? b.delta ?? b.d ?? null,
        dG: b.dG ?? b.grad ?? null,
        dir: b.dir ?? b.direction ?? null
      }));

    } catch (e) {
      console.error('[GroundTruthValidator] Parse error:', e.message);
      return null;
    }
  }

  /**
   * Validate AI's response against image ground truth.
   *
   * @param {string} aiResponse - AI's physics response
   * @param {ImageData} imageData - Actual image data { data, width, height }
   * @returns {object} Validation result
   */
  validate(aiResponse, imageData) {
    // Parse AI's claims
    const aiBlocks = this.parseAIResponse(aiResponse);
    if (!aiBlocks || aiBlocks.length === 0) {
      return {
        R_groundTruth: 1.0,
        status: 'PARSE_FAIL',
        message: 'Could not parse AI response as JSON blocks',
        aiBlockCount: 0,
        matchCount: 0,
        matches: [],
        mismatches: []
      };
    }

    // Compute ground truth
    const groundTruth = this.computer.compute(imageData);

    // Compare
    const comparison = this._compare(aiBlocks, groundTruth.blocks);

    // Compute R_groundTruth
    const R = aiBlocks.length > 0
      ? 1 - (comparison.matches.length / aiBlocks.length)
      : 0;

    return {
      R_groundTruth: Math.round(R * 1000) / 1000,
      status: R < 0.1 ? 'PASS' : (R < 0.3 ? 'PARTIAL' : 'FAIL'),
      message: this._getMessage(R),
      aiBlockCount: aiBlocks.length,
      groundTruthBlockCount: groundTruth.blocks.length,
      matchCount: comparison.matches.length,
      mismatchCount: comparison.mismatches.length,
      hallucinations: comparison.hallucinations.length,
      matches: comparison.matches,
      mismatches: comparison.mismatches,
      hallucinations: comparison.hallucinations,
      stats: groundTruth.stats
    };
  }

  /**
   * Compare AI blocks with ground truth blocks.
   * @private
   */
  _compare(aiBlocks, gtBlocks) {
    const matches = [];
    const mismatches = [];
    const hallucinations = [];

    for (const ai of aiBlocks) {
      // Find corresponding ground truth block by index or coordinates
      let gt = null;

      if (ai.idx !== null) {
        gt = gtBlocks.find(b => b.idx === ai.idx);
      } else if (ai.x !== null && ai.y !== null) {
        gt = gtBlocks.find(b => b.x === ai.x && b.y === ai.y);
      }

      if (!gt) {
        // AI claimed a block that doesn't exist
        hallucinations.push({
          ai,
          reason: 'Block index/coordinates not found in image'
        });
        continue;
      }

      // Compare values
      const comparison = this._compareBlock(ai, gt);

      if (comparison.isMatch) {
        matches.push({ ai, gt, comparison });
      } else {
        mismatches.push({ ai, gt, comparison });
      }
    }

    return { matches, mismatches, hallucinations };
  }

  /**
   * Compare a single AI block with ground truth block.
   * @private
   */
  _compareBlock(ai, gt) {
    const errors = [];
    let isMatch = true;

    // Compare ∇(R-B) if AI provided it
    if (ai.dRB !== null) {
      const drbError = Math.abs(ai.dRB - gt.dRB);
      if (drbError > this.toleranceDRB) {
        errors.push({ field: 'dRB', ai: ai.dRB, gt: gt.dRB, error: drbError });
        isMatch = false;
      }
    }

    // Compare R/G/B if AI provided them
    if (ai.R !== null) {
      const rError = Math.abs(ai.R - gt.R);
      if (rError > this.toleranceRGB) {
        errors.push({ field: 'R', ai: ai.R, gt: gt.R, error: rError });
        isMatch = false;
      }
    }

    if (ai.G !== null) {
      const gError = Math.abs(ai.G - gt.G);
      if (gError > this.toleranceRGB) {
        errors.push({ field: 'G', ai: ai.G, gt: gt.G, error: gError });
        isMatch = false;
      }
    }

    if (ai.B !== null) {
      const bError = Math.abs(ai.B - gt.B);
      if (bError > this.toleranceRGB) {
        errors.push({ field: 'B', ai: ai.B, gt: gt.B, error: bError });
        isMatch = false;
      }
    }

    // Compare direction if AI provided it
    if (ai.dir !== null && ai.dir !== gt.dir) {
      errors.push({ field: 'dir', ai: ai.dir, gt: gt.dir });
      // Direction mismatch is a soft error, don't fail on it alone
    }

    return { isMatch, errors };
  }

  /**
   * Get human-readable message for R value.
   * @private
   */
  _getMessage(R) {
    if (R < 0.05) return '完璧な狐 — AI計算は物理と完全一致';
    if (R < 0.1) return '狐 — AI計算は物理とほぼ一致';
    if (R < 0.3) return '部分一致 — 一部の座標がずれている';
    if (R < 0.5) return '要注意 — 半数以上の座標が不正確';
    if (R < 0.8) return '狸の兆候 — 大半がハルシネーション';
    return '完全な狸 — 計算結果は信頼不可';
  }

  /**
   * Quick validation: just check if AI's claimed blocks exist and have reasonable values.
   *
   * @param {string} aiResponse
   * @param {ImageData} imageData
   * @returns {object} { valid: boolean, R: number, reason: string }
   */
  quickValidate(aiResponse, imageData) {
    const result = this.validate(aiResponse, imageData);
    return {
      valid: result.R_groundTruth < 0.3,
      R: result.R_groundTruth,
      reason: result.message,
      matches: result.matchCount,
      total: result.aiBlockCount
    };
  }

  /**
   * Validate specific physics query results.
   * Useful for De-semantification: verify AI computed what we asked.
   *
   * @param {string} aiResponse
   * @param {ImageData} imageData
   * @param {string} queryType - 'skin' | 'boundary' | 'motion' | 'static' | 'all'
   * @returns {object} Validation result with query-specific analysis
   */
  validateQuery(aiResponse, imageData, queryType = 'all') {
    const aiBlocks = this.parseAIResponse(aiResponse);
    if (!aiBlocks || aiBlocks.length === 0) {
      return {
        R_groundTruth: 1.0,
        status: 'PARSE_FAIL',
        queryType,
        relevantBlocks: 0
      };
    }

    const groundTruth = this.computer.compute(imageData);

    // Get relevant ground truth blocks based on query type
    let relevantGT;
    switch (queryType) {
      case 'skin':
        relevantGT = this.computer.findSkinRegions(groundTruth.blocks);
        break;
      case 'boundary':
        relevantGT = this.computer.findBoundaries(groundTruth.blocks);
        break;
      case 'motion':
        relevantGT = this.computer.findMotion(groundTruth.blocks);
        break;
      case 'static':
        relevantGT = this.computer.findStatic(groundTruth.blocks);
        break;
      default:
        relevantGT = groundTruth.blocks;
    }

    // Check how many of AI's claimed blocks are in relevant set
    const relevantMatches = aiBlocks.filter(ai =>
      relevantGT.some(gt =>
        (ai.idx !== null && gt.idx === ai.idx) ||
        (ai.x !== null && ai.y !== null && gt.x === ai.x && gt.y === ai.y)
      )
    );

    const precision = aiBlocks.length > 0
      ? relevantMatches.length / aiBlocks.length
      : 0;

    const recall = relevantGT.length > 0
      ? relevantMatches.length / relevantGT.length
      : 1;

    const f1 = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    return {
      R_groundTruth: Math.round((1 - f1) * 1000) / 1000,
      status: f1 > 0.7 ? 'PASS' : (f1 > 0.4 ? 'PARTIAL' : 'FAIL'),
      queryType,
      aiBlockCount: aiBlocks.length,
      relevantBlockCount: relevantGT.length,
      relevantMatches: relevantMatches.length,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000
    };
  }
}

module.exports = { GroundTruthValidator };
