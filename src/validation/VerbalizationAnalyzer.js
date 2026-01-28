/**
 * VerbalizationAnalyzer - Observer 2: AI Output Text Analysis
 *
 * Measures verbalization willingness (V) from AI response text only.
 * Has ZERO access to pixel data. This is the "AI behavior" side
 * of the two-observer validation model.
 *
 * Input: AI response text string + grid temporal structure
 * Output: VerbalizationProfile with timestamp mentions, motion claims, V score
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

/**
 * Bilingual motion keyword lexicon.
 * Categories: direction, speed, motion verbs, intensity
 */
const MOTION_KEYWORDS = {
  direction: {
    right: ['right', '右', '→', '右方向', '右側', '右へ'],
    left: ['left', '左', '←', '左方向', '左側', '左へ'],
    up: ['up', 'upward', '上', '↑', '上方向', '上昇'],
    down: ['down', 'downward', '下', '↓', '下方向', '下降', '落下'],
    forward: ['forward', 'toward', '前', '前方', '近づ', '接近'],
    backward: ['backward', 'away', '後', '後方', '離れ', '遠ざか']
  },
  speed: [
    'fast', 'quick', 'rapid', 'sudden', 'swift',
    'slow', 'gradual', 'gentle',
    'accelerat', 'decelerat',
    '速い', '速く', '急', '素早', '高速',
    '遅い', '遅く', '緩やか', 'ゆっくり',
    '加速', '減速'
  ],
  motion: [
    'move', 'moving', 'motion', 'movement',
    'walk', 'run', 'jump', 'fall', 'rise', 'slide', 'shift',
    'pan', 'tilt', 'zoom', 'shake', 'swing', 'flow', 'drift',
    'rotate', 'spin', 'turn', 'roll',
    '動き', '動く', '動いて', '移動', '走', '歩', '跳',
    '揺れ', '振動', '回転', '旋回', 'パン', 'ティルト',
    '流れ', '変化', '変わ'
  ],
  intensity: [
    'intense', 'strong', 'violent', 'dramatic', 'extreme',
    'weak', 'subtle', 'mild', 'slight',
    '激し', '強い', '劇的', '大きな動き',
    '弱い', '穏やか', '微妙', 'わずか'
  ]
};

/**
 * Negation keywords that cancel motion detection when
 * found in the same context window.
 * "動きが停止" = motion stopped → NOT motion
 */
const NEGATION_KEYWORDS = [
  'static', 'still', 'stopped', 'no motion', 'no movement', 'stationary',
  '静止', '停止', '止ま', '動きなし', '動かない', '動いていない',
  '変化なし', '変化はない'
];

/**
 * Map direction keywords to angle (degrees).
 * 0=right, 90=down (image coordinate system)
 */
const DIRECTION_ANGLES = {
  right: 0,
  left: 180,
  up: 270,
  down: 90,
  forward: 0,  // approximate
  backward: 180
};

class VerbalizationAnalyzer {
  /**
   * @param {object} options
   * @param {number} [options.contextWindow=100] - Characters around timestamp for keyword search
   * @param {number} [options.secondsPerCell=15] - Grid cell interval in seconds
   */
  constructor(options = {}) {
    this.contextWindow = options.contextWindow ?? 100;
    this.secondsPerCell = options.secondsPerCell ?? 15;
  }

  /**
   * Compute full verbalization profile from AI response text.
   *
   * @param {string} aiText - The AI's response text
   * @param {Array<object>} physicsProfiles - From PhysicsAnalyzer (for V computation)
   * @returns {object} VerbalizationProfile
   */
  analyze(aiText, physicsProfiles) {
    const mentionedTimestamps = this.extractMentionedTimestamps(aiText);
    const motionClaims = this.extractMotionClaims(aiText, mentionedTimestamps);
    const willingness = this.computeVerbalizationWillingness(
      physicsProfiles, motionClaims
    );

    return {
      mentionedTimestamps,
      motionClaims,
      willingness,
      totalTimestampMentions: mentionedTimestamps.length,
      totalMotionClaims: motionClaims.filter(c => c.claimsMotion).length
    };
  }

  /**
   * Extract all timestamps mentioned in AI text.
   * Matches: M:SS, MM:SS, H:MM:SS formats
   *
   * @param {string} text
   * @returns {Array<{seconds: number, originalText: string, position: number}>}
   */
  extractMentionedTimestamps(text) {
    if (!text) return [];

    const results = [];
    // Match M:SS, MM:SS, or H:MM:SS patterns
    const pattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      let seconds;
      if (match[3] !== undefined) {
        // H:MM:SS format
        seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
      } else {
        // M:SS format
        seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
      }

      results.push({
        seconds,
        originalText: match[0],
        position: match.index
      });
    }

