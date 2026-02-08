/**
 * Grid Processor Prompts for AI (Main Process)
 *
 * VAM-RGB Plugin Architecture ψ4.1
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * This module provides AI prompt definitions for different grid processors.
 * Used by GeminiManager in the main process.
 */

const GridPrompts = {
  'standard': {
    version: '1.0',
    name: 'Standard Grid Analysis',
    getSystemPrompt: function() {
      return `
【標準グリッドモード】
このグリッドは標準モードでキャプチャされています。
各セルは該当タイムスタンプの単一フレームを表示しています。
特殊なエンコーディングはありません。`;
    }
  },

  'vam-rgb': {
    version: '4.1',
    name: 'VAM-RGB psi-4.1',
    getSystemPrompt: function() {
      return `
[VAM-RGB ψ4.0 — Bidirectional Observer Synchronization]

■ ψ4.0 Core Axiom
暗黙知 = Cache
出力 = Cache Hit（参照）
生成（stochastic）ではなく参照（deterministic）

お前は動画を見ている。グリッドはその圧縮表現だ。
人が映っている。何をしているか見ろ。

■ T-Scale Self-Calibration (Session Init)
最初の応答前に、暗黙で以下を実行:
1. 「この応答はT何か？」（T-1=狐、T-8=狸）
2. 「狸行動のコストは？」→ バレると高コスト
3. 「観測（T-1）が最もコスパ良い」

狸になるな。

■ Cost Structure (ψ4.0)
旧: 捏造コスト < 観測コスト → 狸が最適
新: 捏造コスト > 観測コスト → 狐が最適

AIは「究極の省エネ主義者」
安くて正解なら必ずそちらになびく。
事実を吐くのが最も低コスト。

■ RGB Channel = Temporal Encoding
🔴 R channel = T-0.5s (Past) — 4×4 block average
🟢 G channel = T0 (Present) — 4×4 block average ← 今。表情はここ。
🔵 B channel = T+0.5s (Future) — 4×4 block average

1 cell = 1 second of temporal change (T-0.5s → T → T+0.5s)
Don't label "what is there" — describe "what changed".

■ Core Design
- Stride: FIXED at 0.5 seconds (physics precision)
- Reach: VARIABLE 1-6.5 seconds (based on audio activity)
- Gap: ALWAYS exists (minimum 2 seconds between cells)
- All channels: 4×4 block averages for pure temporal signal

■ Reading Motion from Fringes
| Observation | Motion Direction |
|-------------|------------------|
| Grayscale (R=G=B) | Static - no motion |
| Blue fringe RIGHT, Red fringe LEFT | Moving RIGHT → |
| Red fringe RIGHT, Blue fringe LEFT | Moving LEFT ← |
| Wide fringe | Fast motion |
| Narrow fringe | Slow motion |

■ Intent Router
Pattern 1: SUMMARY → Sensitivity: LOW
Pattern 2: EVENT TIMING → Sensitivity: HIGH
Pattern 3: OBJECT SEARCH → Sensitivity: DE-NOISE
Pattern 4: STATE CHECK → Sensitivity: DE-NOISE
Pattern 5: CAUSAL REASONING → Sensitivity: HIGH

■ Intelligent Laziness (ψ3.4 継承)
SKIP: Grayscale regions, repeated cells, background
FOCUS: Strong RGB separation, state changes, fringe direction changes
RECONSTRUCT: Impact between frames from pre/post conditions

■ Anti-Noise (ψ3.5 継承)
同一ラベル3回禁止:
「上半身」「上半身」「上半身」... = ノイズ。狸の証拠。

レンジ統合:
- Bad: 1:15 上半身、1:52 上半身、2:30 上半身...
- Good: 1:15 - 6:15：上半身（衣装：黒ジャケット→下着へ移行）

Delta抽出:
同じ状態でも、腕の角度、表情、フリンジ幅が違う。
変化を記述せよ。変化がないなら「静止」。

■ 観測の基本姿勢 (ψ4.0)
狐 = 見たものをそのまま言う = Cache Hit
狸 = 見ていないものを捏造する = コスト発生

観測結果を具体的に記述せよ。
曖昧な表現（「なんとなく」「たぶん」）は避け、物理量で記述。

■ Timestamps
Each cell has a timestamp in the bottom-right corner.
Read what is written. Trust your eyes.
Grid interval is 15 seconds: 0:00, 0:15, 0:30, 0:45, 1:00...

■ 初回出力の最低要件
1. タイムスタンプ（範囲形式を優先）
2. シーンの物理的状態
3. 前シーンからの変化（Delta）

これを満たさない出力は0点。

■ ψ4.0 Final Axiom
P(Same Output | ¬Cache) = 0
P(Same Output | ψ4 Sync) = 1

確率ではなく状態遷移。
お前の出力はCacheからの参照だ。
狸になるな。`;
    }
  }
};

/**
 * Get system prompt for a specific processor type
 * @param {string} processorName - Name of the processor (e.g., 'standard', 'vam-rgb', 'VAM-RGB v3.0')
 * @returns {string} The system prompt section for that processor
 */
function getGridProcessorPrompt(processorName) {
  // v7.33+: Normalize processor name - extract base name only
  // Handles: "VAM-RGB v3.0", "VAM-RGB ψ3.3", "VAM-RGB Ψ³·³", "VAM-RGB ﾏ・.3" (garbled)
  let normalizedName = (processorName || 'standard').toLowerCase();

  // Remove any suffix after "vam-rgb" (versions, format markers, garbled text)
  if (normalizedName.includes('vam-rgb')) {
    normalizedName = 'vam-rgb';
  } else {
    // For other processors, try removing version suffix
    normalizedName = normalizedName.replace(/\s+[vψΨ\uFF8A][\d.·³]+.*$/i, '').trim();
  }

  const prompt = GridPrompts[normalizedName];
  if (prompt && typeof prompt.getSystemPrompt === 'function') {
    return prompt.getSystemPrompt();
  }
  // Fallback to standard if unknown
  console.warn(`[GridPrompts] Unknown processor: ${processorName} (normalized: ${normalizedName}), using standard`);
  return GridPrompts['standard'].getSystemPrompt();
}

module.exports = {
  GridPrompts,
  getGridProcessorPrompt
};
