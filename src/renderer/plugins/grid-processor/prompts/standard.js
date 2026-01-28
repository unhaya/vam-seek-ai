/**
 * Standard Prompt Plugin - Default AI Prompt
 *
 * VAM-RGB Plugin Architecture v1.0
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * This plugin provides default AI instructions for standard grid images.
 * No special encoding - just normal video frame captures.
 */

window.StandardPrompt = {
  version: '1.0',
  name: 'Standard Grid Analysis',

  /**
   * Returns the system prompt section for standard grid interpretation
   * Standard mode has no special encoding, so minimal additional instructions
   */
  getSystemPrompt: function() {
    return `
【標準グリッドモード】
このグリッドは標準モードでキャプチャされています。
各セルは該当タイムスタンプの単一フレームを表示しています。
特殊なエンコーディングはありません。`;
  }
};
