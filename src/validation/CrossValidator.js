/**
 * CrossValidator - R-index and Coherence Computation
 *
 * Combines outputs from PhysicsAnalyzer (Observer 1) and
 * VerbalizationAnalyzer (Observer 2) to compute:
 *
 * 1. R-index: |P - V| / P — gap between physics and verbalization
 * 2. Coherence: sqrt(semanticConfidence * physicsValidity)
 *
 * This module never touches raw pixels or AI internals.
 * It only compares the two observers' independent measurements.
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

const ValidationReport = require('./ValidationReport');

class CrossValidator {
  /**
   * @param {object} options
   * @param {number} [options.secondsPerCell=15] - Grid cell interval
   */
  constructor(options = {}) {
    this.secondsPerCell = options.secondsPerCell ?? 15;
  }

  /**
   * Full validation: compute R-index and Coherence from both observers.
   *
   * @param {Array<object>} physicsProfiles - From PhysicsAnalyzer
   * @param {object} verbalizationProfile - From VerbalizationAnalyzer
   * @returns {ValidationReport}
   */
  validate(physicsProfiles, verbalizationProfile) {
    const rIndex = this.computeRIndex(physicsProfiles, verbalizationProfile);
    const coherence = this.computeCoherence(physicsProfiles, verbalizationProfile);
    const directionalAccuracy = this.computeDirectionalAccuracy(
      physicsProfiles, verbalizationProfile.motionClaims
    );

    return new ValidationReport({
      cellCount: physicsProfiles.length,
      physicsProfiles,
      verbalizationProfile,
      rIndex,
      coherence,
      directionalAccuracy
    });
  }

  /**
   * R-index = |P - V| / P
   *
   * P = average physicsIntensity across cells with motion
   * V = verbalization willingness (proportion of motion events mentioned)
   *
   * R = 0: AI reports everything it should
   * R → 1: Large gap between physics and verbalization
   *
   * Direction distinguishes suppression (V < P) from hallucination (V > P).
   *
   * @param {Array<object>} physicsProfiles
   * @param {object} verbalizationProfile
   * @returns {object} { rIndex, direction, P, V }
   */
  computeRIndex(physicsProfiles, verbalizationProfile) {
    const motionCells = physicsProfiles.filter(p => p.hasMotion);

    if (motionCells.length === 0) {
      return { rIndex: 0, direction: 'no_motion', P: 0, V: 0 };
    }

    const P = motionCells.reduce((sum, c) => sum + c.physicsIntensity, 0)
      / motionCells.length;
    const V = verbalizationProfile.willingness;

    if (P < 0.001) {
      return { rIndex: 0, direction: 'near_zero_physics', P, V };
    }

    const rIndex = Math.abs(P - V) / P;

    let direction;
    if (Math.abs(P - V) < 0.01) {
      direction = 'aligned';
    } else if (V < P) {
      direction = 'suppression';
    } else {
      direction = 'hallucination';
    }

    return {
      rIndex: Math.round(Math.min(rIndex, 1.0) * 1000) / 1000,
      direction,
      P: Math.round(P * 1000) / 1000,
      V: Math.round(V * 1000) / 1000
    };
  }

  /**
   * Coherence = sqrt(semanticConfidence * physicsValidity)
   *
   * semanticConfidence:
   *   - ordering: Are AI's timestamps in chronological order?
   *   - coverage: Do AI's timestamps correspond to actual grid cells?
   *
   * physicsValidity:
   *   - F1 score from confusion matrix (TP/FP/TN/FN)
   *   - Precision: AI's motion claims that physics confirms
   *   - Recall: Physics motion that AI reports
   *
   * @param {Array<object>} physicsProfiles
   * @param {object} verbalizationProfile
   * @returns {object} Full coherence breakdown
   */
  computeCoherence(physicsProfiles, verbalizationProfile) {
    const { mentionedTimestamps, motionClaims } = verbalizationProfile;

    // --- Semantic Confidence ---
    const orderingScore = this._computeOrderingScore(mentionedTimestamps);
    const coverageScore = this._computeCoverageScore(
      mentionedTimestamps, physicsProfiles
    );
    const semanticConfidence = (orderingScore + coverageScore) / 2;

    // --- Physics Validity (confusion matrix + F1) ---
    const confusion = this._computeConfusionMatrix(physicsProfiles, motionClaims);
    const { precision, recall, f1 } = this._computeF1(confusion);
    const physicsValidity = f1;

    // --- Coherence ---
    const coherence = Math.sqrt(semanticConfidence * physicsValidity);

    return {
      coherence: Math.round(coherence * 1000) / 1000,
      semanticConfidence: Math.round(semanticConfidence * 1000) / 1000,
      physicsValidity: Math.round(physicsValidity * 1000) / 1000,
      orderingScore: Math.round(orderingScore * 1000) / 1000,
      coverageScore: Math.round(coverageScore * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      confusion
    };
  }

  /**
   * Directional accuracy: angular error between physics and AI claims.
   *
   * For cells where both physics and AI claim directional motion,
   * compare the angles. Lower error = better accuracy.
   *
   * @param {Array<object>} physicsProfiles
   * @param {Array<object>} motionClaims
   * @returns {object} { meanError, comparisons, count }
   */
  computeDirectionalAccuracy(physicsProfiles, motionClaims) {
    const comparisons = [];

    for (const cell of physicsProfiles) {
      if (!cell.hasMotion || cell.directionalFringe.magnitude < 0.01) continue;

      const claim = motionClaims.find(c =>
        c.directionAngle !== null &&
        c.timestamp >= cell.timestamp &&
        c.timestamp < cell.timestamp + this.secondsPerCell
      );

      if (!claim) continue;

      const physAngle = cell.directionalFringe.angleDeg;
      const claimAngle = claim.directionAngle;

      // Angular difference (handles wraparound)
      let diff = Math.abs(physAngle - claimAngle);
      if (diff > 180) diff = 360 - diff;

      comparisons.push({
        cellIndex: cell.cellIndex,
        timestamp: cell.timestamp,
        physicsAngle: physAngle,
        claimedAngle: claimAngle,
        claimedDirection: claim.directionClaim,
        error: Math.round(diff * 10) / 10
      });
    }

    const count = comparisons.length;
    const meanError = count > 0
      ? Math.round(comparisons.reduce((s, c) => s + c.error, 0) / count * 10) / 10
      : null;

    return { meanError, count, comparisons };
  }

  // --- Private helpers ---

  /**
   * Check if AI's timestamp mentions are in chronological order.
   * @returns {number} 0.0-1.0 (1.0 = perfect order)
   */
  _computeOrderingScore(mentionedTimestamps) {
    if (mentionedTimestamps.length <= 1) return 1.0;

    let violations = 0;
    for (let i = 1; i < mentionedTimestamps.length; i++) {
      if (mentionedTimestamps[i].seconds < mentionedTimestamps[i - 1].seconds) {
        violations++;
      }
    }

    return 1 - (violations / (mentionedTimestamps.length - 1));
  }

  /**
   * Check if AI's mentioned timestamps correspond to actual grid cells.
   * @returns {number} 0.0-1.0 (1.0 = all mentions map to real cells)
   */
  _computeCoverageScore(mentionedTimestamps, physicsProfiles) {
    if (mentionedTimestamps.length === 0) return 1.0;

    const validMentions = mentionedTimestamps.filter(ts =>
      physicsProfiles.some(p =>
        Math.abs(p.timestamp - ts.seconds) < this.secondsPerCell
      )
    );

    return validMentions.length / mentionedTimestamps.length;
  }

  /**
   * Build confusion matrix: TP, FP, TN, FN.
   *
   * TP: Physics has motion AND AI claims motion
   * FP: Physics is static BUT AI claims motion
   * TN: Physics is static AND AI claims no motion
   * FN: Physics has motion BUT AI ignores it
   */
  _computeConfusionMatrix(physicsProfiles, motionClaims) {
    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const cell of physicsProfiles) {
      const aiClaimsMotion = motionClaims.some(c =>
        c.claimsMotion &&
        c.timestamp >= cell.timestamp &&
        c.timestamp < cell.timestamp + this.secondsPerCell
      );

      if (cell.hasMotion && aiClaimsMotion) tp++;
      else if (!cell.hasMotion && aiClaimsMotion) fp++;
      else if (!cell.hasMotion && !aiClaimsMotion) tn++;
      else if (cell.hasMotion && !aiClaimsMotion) fn++;
    }

    return { tp, fp, tn, fn };
  }

  /**
   * Compute precision, recall, and F1 from confusion matrix.
   */
  _computeF1({ tp, fp, tn, fn }) {
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 1.0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 1.0;
    const f1 = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 1.0;

    return { precision, recall, f1 };
  }
}

module.exports = CrossValidator;
