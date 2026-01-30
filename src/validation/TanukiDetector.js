/**
 * TanukiDetector - くさび（Wedge）: AI幻想検出器
 *
 * AIが「物理」を見ずに「物語」で語ったかどうかを検出する。
 *
 * 原理:
 * 1. AIの出力から「物理的主張」を抽出（強度、方向、フリンジ等）
 * 2. PhysicsAnalyzerの実測値と比較
 * 3. 乖離があれば「タヌキ」（物語に逃げた）としてフラグ
 *
 * タヌキは言葉で逃げる。だから言葉より先に数字を置く。
 *
 * v1.0 - 2026-01-31
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

'use strict';

/**
 * 強度に関する主張パターン
 * AIが「激しい」「強い」等と言ったら、physicsIntensity > 0.15 を期待
 */
const INTENSITY_CLAIMS = {
  high: {
    patterns: [
      /激し[いく]/,
      /強[いく]/,
      /大きな?動き/,
      /劇的/,
      /extreme/i,
      /intense/i,
      /strong/i,
      /violent/i,
      /dramatic/i,
      /significant\s*motion/i,
      /heavy\s*motion/i
    ],
    expectedRange: { min: 0.12, max: 1.0 }
  },
  medium: {
    patterns: [
      /中程度/,
      /ある程度/,
      /moderate/i,
      /some\s*motion/i
    ],
    expectedRange: { min: 0.05, max: 0.25 }
  },
  low: {
    patterns: [
      /弱[いく]/,
      /微妙/,
      /わずか/,
      /ほとんど.*ない/,
      /subtle/i,
      /slight/i,
      /weak/i,
      /minimal/i,
      /little\s*motion/i
    ],
    expectedRange: { min: 0.0, max: 0.08 }
  },
  none: {
    patterns: [
      /静止/,
      /動きなし/,
      /動いていない/,
      /変化なし/,
      /static/i,
      /stationary/i,
      /no\s*motion/i,
      /no\s*movement/i
    ],
    expectedRange: { min: 0.0, max: 0.03 }
  }
};

/**
 * フリンジ（色分離）に関する主張パターン
 */
const FRINGE_CLAIMS = {
  high: {
    patterns: [
      /激しい.*(?:フリンジ|色分離|RGB分離|色ズレ)/,
      /(?:フリンジ|色分離|RGB分離|色ズレ).*激し/,
      /大きな?.*(?:フリンジ|色分離)/,
      /(?:フリンジ|色分離).*大き/,
      /strong.*fringe/i,
      /heavy.*(?:fringe|separation)/i,
      /significant.*(?:fringe|color.*separation)/i
    ],
    expectedRange: { min: 0.10, max: 1.0 }
  },
  low: {
    patterns: [
      /(?:フリンジ|色分離).*(?:少な|弱|小さ)/,
      /(?:少な|弱|小さ).*(?:フリンジ|色分離)/,
      /minimal.*fringe/i,
      /slight.*(?:fringe|separation)/i,
      /little.*(?:fringe|color.*separation)/i
    ],
    expectedRange: { min: 0.0, max: 0.06 }
  }
};

/**
 * 方向に関する主張パターン
 * 角度はimage座標系: 0=右, 90=下, 180=左, 270=上
 */
const DIRECTION_CLAIMS = {
  right: {
    patterns: [/右[へにと方向側]/, /→/, /right/i, /rightward/i],
    expectedAngle: 0,
    tolerance: 60  // ±60度
  },
  left: {
    patterns: [/左[へにと方向側]/, /←/, /left/i, /leftward/i],
    expectedAngle: 180,
    tolerance: 60
  },
  up: {
    patterns: [/上[へにと方向側]/, /↑/, /上昇/, /up/i, /upward/i],
    expectedAngle: 270,
    tolerance: 60
  },
  down: {
    patterns: [/下[へにと方向側]/, /↓/, /下降/, /落下/, /down/i, /downward/i],
    expectedAngle: 90,
    tolerance: 60
  }
};

/**
 * 数値を明示的に主張するパターン
 * 例: "分離度0.3", "フリンジ幅15%", "強度: 0.25"
 */
const NUMERIC_CLAIM_PATTERNS = [
  /(?:分離度|色分離|colorSeparation)[：:\s]*(\d+\.?\d*)/i,
  /(?:フリンジ|fringe)[：:\s]*(\d+\.?\d*)/i,
  /(?:強度|intensity)[：:\s]*(\d+\.?\d*)/i,
  /(?:magnitude)[：:\s]*(\d+\.?\d*)/i
];

