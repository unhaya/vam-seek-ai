/**
 * ReconstructionValidator - Round-trip Verification
 *
 * Validates reconstruction quality by re-encoding reconstructed frames
 * back into VAM-RGB format and comparing with the original cell.
 *
 * Pipeline:
 *   Original Cell ──┐
 *                    ├── compare ── roundTripCoherence
 *   Reconstructed    │
 *   Frames ── re-encode (mergeRGB) ──┘
 *
 * Also compares PhysicsAnalyzer profiles between original and re-encoded
 * cells to verify that motion characteristics are preserved.
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

// Conditional require for PhysicsAnalyzer (available in both Node and browser)
let PhysicsAnalyzer;
if (typeof require !== 'undefined') {
  try {
    PhysicsAnalyzer = require('../validation/PhysicsAnalyzer');
  } catch (e) {
    // Will be set from window in browser
  }
}

class ReconstructionValidator {
  /**
   * @param {object} [options]
   * @param {object} [options.physicsAnalyzer] - PhysicsAnalyzer instance (injected or auto-created)
   */
  constructor(options = {}) {
    const PA = options.physicsAnalyzer
      || (PhysicsAnalyzer ? new PhysicsAnalyzer() : null)
      || (typeof window !== 'undefined' && window.PhysicsAnalyzer ? new window.PhysicsAnalyzer() : null);
    this.physicsAnalyzer = PA;
  }

  /**
   * Validate reconstruction by round-trip comparison.
   *
   * Re-encodes the reconstructed frames using _mergeRGB logic,
   * then compares the re-encoded cell with the original.
   *
   * @param {object} originalCell - { data: Uint8ClampedArray, width, height }
   * @param {object} pastFrame - Reconstructed past frame (full-color ImageData)
   * @param {object} presentFrame - Reconstructed present frame
   * @param {object} futureFrame - Reconstructed future frame
   * @returns {object} ValidationResult
   */
  validate(originalCell, pastFrame, presentFrame, futureFrame) {
    const { width, height } = originalCell;
    const pixelCount = width * height;

    // Step 1: Re-encode using _mergeRGB logic
    const reEncoded = this._mergeRGB(pastFrame, presentFrame, futureFrame);

    // Step 2: Per-channel error
    const channelErrors = this._computeChannelErrors(originalCell, reEncoded);

    // Step 3: Overall pixel error
    const pixelError = (channelErrors.R + channelErrors.G + channelErrors.B) / 3;

    // Step 4: Round-trip coherence (1 - error)
    const roundTripCoherence = Math.round((1 - pixelError) * 1000) / 1000;

    // Step 5: Physics profile comparison (if analyzer available)
    let physicsMatch = null;
    if (this.physicsAnalyzer) {
      physicsMatch = this._comparePhysics(originalCell, reEncoded);
    }

    return {
      roundTripCoherence,
      channelErrors: {
        R: Math.round(channelErrors.R * 1000) / 1000,
        G: Math.round(channelErrors.G * 1000) / 1000,
        B: Math.round(channelErrors.B * 1000) / 1000
      },
      pixelError: Math.round(pixelError * 1000) / 1000,
      physicsMatch,
      pixelCount
    };
  }

  /**
   * Re-encode three frames into a VAM-RGB cell.
   * Exact replica of _mergeRGB() from vam-rgb.js.
   *
   * @param {object} past - { data, width, height }
   * @param {object} present
   * @param {object} future
   * @returns {object} { data: Uint8ClampedArray, width, height }
   * @private
   */
  _mergeRGB(past, present, future) {
    const { width, height } = past;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < data.length; i += 4) {
      data[i] = past.data[i];           // R = Past's R channel
      data[i + 1] = present.data[i + 1]; // G = Present's G channel
      data[i + 2] = future.data[i + 2];  // B = Future's B channel
      data[i + 3] = 255;
    }

    return { data, width, height };
  }

  /**
   * Compute mean absolute error per channel.
   *
   * @param {object} original
   * @param {object} reEncoded
   * @returns {{ R: number, G: number, B: number }} Error per channel, 0.0-1.0
   * @private
   */
  _computeChannelErrors(original, reEncoded) {
    const len = original.data.length;
    let errR = 0, errG = 0, errB = 0;
    let count = 0;

    for (let i = 0; i < len; i += 4) {
      errR += Math.abs(original.data[i] - reEncoded.data[i]);
      errG += Math.abs(original.data[i + 1] - reEncoded.data[i + 1]);
      errB += Math.abs(original.data[i + 2] - reEncoded.data[i + 2]);
      count++;
    }

    return {
      R: count > 0 ? errR / (count * 255) : 0,
      G: count > 0 ? errG / (count * 255) : 0,
      B: count > 0 ? errB / (count * 255) : 0
    };
  }

  /**
   * Compare PhysicsAnalyzer profiles of original and re-encoded cells.
   *
   * @param {object} original
   * @param {object} reEncoded
   * @returns {object} { colorSepError, fringeMagError, fringeAngleError, intensityError }
   * @private
   */
  _comparePhysics(original, reEncoded) {
    const origProfile = this.physicsAnalyzer.analyze(original, 0, 0);
    const reProfile = this.physicsAnalyzer.analyze(reEncoded, 0, 0);

    const colorSepError = Math.abs(origProfile.colorSeparation - reProfile.colorSeparation);
    const fringeMagError = Math.abs(
      origProfile.directionalFringe.magnitude - reProfile.directionalFringe.magnitude
    );

    // Angle error: handle wraparound (350° vs 10° = 20° error, not 340°)
    const angleDiff = Math.abs(origProfile.directionalFringe.angleDeg - reProfile.directionalFringe.angleDeg);
    const fringeAngleError = Math.min(angleDiff, 360 - angleDiff);

    const intensityError = Math.abs(origProfile.physicsIntensity - reProfile.physicsIntensity);

    return {
      colorSepError: Math.round(colorSepError * 1000) / 1000,
      fringeMagError: Math.round(fringeMagError * 1000) / 1000,
      fringeAngleError: Math.round(fringeAngleError * 10) / 10,
      intensityError: Math.round(intensityError * 1000) / 1000,
      originalProfile: {
        colorSeparation: origProfile.colorSeparation,
        physicsIntensity: origProfile.physicsIntensity,
        fringeMagnitude: origProfile.directionalFringe.magnitude,
        fringeAngle: origProfile.directionalFringe.angleDeg
      },
      reEncodedProfile: {
        colorSeparation: reProfile.colorSeparation,
        physicsIntensity: reProfile.physicsIntensity,
        fringeMagnitude: reProfile.directionalFringe.magnitude,
        fringeAngle: reProfile.directionalFringe.angleDeg
      }
    };
  }
}

// Support both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReconstructionValidator;
}
if (typeof window !== 'undefined') {
  window.ReconstructionValidator = ReconstructionValidator;
}
