/**
 * ValidationReport - Structured Output for Audit Trail
 *
 * Stores all intermediate values from the two-observer validation.
 * Every final score can be traced back to its constituent measurements.
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

class ValidationReport {
  /**
   * @param {object} data
   * @param {number} data.cellCount
   * @param {Array<object>} data.physicsProfiles - Observer 1 output per cell
   * @param {object} data.verbalizationProfile - Observer 2 output
   * @param {object} data.rIndex - { rIndex, direction, P, V }
   * @param {object} data.coherence - { coherence, semanticConfidence, physicsValidity, ... }
   * @param {object} data.directionalAccuracy - { meanError, count, comparisons }
   */
  constructor(data = {}) {
    this.version = '1.0';
    this.timestamp = new Date().toISOString();
    this.cellCount = data.cellCount || 0;
    this.physicsProfiles = data.physicsProfiles || [];
    this.verbalizationProfile = data.verbalizationProfile || {};
    this.rIndex = data.rIndex || {};
    this.coherence = data.coherence || {};
    this.directionalAccuracy = data.directionalAccuracy || {};
  }

  /**
   * Pass/fail based on VAM-RGB v3.0 thresholds.
   *
   * From specification:
   *   coherence_threshold: 0.7
   *   r_index_max: 0.3
   */
  get isValid() {
    return (
      (this.coherence.coherence ?? 0) >= 0.7 &&
      (this.rIndex.rIndex ?? 1) <= 0.3
    );
  }

  /**
   * Compact JSON for manifest embedding.
   * Excludes per-cell details to keep manifest small.
   */
  toManifest() {
    return {
      validator_version: this.version,
      computed_at: this.timestamp,
      computed_independently: true,
      cell_count: this.cellCount,
      r_index: this.rIndex.rIndex,
      r_index_direction: this.rIndex.direction,
      r_index_P: this.rIndex.P,
      r_index_V: this.rIndex.V,
      coherence_score: this.coherence.coherence,
      semantic_confidence: this.coherence.semanticConfidence,
      physics_validity: this.coherence.physicsValidity,
      precision: this.coherence.precision,
      recall: this.coherence.recall,
      confusion_matrix: this.coherence.confusion,
      directional_accuracy: this.directionalAccuracy.meanError,
      directional_comparisons: this.directionalAccuracy.count,
      valid: this.isValid
    };
  }

  /**
   * Full JSON with all intermediate values for audit.
   */
  toJSON() {
    return {
      version: this.version,
      timestamp: this.timestamp,
      cellCount: this.cellCount,
      rIndex: this.rIndex,
      coherence: this.coherence,
      directionalAccuracy: this.directionalAccuracy,
      physicsProfiles: this.physicsProfiles.map(p => ({
        cellIndex: p.cellIndex,
        timestamp: p.timestamp,
        physicsIntensity: p.physicsIntensity,
        colorSeparation: p.colorSeparation,
        directionalFringe: p.directionalFringe,
        hasMotion: p.hasMotion
        // regionalMotion omitted (Float32Array not JSON-friendly by default)
      })),
      verbalizationProfile: {
        willingness: this.verbalizationProfile.willingness,
        totalTimestampMentions: this.verbalizationProfile.totalTimestampMentions,
        totalMotionClaims: this.verbalizationProfile.totalMotionClaims,
        motionClaims: (this.verbalizationProfile.motionClaims || []).map(c => ({
          timestamp: c.timestamp,
          claimsMotion: c.claimsMotion,
          directionClaim: c.directionClaim,
          hasMotionVerb: c.hasMotionVerb
        }))
      },
      valid: this.isValid
    };
  }

  /**
   * Human-readable one-line summary.
   */
  toSummary() {
    const r = this.rIndex.rIndex ?? '?';
    const dir = this.rIndex.direction ?? '?';
    const coh = this.coherence.coherence ?? '?';
    const valid = this.isValid ? 'PASS' : 'FAIL';
    return `[Validation] R=${r} (${dir}) | Coherence=${coh} | ${valid}`;
  }
}

module.exports = ValidationReport;