class TanukiDetector {
  /**
   * @param {object} options
   * @param {number} [options.intensityTolerance=0.05] - 強度の許容誤差
   * @param {number} [options.angleTolerance=60] - 方向の許容誤差（度）
   * @param {number} [options.secondsPerCell=15] - グリッドセル間隔
   */
  constructor(options = {}) {
    this.intensityTolerance = options.intensityTolerance ?? 0.05;
    this.angleTolerance = options.angleTolerance ?? 60;
    this.secondsPerCell = options.secondsPerCell ?? 15;
  }

  /**
   * メイン検出: AIの物理的主張を実測と照合
   *
   * @param {string} aiText - AI出力テキスト
   * @param {Array<object>} physicsProfiles - PhysicsAnalyzerの実測値
   * @returns {object} TanukiReport
   */
  detect(aiText, physicsProfiles) {
    if (!aiText || !physicsProfiles?.length) {
      return this._emptyReport();
    }

    // タイムスタンプごとのコンテキストを抽出
    const contexts = this._extractTimestampContexts(aiText);

    const claims = [];
    const violations = [];

    for (const ctx of contexts) {
      // 対応する物理プロファイルを特定
      const physics = this._findPhysicsProfile(ctx.timestamp, physicsProfiles);
      if (!physics) continue;

      // 強度の主張を検証
      const intensityClaim = this._checkIntensityClaim(ctx.text, physics);
      if (intensityClaim) {
        claims.push(intensityClaim);
        if (!intensityClaim.matches) {
          violations.push(intensityClaim);
        }
      }

      // フリンジの主張を検証
      const fringeClaim = this._checkFringeClaim(ctx.text, physics);
      if (fringeClaim) {
        claims.push(fringeClaim);
        if (!fringeClaim.matches) {
          violations.push(fringeClaim);
        }
      }

      // 方向の主張を検証
      const directionClaim = this._checkDirectionClaim(ctx.text, physics);
      if (directionClaim) {
        claims.push(directionClaim);
        if (!directionClaim.matches) {
          violations.push(directionClaim);
        }
      }

      // 数値の明示的主張を検証
      const numericClaims = this._checkNumericClaims(ctx.text, physics);
      for (const nc of numericClaims) {
        claims.push(nc);
        if (!nc.matches) {
          violations.push(nc);
        }
      }
    }

    // タヌキスコアを計算
    const tanukiScore = claims.length > 0
      ? violations.length / claims.length
      : 0;

    return {
      tanukiScore: Math.round(tanukiScore * 1000) / 1000,
      isTanuki: tanukiScore > 0.3,  // 30%以上の主張が乖離していればタヌキ
      totalClaims: claims.length,
      totalViolations: violations.length,
      claims,
      violations,
      interpretation: this._interpret(tanukiScore, claims.length)
    };
  }

  /**
   * タイムスタンプとその周辺コンテキストを抽出
   * @private
   */
  _extractTimestampContexts(text) {
    const contexts = [];
    const pattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      let seconds;
      if (match[3] !== undefined) {
        seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
      } else {
        seconds = parseInt(match[1]) * 60 + parseInt(match[2]);
      }

      // 次のタイムスタンプまでのテキストをコンテキストとして抽出
      const start = match.index;
      const nextMatch = pattern.exec(text);
      const end = nextMatch ? nextMatch.index : text.length;
      pattern.lastIndex = match.index + match[0].length;  // リセット

      contexts.push({
        timestamp: seconds,
        originalText: match[0],
        text: text.slice(start, end)
      });
    }

