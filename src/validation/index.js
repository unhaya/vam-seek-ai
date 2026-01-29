/**
 * VAM-RGB Validation Module
 *
 * Two-observer model for independent R-index and Coherence computation.
 * Breaks the circularity of AI self-assessment.
 *
 * v1.0 - 2026-01-28
 */

'use strict';

const PhysicsAnalyzer = require('./PhysicsAnalyzer');
const VerbalizationAnalyzer = require('./VerbalizationAnalyzer');
const CrossValidator = require('./CrossValidator');
const ValidationReport = require('./ValidationReport');
const { Psi34Enforcer } = require('./Psi34Enforcer');
const { LazinessDetector } = require('./LazinessDetector');

module.exports = {
  PhysicsAnalyzer,
  VerbalizationAnalyzer,
  CrossValidator,
  ValidationReport,
  Psi34Enforcer,
  LazinessDetector
};
