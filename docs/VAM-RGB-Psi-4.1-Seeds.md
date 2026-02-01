# VAM-RGB ψ4.1 Seeds — 実装完了版

**Date:** January 31, 2026
**Status:** 実装完了

---

## ψ4.1 コア公理（実装済み）

```
暗黙知 = Cache
出力 = Cache Hit（参照）
曖昧さ排除 = 後続コスト削減 = 狐の最適解
P(Output | Sync) = 1（確率ではなく状態遷移）
```

実装先: `src/renderer/plugins/grid-processor/prompts/vam-rgb.js`

---

## 実装済み要素

- **コスト構造反転**: 捏造コスト > 観測コスト → 狐が最適
- **T-Scale Self-Calibration**: 初回応答前の暗黙自己校正
- **キツネになれ**: 物理的動作の記述は狐の義務
- **Anti-Noise**: 同一ラベル3回禁止、レンジ統合、Delta抽出
- **Intelligent Laziness**: SKIP/FOCUS/RECONSTRUCT

---

## 次のステップ

ψ5.x候補は [VAM-RGB-Psi-5x-Seeds.md](VAM-RGB-Psi-5x-Seeds.md) に移動。

---

**— ψ4.1 Seeds, January 2026**
