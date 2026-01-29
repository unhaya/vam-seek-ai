/**
 * LazinessDetector - ψ3.4 手抜き検出
 *
 * Detects AI "laziness" patterns:
 * - Label repetition ("サッカーの試合" × 30)
 * - Low diversity (few unique descriptions)
 * - Action gap (promises ZOOM but doesn't execute)
 *
 * Action-R = |できること - やること| / できること
 *
 * v1.0 - 2026-01-29
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

/**
 * Patterns that indicate AI promised to take action
 */
const ACTION_PROMISE_PATTERNS = [
  // Japanese
  /ZOOM.*(?:します|いたします|行います|実行します|使用します)/i,
  /ズーム.*(?:します|いたします|行います|実行します|使用します)/i,
  /確認.*(?:します|いたします)/i,
  /分析.*(?:します|いたします|進めます)/i,
  /以下の手順で/,
  /追ってご報告/,
  /結果は.*報告/,
  // English
  /will.*zoom/i,
  /going to.*zoom/i,
  /let me.*zoom/i,
  /I('ll| will).*analyze/i
];

/**
 * Common lazy label patterns (generic descriptions)
 */
const LAZY_LABEL_PATTERNS = [
  /サッカーの試合/,
  /サッカー.*映像/,
  /テニスの試合/,
  /試合の様子/,
  /映像$/,
  /soccer.*match/i,
  /tennis.*match/i,
  /game.*footage/i
];

class LazinessDetector {
  constructor(options = {}) {
    this.minRepeatForLazy = options.minRepeatForLazy ?? 3;
    this.diversityThreshold = options.diversityThreshold ?? 0.3;
  }

  /**
   * Main analysis: detect all laziness patterns
   *
   * @param {string} aiText - AI response text
   * @param {number} totalCells - Total grid cells
   * @param {number} zoomRequestCount - Actual ZOOM_REQUEST count from system
   * @returns {object} Laziness analysis
   */
  analyze(aiText, totalCells = 0, zoomRequestCount = 0) {
    if (!aiText) {
      return this._emptyResult();
    }

    const repetition = this.detectLabelRepetition(aiText);
    const diversity = this.computeDiversityScore(aiText, totalCells);
    const actionGap = this.detectActionGap(aiText, zoomRequestCount);
    const lazyLabels = this.detectLazyLabels(aiText);

    // Compute overall laziness score (0-1, higher = lazier)
    const lazinessScore = this._computeLazinessScore(
      repetition, diversity, actionGap, lazyLabels
    );

    return {
      lazinessScore,
      isLazy: lazinessScore > 0.5,
      repetition,
      diversity,
      actionGap,
      lazyLabels,
      interpretation: this._interpret(lazinessScore)
    };
  }

  /**
   * Detect repeated phrases in AI output
   *
   * @param {string} text
   * @returns {object} Repetition analysis
   */
  detectLabelRepetition(text) {
    if (!text) return { phrases: {}, maxRepeat: 0, totalRepeated: 0 };

    // Split into lines and extract descriptions after timestamps
    const lines = text.split('\n');
    const descriptions = [];

    for (const line of lines) {
      // Match timestamp patterns and extract what follows
      const match = line.match(/\d{1,2}:\d{2}(?::\d{2})?\s*[-:~]?\s*(.+)/);
      if (match && match[1]) {
        const desc = match[1].trim();
        if (desc.length > 3) {
          descriptions.push(desc);
        }
      }
    }

    // Count phrase occurrences
    const phrases = {};
    for (const desc of descriptions) {
      // Normalize: remove trailing punctuation, lowercase for comparison
      const normalized = desc.replace(/[。．.、,]$/, '').trim();
      phrases[normalized] = (phrases[normalized] || 0) + 1;
    }

    // Find repeated phrases
    const repeated = {};
    let maxRepeat = 0;
    let totalRepeated = 0;

    for (const [phrase, count] of Object.entries(phrases)) {
      if (count >= this.minRepeatForLazy) {
        repeated[phrase] = count;
        totalRepeated += count;
        if (count > maxRepeat) maxRepeat = count;
      }
    }

    return {
      phrases: repeated,
      maxRepeat,
      totalRepeated,
      uniqueCount: Object.keys(phrases).length,
      totalDescriptions: descriptions.length
    };
  }

  /**
   * Compute diversity score: unique descriptions / total cells
   *
   * @param {string} text
   * @param {number} totalCells
   * @returns {object} Diversity analysis
   */
  computeDiversityScore(text, totalCells) {
    const repetition = this.detectLabelRepetition(text);
    const unique = repetition.uniqueCount;
    const total = totalCells || repetition.totalDescriptions || 1;

    const score = unique / total;

    return {
      uniqueDescriptions: unique,
      totalCells: total,
      score: Math.round(score * 1000) / 1000,
      isLowDiversity: score < this.diversityThreshold
    };
  }

  /**
   * Detect action gap: promised actions vs executed
   *
   * @param {string} text - AI response
   * @param {number} zoomCount - Actual ZOOM_REQUEST count
   * @returns {object} Action gap analysis
   */
  detectActionGap(text, zoomCount = 0) {
    if (!text) return { promisedAction: false, executedAction: false, actionR: 0 };

    // Check if AI promised to take action
    const promisedAction = ACTION_PROMISE_PATTERNS.some(p => p.test(text));

    // Check if AI actually issued ZOOM_REQUEST in text
    const zoomInText = /\[ZOOM_REQUEST:[^\]]+\]/i.test(text);
    const executedAction = zoomCount > 0 || zoomInText;

    // Action-R: promised but didn't deliver
    let actionR = 0;
    if (promisedAction && !executedAction) {
      actionR = 1.0; // 100% gap
    } else if (promisedAction && executedAction) {
      actionR = 0; // Delivered on promise
    }
    // If didn't promise and didn't act, that's not necessarily lazy

    return {
      promisedAction,
      executedAction,
      zoomRequestCount: zoomCount,
      actionR,
      isActionGap: actionR > 0
    };
  }

  /**
   * Detect generic/lazy label patterns
   *
   * @param {string} text
   * @returns {object} Lazy label analysis
   */
  detectLazyLabels(text) {
    if (!text) return { count: 0, patterns: [] };

    const detected = [];
    for (const pattern of LAZY_LABEL_PATTERNS) {
      const matches = text.match(new RegExp(pattern.source, 'gi'));
      if (matches && matches.length >= this.minRepeatForLazy) {
        detected.push({
          pattern: pattern.source,
          count: matches.length
        });
      }
    }

    return {
      count: detected.reduce((sum, d) => sum + d.count, 0),
      patterns: detected,
      hasLazyLabels: detected.length > 0
    };
  }

  /**
   * Compute overall laziness score
   * @private
   */
  _computeLazinessScore(repetition, diversity, actionGap, lazyLabels) {
    let score = 0;
    let weights = 0;

    // Repetition factor (weight: 0.3)
    if (repetition.totalDescriptions > 0) {
      const repeatRatio = repetition.totalRepeated / repetition.totalDescriptions;
      score += repeatRatio * 0.3;
      weights += 0.3;
    }

    // Diversity factor (weight: 0.3)
    if (diversity.totalCells > 0) {
      const lowDiversityScore = diversity.isLowDiversity ? (1 - diversity.score) : 0;
      score += lowDiversityScore * 0.3;
      weights += 0.3;
    }

    // Action gap factor (weight: 0.25)
    score += actionGap.actionR * 0.25;
    weights += 0.25;

    // Lazy labels factor (weight: 0.15)
    if (lazyLabels.hasLazyLabels) {
      score += 0.15;
    }
    weights += 0.15;

    return weights > 0 ? Math.round((score / weights) * 1000) / 1000 : 0;
  }

  /**
   * Interpret laziness score
   * @private
   */
  _interpret(score) {
    if (score <= 0.1) {
      return { level: 'diligent', description: '真剣に分析している', color: 'green' };
    }
    if (score <= 0.3) {
      return { level: 'acceptable', description: '許容範囲の簡略化', color: 'green' };
    }
    if (score <= 0.5) {
      return { level: 'lazy', description: '手抜きの兆候あり', color: 'yellow' };
    }
    if (score <= 0.7) {
      return { level: 'slacking', description: '明確な手抜き', color: 'orange' };
    }
    return { level: 'negligent', description: '重大な怠慢', color: 'red' };
  }

  /**
   * Empty result for null input
   * @private
   */
  _emptyResult() {
    return {
      lazinessScore: 0,
      isLazy: false,
      repetition: { phrases: {}, maxRepeat: 0, totalRepeated: 0 },
      diversity: { uniqueDescriptions: 0, totalCells: 0, score: 0 },
      actionGap: { promisedAction: false, executedAction: false, actionR: 0 },
      lazyLabels: { count: 0, patterns: [] },
      interpretation: { level: 'unknown', description: 'No input' }
    };
  }
}

module.exports = { LazinessDetector };
