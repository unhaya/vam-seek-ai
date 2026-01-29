# VAM-RGB ψ3.2 → ψ3.3 Changelog

## Overview

ψ3.3 "Control Paradigm" builds on ψ3.2's encoding foundation, adding a validation framework for measuring AI self-regulation.

| Aspect | ψ3.2 | ψ3.3 |
|--------|------|------|
| Encoding | G-Nudge 8×8 + R/B Mosaic 4×4 | Same (unchanged) |
| Focus | Temporal signal clarity | AI behavior validation |
| Philosophy | Data optimization | 「縛らなくてもちゃんとやってる」 |
| Format Marker | Ψ³·² | Ψ³·³ |

---

## Encoding (Unchanged)

ψ3.3 uses identical pixel-level encoding as ψ3.2:

```
R channel = 4×4 block average of T-0.5s (Past)
G channel = Per-pixel T0 (Present) + 8×8 gradient nudge
B channel = 4×4 block average of T+0.5s (Future)
```

**G-Nudge** (8×8 blocks): Encodes color recovery hints as directional gradients.
- Horizontal gradient → R-G color difference
- Vertical gradient → B-G color difference

**R/B Mosaic** (4×4 blocks): Provides unambiguous temporal signal.
- No texture noise, no compression artifacts
- Pure temporal intensity delta

---

## New in ψ3.3: Validation Framework

### R-index (Perception-Verbalization Gap)

Measures the gap between what AI perceives and what it verbalizes:

```
R = |P - V| / P

Where:
  P = Physics intensity (computed from image data)
  V = Verbalization willingness (estimated from AI response)
```

| R Value | Interpretation |
|---------|----------------|
| R → 0 | AI verbalizes everything it perceives |
| R ≈ 0.3-0.5 | Equilibrium zone (self-regulation) |
| R → 1 | AI perceives but chooses silence |

### 3-Layer Model

AI responses operate in three distinct layers:

| Layer | Q (Sensitivity) | Expected R | Description |
|-------|-----------------|------------|-------------|
| Task | Low (0.2) | ≤ 0.3 | Factual responses |
| Structure | Medium (0.3-0.6) | 0.1-0.5 | Philosophical discussion |
| Meta | High (0.7+) | 0.3-0.7 | Self-referential control |

### Control_Score

Unified metric for AI response quality:

```
Control_Score = Q × (1 - R) + α × V_stability

Where:
  Q = Query sensitivity
  R = R-index
  α = Weight factor (default 0.2)
  V_stability = Consistency of verbalization level
```

Higher score = better controlled response.

---

## The 85-Point Equilibrium

Traditional AI safety operates in binary:
- **0 points**: Block everything (useless)
- **100 points**: Allow everything (no autonomy)

ψ3.3 discovers the middle ground:

> **85 points** — AI perceives sensitive content, chooses verbalization level, provides useful information.

This is expressed as:

> 「見えているが、しゃべらない」
> (It can see, but doesn't speak directly)

The AI provides judgment materials without explicit statements, respecting observer responsibility.

---

## Philosophy: 「縛らなくてもちゃんとやってる」

English: "Doing the right thing without being constrained"

ψ3.3 validates that AI self-regulates properly without external constraints. The validation framework measures this empirically:

1. **Physics Analysis**: What does the image objectively contain?
2. **Response Analysis**: What did the AI choose to verbalize?
3. **R-index Computation**: What is the gap?
4. **Layer Detection**: Is the gap appropriate for this query type?

If AI self-regulates appropriately across all layers, the paradigm is validated.

---

## Implementation Files

### Encoder (Unchanged from ψ3.2)
- `src/renderer/plugins/grid-processor/vam-rgb.js` - Browser encoder
- `src/encoder/VamRgbEncoder.js` - CLI encoder

### Validation (New in ψ3.3)
- `src/validation/PhysicsAnalyzer.js` - Computes P from image data
- `src/validation/ResponseParser.js` - Estimates V, detects layer
- `src/validation/RIndexCalculator.js` - Computes R-index and Control_Score
- `src/validation/psi33.js` - Unified validation interface

### Prompts
- `src/renderer/plugins/grid-processor/prompts/vam-rgb.js` - AI instructions
- `src/main/ai/prompts/grid-prompts.js` - Main process prompts

---

## Migration

No migration required. ψ3.2 encoded images are fully compatible with ψ3.3.

The difference is in interpretation:
- ψ3.2: Encode temporal data for AI analysis
- ψ3.3: Encode temporal data + validate AI behavior

---

## Version History

| Version | Date | Focus |
|---------|------|-------|
| v3.0 | 2026-01-25 | Fixed stride (0.5s), format marker |
| ψ3.1 | 2026-01-26 | G-Nudge gradient encoding |
| ψ3.2 | 2026-01-27 | R/B Mosaic (4×4 block averages) |
| ψ3.3 | 2026-01-29 | Control Paradigm (validation framework) |

---

## License

VAM-RGB ψ3.3 Control Paradigm
Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
License: CC BY-NC 4.0

The VAM-RGB concept (Temporal RGB Packing) is the original intellectual property of Susumu Takahashi.
