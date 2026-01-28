/**
 * ThawDecoder - Orchestrator for VAM-RGB Temporal Reconstruction
 *
 * Coordinates all Thaw components in a layered pipeline:
 *
 *   Level 1: ChannelSeparator  → 3 grayscale frames + confidence map
 *   Level 2: ColorEstimator    → 3 estimated color frames + quality map
 *   Level 3: AI reconstruction → validated via ReconstructionValidator
 *
 * Each level can be used independently.
 * Higher levels build on lower ones but never bypass them.
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

let ChannelSeparator, ColorEstimator, ReconstructionValidator;

if (typeof require !== 'undefined') {
  try {
    ChannelSeparator = require('./ChannelSeparator');
    ColorEstimator = require('./ColorEstimator');
    ReconstructionValidator = require('./ReconstructionValidator');
  } catch (e) {
    // Browser: will use window globals
  }
}

class ThawDecoder {
  /**
   * @param {object} [options]
   * @param {number} [options.staticThreshold=0.04] - Passed to ColorEstimator
   * @param {object} [options.physicsAnalyzer] - Passed to ReconstructionValidator
   */
  constructor(options = {}) {
    const CS = ChannelSeparator || (typeof window !== 'undefined' && window.ChannelSeparator);
    const CE = ColorEstimator || (typeof window !== 'undefined' && window.ColorEstimator);
    const RV = ReconstructionValidator || (typeof window !== 'undefined' && window.ReconstructionValidator);

    this.separator = new CS();
    this.estimator = new CE({ staticThreshold: options.staticThreshold });
    this.validator = new RV({ physicsAnalyzer: options.physicsAnalyzer });
  }

  /**
   * Level 1: Channel separation only.
   * Pure mathematical inverse of _mergeRGB(). No estimation, no AI.
   *
   * @param {object} vamrgbCell - { data: Uint8ClampedArray, width, height }
   * @returns {{
   *   past:    { data, width, height },
   *   present: { data, width, height },
   *   future:  { data, width, height },
   *   confidenceMap: Float32Array
   * }}
   */
  separate(vamrgbCell) {
    return this.separator.separate(vamrgbCell);
  }

  /**
   * Level 2: Separation + statistical color estimation.
   * No AI. Uses cross-channel ratios from static regions.
   *
   * @param {object} vamrgbCell
   * @returns {{
   *   past:    { frame, quality },
   *   present: { frame, quality },
   *   future:  { frame, quality },
   *   confidenceMap: Float32Array,
   *   staticColor: { colorFrame, mask }
   * }}
   */
  estimate(vamrgbCell) {
    const separated = this.separator.separate(vamrgbCell);
    const estimated = this.estimator.estimateAll(separated, vamrgbCell);
    const staticColor = this.separator.extractStaticColor(vamrgbCell);

    return {
      past: estimated.past,
      present: estimated.present,
      future: estimated.future,
      confidenceMap: separated.confidenceMap,
      staticColor
    };
  }

  /**
   * Level 3: Validate AI-generated reconstruction.
   *
   * After an external AI generates Past/Present/Future frames from
   * the Thaw prompt, this method verifies reconstruction quality
   * by round-trip comparison with the original cell.
   *
   * @param {object} originalCell - Original VAM-RGB cell
   * @param {object} aiPastFrame - AI-reconstructed past frame (full-color)
   * @param {object} aiPresentFrame - AI-reconstructed present frame
   * @param {object} aiFutureFrame - AI-reconstructed future frame
   * @returns {object} Validation result from ReconstructionValidator
   */
  validateReconstruction(originalCell, aiPastFrame, aiPresentFrame, aiFutureFrame) {
    return this.validator.validate(originalCell, aiPastFrame, aiPresentFrame, aiFutureFrame);
  }

  /**
   * Full pipeline: separate → estimate → validate estimation quality.
   * Useful for testing the non-AI reconstruction path.
   *
   * @param {object} vamrgbCell
   * @returns {{
   *   estimated: { past, present, future, confidenceMap, staticColor },
   *   validation: object,
   *   temporalDelta: Float32Array
   * }}
   */
  analyzeCell(vamrgbCell) {
    const estimated = this.estimate(vamrgbCell);
    const validation = this.validator.validate(
      vamrgbCell,
      estimated.past.frame,
      estimated.present.frame,
      estimated.future.frame
    );
    const temporalDelta = this.separator.computeTemporalDelta(vamrgbCell);

    return {
      estimated,
      validation,
      temporalDelta
    };
  }
}

// Support both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThawDecoder;
}
if (typeof window !== 'undefined') {
  window.ThawDecoder = ThawDecoder;
}
