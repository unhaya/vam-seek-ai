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

module.exports = {
  PhysicsAnalyzer,
  VerbalizationAnalyzer,
  CrossValidator,
  ValidationReport
};
