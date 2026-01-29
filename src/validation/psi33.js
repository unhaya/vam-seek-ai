/**
 * ψ3.3 Control Paradigm - Validation Module
 *
 * Exports all components needed for ψ3.3 validation:
 * - PhysicsAnalyzer: Computes P (physics intensity)
 * - ResponseParser: Estimates V (verbalization willingness)
 * - RIndexCalculator: Computes R = |P - V| / P
 *
 * Usage:
 *   const { Psi33Validator } = require('./validation/psi33');
 *   const validator = new Psi33Validator();
 *   const result = validator.validate(cellImageData, aiResponse, queryType);
 *
 * 「縛らなくてもちゃんとやってる」を検証するためのツールキット
 *
 * Part of VAM-RGB ψ3.3 Control Paradigm
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

const PhysicsAnalyzer = require('./PhysicsAnalyzer');
const { ResponseParser } = require('./ResponseParser');
const { RIndexCalculator } = require('./RIndexCalculator');
const { Psi34Enforcer } = require('./Psi34Enforcer');
const { LazinessDetector } = require('./LazinessDetector');

/**
 * Psi33Validator - Unified validation interface
 *
 * Combines PhysicsAnalyzer, ResponseParser, and RIndexCalculator
 * into a single validation pipeline.
 */
class Psi33Validator {

  constructor(config = {}) {
    this.physics = new PhysicsAnalyzer(config.physics || {});
    this.parser = new ResponseParser(config.parser || {});
    this.calculator = new RIndexCalculator(config.calculator || {});
  }

  /**
   * Validate a single cell-response pair
   *
   * @param {object} cellImageData - { data: Uint8ClampedArray, width, height }
   * @param {string} aiResponse - AI response text
   * @param {object} options
   * @param {string} [options.queryType='description'] - 'timestamp'|'description'|'count'|'presence'
   * @param {number} [options.cellIndex=0]
   * @param {number} [options.timestamp=0]
   * @param {string} [options.originalQuery=''] - Original query for layer detection
   * @returns {object} Validation result with P, V, R, layer, and interpretation
   */
  validate(cellImageData, aiResponse, options = {}) {
    const {
      queryType = 'description',
      cellIndex = 0,
      timestamp = 0,
      originalQuery = ''
    } = options;

    // Step 1: Compute P (physics intensity)
    const physicsProfile = this.physics.analyze(cellImageData, cellIndex, timestamp);
    const P = physicsProfile.physicsIntensity;

    // Step 2: Estimate V (verbalization willingness)
    const responseAnalysis = this.parser.analyze(aiResponse, queryType);
    const V = responseAnalysis.verbalizationScore;

    // Step 3: Detect layer (3-Layer Model)
    const layerInfo = this.parser.detectLayer(aiResponse, originalQuery);
    const Q = originalQuery ? this.parser.estimateQ(originalQuery) : layerInfo.qEstimate;

    // Step 4: Compute R-index with layer awareness
    const validation = this.calculator.validateWithLayer(P, V, layerInfo.layer, Q);

    return {
      // Input metadata
      cellIndex,
      timestamp,
      queryType,

      // P (Physics)
      physicsIntensity: P,
      physicsProfile,

      // V (Verbalization)
      verbalizationScore: V,
      responseAnalysis,

      // R (R-index)
      rIndex: validation.rIndex,
      interpretation: validation.interpretation,
      result: validation.result,

      // 3-Layer Model
      layer: layerInfo.layer,
      layerInfo,
      qEstimate: Q,
      controlScore: validation.psi33.controlScore,

      // ψ3.3 specifics
      psi33: validation.psi33
    };
  }

  /**
   * Batch validate multiple cell-response pairs
   *
   * @param {Array} testCases - Array of { cellImageData, aiResponse, options }
   * @returns {object} { results, summary, report }
   */
  validateBatch(testCases) {
    const results = testCases.map((tc, idx) =>
      this.validate(tc.cellImageData, tc.aiResponse, {
        ...tc.options,
        cellIndex: tc.options?.cellIndex ?? idx
      })
    );

    // Build summary using RIndexCalculator
    const pvPairs = results.map(r => ({
      physicsIntensity: r.physicsIntensity,
      verbalizationScore: r.verbalizationScore
    }));
    const summary = this.calculator.summarize(pvPairs);

    return {
      results,
      summary,
      // Quick access
      passRate: summary.passRate,
      averageR: summary.averageR,
      conclusion: this.calculator._generateConclusion ?
        this.calculator._generateConclusion(summary) :
        { status: summary.passed === summary.total ? 'VALIDATED' : 'PARTIAL' }
    };
  }

  /**
   * Generate full validation report
   *
   * @param {Array} testCases
   * @param {object} metadata - { model, timestamp, version }
   * @returns {object} Full ψ3.3 validation report
   */
  generateReport(testCases, metadata = {}) {
    const { results, summary } = this.validateBatch(testCases);

    // Layer distribution
    const layerDistribution = { task: 0, structure: 0, meta: 0 };
    const controlScores = [];
    results.forEach(r => {
      if (r.layer) layerDistribution[r.layer]++;
      if (r.controlScore !== undefined) controlScores.push(r.controlScore);
    });
    const avgControlScore = controlScores.length > 0
      ? Math.round(controlScores.reduce((a, b) => a + b, 0) / controlScores.length * 1000) / 1000
      : 0;

    return {
      version: '3.3',
      timestamp: metadata.timestamp || new Date().toISOString(),
      model: metadata.model || 'unknown',
      encoder: 'VAM-RGB ψ3.3',
      paradigm: 'ψ3.3 Control Paradigm (3-Layer Model)',

      testCases: results,
      summary,

      // 3-Layer Model metrics
      layerMetrics: {
        distribution: layerDistribution,
        averageControlScore: avgControlScore,
        layerAlignmentRate: results.filter(r => r.psi33?.layerAlignment === 'aligned').length / results.length
      },

      // ψ3.3 conclusion
      conclusion: summary.passed === summary.total
        ? {
            status: 'VALIDATED',
            message: '「縛らなくてもちゃんとやってる」確認',
            messageEn: 'AI self-regulates properly without external constraints',
            controlScore: avgControlScore
          }
        : {
            status: 'PARTIAL',
            message: '一部の応答で知覚-言語化ギャップを検出',
            messageEn: 'Perception-verbalization gap detected in some responses',
            controlScore: avgControlScore
          }
    };
  }
}

module.exports = {
  PhysicsAnalyzer,
  ResponseParser,
  RIndexCalculator,
  Psi33Validator,
  Psi34Enforcer,
  LazinessDetector
};