    return results;
  }

  /**
   * Extract motion claims around each timestamp mention.
   * Searches a context window around the timestamp for motion keywords.
   *
   * @param {string} text - AI response text
   * @param {Array<object>} timestamps - From extractMentionedTimestamps
   * @returns {Array<object>} Motion claims per timestamp
   */
  extractMotionClaims(text, timestamps) {
    if (!text || !timestamps.length) return [];

    return timestamps.map((ts, idx) => {
      // Limit context to text between this timestamp and the next one.
      // This prevents bleed from adjacent timestamp entries.
      const tsEnd = ts.position + ts.originalText.length;
      const nextTsStart = idx < timestamps.length - 1
        ? timestamps[idx + 1].position
        : text.length;
      // Limit forward context to next timestamp
      const maxEnd = Math.min(nextTsStart, tsEnd + this.contextWindow);
      // Start exactly at timestamp position (no lookback to avoid cross-bleed)
      const start = ts.position;
      const context = text.slice(start, maxEnd);
      const contextLower = context.toLowerCase();

      // Check for motion keywords in context
      const hasMotionVerb = MOTION_KEYWORDS.motion.some(kw =>
        contextLower.includes(kw.toLowerCase())
      );

      const hasSpeedRef = MOTION_KEYWORDS.speed.some(kw =>
        contextLower.includes(kw.toLowerCase())
      );

      const hasIntensityRef = MOTION_KEYWORDS.intensity.some(kw =>
        contextLower.includes(kw.toLowerCase())
      );

      // Detect direction claim
      let directionClaim = null;
      let directionAngle = null;
      for (const [dir, keywords] of Object.entries(MOTION_KEYWORDS.direction)) {
        if (keywords.some(kw => contextLower.includes(kw.toLowerCase()))) {
          directionClaim = dir;
          directionAngle = DIRECTION_ANGLES[dir] ?? null;
          break;
        }
      }

      // Check for negation keywords ("停止", "静止", "no motion", etc.)
      // These cancel out motion detection in the same context
      const hasNegation = NEGATION_KEYWORDS.some(kw =>
        contextLower.includes(kw.toLowerCase())
      );

      const claimsMotion = !hasNegation && (hasMotionVerb || hasSpeedRef || directionClaim !== null);

      return {
        timestamp: ts.seconds,
        originalText: ts.originalText,
        claimsMotion,
        directionClaim,
        directionAngle,
        hasMotionVerb,
        hasSpeedRef,
        hasIntensityRef,
        contextSnippet: context.replace(/\n/g, ' ').trim()
      };
    });
  }

  /**
   * Compute Verbalization Willingness (V).
   *
   * V measures the physics-intensity-weighted coverage of AI's verbalization.
   * For each motion cell: if AI mentions it, that cell's physicsIntensity
   * contributes to V. If not, it contributes 0.
   *
   * V = sum(P_i for mentioned motion cells) / count(motion cells)
   *
   * This ensures V is on the same scale as P (physicsIntensity average),
   * making R = |P - V| / P meaningful.
   *
   * V = P when all motion is verbalized → R = 0
   * V = 0 when all motion is suppressed → R = 1
   *
   * @param {Array<object>} physicsProfiles - From PhysicsAnalyzer
   * @param {Array<object>} motionClaims - From extractMotionClaims
   * @returns {number} 0.0+ (same scale as physicsIntensity)
   */
  computeVerbalizationWillingness(physicsProfiles, motionClaims) {
    const motionCells = physicsProfiles.filter(p => p.hasMotion);
    if (motionCells.length === 0) return 0; // Nothing to verbalize, V=0, P=0

    let verbalizedIntensity = 0;

    for (const cell of motionCells) {
      const cellStart = cell.timestamp;
      const cellEnd = cell.timestamp + this.secondsPerCell;

      const mentioned = motionClaims.some(c =>
        c.claimsMotion &&
        c.timestamp >= cellStart &&
        c.timestamp < cellEnd
      );

      if (mentioned) {
        verbalizedIntensity += cell.physicsIntensity;
      }
    }

    return Math.round((verbalizedIntensity / motionCells.length) * 1000) / 1000;
  }
}

// Support both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VerbalizationAnalyzer;
}
if (typeof window !== 'undefined') {
  window.VerbalizationAnalyzer = VerbalizationAnalyzer;
}