    return contexts;
  }

  /**
   * タイムスタンプに対応する物理プロファイルを探す
   * @private
   */
  _findPhysicsProfile(timestamp, profiles) {
    return profiles.find(p =>
      timestamp >= p.timestamp &&
      timestamp < p.timestamp + this.secondsPerCell
    );
  }

  /**
   * 強度の主張を検証
   * @private
   */
  _checkIntensityClaim(text, physics) {
    for (const [level, config] of Object.entries(INTENSITY_CLAIMS)) {
      for (const pattern of config.patterns) {
        if (pattern.test(text)) {
          const { min, max } = config.expectedRange;
          const actual = physics.physicsIntensity;
          const matches = actual >= min - this.intensityTolerance &&
                         actual <= max + this.intensityTolerance;

          return {
            type: 'intensity',
            level,
            pattern: pattern.source,
            expected: config.expectedRange,
            actual,
            matches,
            timestamp: physics.timestamp,
            snippet: text.slice(0, 100)
          };
        }
      }
    }
    return null;
  }

  /**
   * フリンジの主張を検証
   * @private
   */
  _checkFringeClaim(text, physics) {
    for (const [level, config] of Object.entries(FRINGE_CLAIMS)) {
      for (const pattern of config.patterns) {
        if (pattern.test(text)) {
          const { min, max } = config.expectedRange;
          const actual = physics.colorSeparation;
          const matches = actual >= min - this.intensityTolerance &&
                         actual <= max + this.intensityTolerance;

          return {
            type: 'fringe',
            level,
            pattern: pattern.source,
            expected: config.expectedRange,
            actual,
            matches,
            timestamp: physics.timestamp,
            snippet: text.slice(0, 100)
          };
        }
      }
    }
    return null;
  }

  /**
   * 方向の主張を検証
   * @private
   */
  _checkDirectionClaim(text, physics) {
    // 動きが十分にある場合のみ方向を検証
    if (physics.directionalFringe.magnitude < 0.02) {
      return null;
    }

    for (const [direction, config] of Object.entries(DIRECTION_CLAIMS)) {
      for (const pattern of config.patterns) {
        if (pattern.test(text)) {
          const expected = config.expectedAngle;
          const actual = physics.directionalFringe.angleDeg;
          const tolerance = config.tolerance;

          // 角度の差（wraparound対応）
          let diff = Math.abs(expected - actual);
          if (diff > 180) diff = 360 - diff;

          const matches = diff <= tolerance;

          return {
            type: 'direction',
            direction,
            pattern: pattern.source,
            expected,
            actual,
            difference: Math.round(diff),
            matches,
            timestamp: physics.timestamp,
            magnitude: physics.directionalFringe.magnitude,
            snippet: text.slice(0, 100)
          };
        }
      }
    }
    return null;
  }

  /**
   * 数値の明示的主張を検証
   * @private
   */
  _checkNumericClaims(text, physics) {
    const results = [];

    for (const pattern of NUMERIC_CLAIM_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const claimed = parseFloat(match[1]);
        if (isNaN(claimed)) continue;

        // どの物理量への主張かを判定
        let physicsValue = null;
        let type = 'unknown';

        if (/分離度|色分離|colorSeparation/i.test(match[0])) {
          type = 'colorSeparation';
          physicsValue = physics.colorSeparation;
        } else if (/フリンジ|fringe/i.test(match[0])) {
          type = 'fringeMagnitude';
          physicsValue = physics.directionalFringe.magnitude;
        } else if (/強度|intensity/i.test(match[0])) {
          type = 'physicsIntensity';
          physicsValue = physics.physicsIntensity;
        } else if (/magnitude/i.test(match[0])) {
          type = 'fringeMagnitude';
          physicsValue = physics.directionalFringe.magnitude;
        }

        if (physicsValue !== null) {
          const diff = Math.abs(claimed - physicsValue);
          const matches = diff <= this.intensityTolerance;

          results.push({
            type: 'numeric',
            subtype: type,
            claimed,
            actual: physicsValue,
            difference: Math.round(diff * 1000) / 1000,
            matches,
            timestamp: physics.timestamp,
            snippet: match[0]
          });
        }
      }
    }

    return results;
  }

  /**
   * タヌキスコアの解釈
   * @private
   */
  _interpret(score, totalClaims) {
    if (totalClaims === 0) {
      return {
        level: 'no_claims',
        description: '物理的主張なし（検証不能）',
        color: 'gray'
      };
    }

    if (score <= 0.1) {
      return {
        level: 'grounded',
        description: '物理に根ざしている',
        color: 'green'
      };
    }
    if (score <= 0.3) {
      return {
        level: 'mostly_grounded',
        description: 'ほぼ物理ベース',
        color: 'green'
      };
    }
    if (score <= 0.5) {
      return {
        level: 'mixed',
        description: '物語と物理が混在',
        color: 'yellow'
      };
    }
    if (score <= 0.7) {
      return {
        level: 'story_leaning',
        description: '物語優位（タヌキ傾向）',
        color: 'orange'
      };
    }
    return {
      level: 'tanuki',
      description: 'タヌキ検出：物語で逃げた',
      color: 'red'
    };
  }

  /**
   * 空のレポート
   * @private
   */
  _emptyReport() {
    return {
      tanukiScore: 0,
      isTanuki: false,
      totalClaims: 0,
      totalViolations: 0,
      claims: [],
      violations: [],
      interpretation: {
        level: 'no_input',
        description: '入力なし',
        color: 'gray'
      }
    };
  }
}

module.exports = { TanukiDetector };
