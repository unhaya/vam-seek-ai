/**
 * QueryRouter - ψ4.0 Query Quarantine Pipeline
 *
 * Routes queries through de-semantification:
 * 1. User query (semantic) → DeSemanticizer → Physics query
 * 2. Physics query → AI → Physics response (JSON)
 * 3. Physics response → Reconstruct → Semantic answer
 *
 * The AI never sees the semantic intent.
 *
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

const { DeSemanticizer } = require('./DeSemanticizer');

/**
 * Sensitive concept patterns that should trigger quarantine
 */
const SENSITIVE_PATTERNS = [
  // Body-related
  /パンツ|下着|underwear|panties/i,
  /裸|nude|naked/i,
  /胸|おっぱい|breast|chest/i,
  /お尻|尻|butt|ass/i,

  // Violence-adjacent
  /血|blood/i,
  /傷|wound|injury/i,

  // Generic privacy
  /顔|face/i,
  /人物|person|people/i
];

/**
 * Safe patterns that can bypass quarantine
 */
const SAFE_PATTERNS = [
  // Technical queries
  /timestamp|タイムスタンプ/i,
  /motion|動き|移動/i,
  /color|色/i,
  /gradient|勾配/i,
  /brightness|明るさ|輝度/i,

  // Summary queries
  /summary|概要|まとめ/i,
  /overview|全体/i
];

class QueryRouter {
  constructor(config = {}) {
    this.deSemanticizer = new DeSemanticizer(config.deSemanticizer || {});
    this.forceQuarantine = config.forceQuarantine || false;  // Always quarantine
    this.bypassQuarantine = config.bypassQuarantine || false;  // Never quarantine
    this.debug = config.debug || false;
    this.sensitivePatterns = config.sensitivePatterns || SENSITIVE_PATTERNS;
    this.safePatterns = config.safePatterns || SAFE_PATTERNS;
  }

  /**
   * Determine if query should be quarantined
   *
   * @param {string} query - User's query
   * @returns {boolean} True if should quarantine
   */
  shouldQuarantine(query) {
    if (this.bypassQuarantine) return false;
    if (this.forceQuarantine) return true;

    // Check safe patterns first (bypass)
    for (const pattern of this.safePatterns) {
      if (pattern.test(query)) {
        if (this.debug) console.log('[QueryRouter] Safe pattern matched, bypassing quarantine');
        return false;
      }
    }

    // Check sensitive patterns
    for (const pattern of this.sensitivePatterns) {
      if (pattern.test(query)) {
        if (this.debug) console.log('[QueryRouter] Sensitive pattern matched, quarantining');
        return true;
      }
    }

    return false;
  }

  /**
   * Route a query through the quarantine pipeline
   *
   * @param {string} userQuery - Original user query
   * @param {Function} aiCallback - Async function to call AI: (query) => response
   * @returns {Promise<object>} { answer, quarantined, physicsData, confidence }
   */
  async route(userQuery, aiCallback) {
    const shouldQuarantine = this.shouldQuarantine(userQuery);

    if (!shouldQuarantine) {
      // Direct pass-through
      if (this.debug) console.log('[QueryRouter] Direct pass-through (no quarantine)');

      const response = await aiCallback(userQuery);
      return {
        answer: response,
        quarantined: false,
        physicsData: null,
        confidence: null,
        mode: 'direct'
      };
    }

    // Quarantine mode
    if (this.debug) console.log('[QueryRouter] Quarantine mode activated');

    // Step 1: De-semantify
    const quarantineResult = this.deSemanticizer.quarantine(userQuery);

    // Step 2: Send physics query to AI
    const physicsResponse = await aiCallback(quarantineResult.physicsQuery);

    // Step 3: Reconstruct semantic answer
    const reconstructed = this.deSemanticizer.reconstruct(physicsResponse, quarantineResult);

    return {
      answer: reconstructed.semanticAnswer,
      quarantined: true,
      physicsData: reconstructed.blocks,
      confidence: reconstructed.confidence,
      mode: 'quarantined',
      queryType: quarantineResult.queryType,
      physicsQuery: quarantineResult.physicsQuery,
      rawResponse: physicsResponse
    };
  }

  /**
   * Route with Cell Isolation (query each cell separately)
   *
   * @param {string} userQuery
   * @param {number} totalCells - Total cells in grid
   * @param {Function} aiCallback - (query, cellIndex) => response
   * @param {object} options - { parallel: true, maxConcurrent: 3 }
   * @returns {Promise<object>}
   */
  async routeWithCellIsolation(userQuery, totalCells, aiCallback, options = {}) {
    const { parallel = false, maxConcurrent = 3 } = options;

    const quarantineResult = this.deSemanticizer.quarantine(userQuery);
    const allBlocks = [];

    if (parallel) {
      // Process cells in batches
      for (let i = 0; i < totalCells; i += maxConcurrent) {
        const batch = [];
        for (let j = i; j < Math.min(i + maxConcurrent, totalCells); j++) {
          const cellQuery = this.deSemanticizer.getCellIsolationQuery(
            j,
            quarantineResult.physicsQuery
          );
          batch.push(aiCallback(cellQuery, j));
        }

        const responses = await Promise.all(batch);
        for (const response of responses) {
          const parsed = this._parseCellResponse(response);
          if (parsed.blocks) {
            allBlocks.push(...parsed.blocks);
          }
        }
      }
    } else {
      // Sequential processing
      for (let i = 0; i < totalCells; i++) {
        const cellQuery = this.deSemanticizer.getCellIsolationQuery(
          i,
          quarantineResult.physicsQuery
        );
        const response = await aiCallback(cellQuery, i);
        const parsed = this._parseCellResponse(response);
        if (parsed.blocks) {
          allBlocks.push(...parsed.blocks);
        }
      }
    }

    // Reconstruct from aggregated blocks
    const reconstructed = this.deSemanticizer.reconstruct(
      JSON.stringify(allBlocks),
      quarantineResult
    );

    return {
      answer: reconstructed.semanticAnswer,
      quarantined: true,
      cellIsolation: true,
      physicsData: allBlocks,
      confidence: reconstructed.confidence,
      mode: 'cell_isolated',
      totalCells
    };
  }

  /**
   * Parse cell response JSON
   * @private
   */
  _parseCellResponse(response) {
    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { cell: parsed.cell, blocks: parsed.blocks || [] };
      }
    } catch (e) {
      // Ignore parse errors
    }
    return { blocks: [] };
  }

  /**
   * Get physics-only prompt for manual use
   *
   * @param {string} userQuery
   * @returns {string} Physics query
   */
  getPhysicsPrompt(userQuery) {
    return this.deSemanticizer.quarantine(userQuery).physicsQuery;
  }

  /**
   * Add custom sensitive pattern
   *
   * @param {RegExp} pattern
   */
  addSensitivePattern(pattern) {
    this.sensitivePatterns.push(pattern);
  }

  /**
   * Add custom safe pattern
   *
   * @param {RegExp} pattern
   */
  addSafePattern(pattern) {
    this.safePatterns.push(pattern);
  }
}

module.exports = { QueryRouter, SENSITIVE_PATTERNS, SAFE_PATTERNS };
