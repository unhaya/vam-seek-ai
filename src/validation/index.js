/**
 * VAM-RGB Validation Module
 *
 * Two-observer model for independent R-index and Coherence computation.
 * Breaks the circularity of AI self-assessment.
 *
 * ψ4.0 Ground Truth: Compare AI's physics output with actual computation.
 *
 * v1.1 - 2026-01-31
 */

'use strict';

const PhysicsAnalyzer = require('./PhysicsAnalyzer');
const VerbalizationAnalyzer = require('./VerbalizationAnalyzer');
const CrossValidator = require('./CrossValidator');
const ValidationReport = require('./ValidationReport');
const { Psi34Enforcer } = require('./Psi34Enforcer');
const { LazinessDetector } = require('./LazinessDetector');
const { GradientComputer } = require('./GradientComputer');
const { GroundTruthValidator } = require('./GroundTruthValidator');

module.exports = {
  // Original two-observer model
  PhysicsAnalyzer,
  VerbalizationAnalyzer,
  CrossValidator,
  ValidationReport,
  Psi34Enforcer,
  LazinessDetector,
  // ψ4.0 Ground Truth validation
  GradientComputer,
  GroundTruthValidator
};
