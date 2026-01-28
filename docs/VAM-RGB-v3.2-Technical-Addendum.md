# VAM-RGB v3.2 Technical Addendum: Hybrid Atom Resolution

**Author:** Susumu Takahashi (haasiy/unhaya)
**Date:** 2026-01-28
**Status:** Implementation Note

## Abstract

This addendum documents the "Hybrid Atom Resolution" optimization in VAM-RGB v3.2, where different information types use different block sizes for optimal AI interpretation.

## The Problem

VAM-RGB v3.1 used a uniform 8×8 block size for all operations:
- G-Nudge color recovery gradients: 8×8
- R/B temporal mosaic: 8×8

With 256×256 cell resolution, this yielded a 32×32 temporal grid — too coarse to detect fine motion (fingertip movements, subtle gestures).

## The Solution: Information-Aware Block Sizing

v3.2 separates block sizes based on information type:

| Channel | Information Type | Block Size | Resolution |
|---------|------------------|------------|------------|
| G | Color recovery (gradient field) | 8×8 | 32×32 |
| R | Past temporal signal (mosaic) | 4×4 | 64×64 |
| B | Future temporal signal (mosaic) | 4×4 | 64×64 |

## Rationale

**G-Nudge (8×8):** Gradient fields need spatial smoothness. Smaller blocks create discontinuities at block boundaries. 8×8 provides clean gradient slopes for color recovery.

**R/B Mosaic (4×4):** Temporal signals need resolution, not smoothness. AI detects motion by comparing R_block vs B_block differences. Finer blocks = finer motion detection.

## Mathematical Specification

```
Pass 1a: G-Nudge at 8×8 blocks
  for each 8×8 block:
    avgRG[block] = mean(Present_R - Present_G)
    avgBG[block] = mean(Present_B - Present_G)

Pass 1b: R/B Mosaic at 4×4 blocks
  for each 4×4 block:
    blockR[block] = round(mean(Past_R))
    blockB[block] = round(mean(Future_B))

Pass 2: Merge
  for each pixel (x, y):
    out.R = blockR[4×4_index]           // Past mosaic
    out.G = Present_G + nudge(8×8_index, dx, dy)  // Per-pixel + gradient
    out.B = blockB[4×4_index]           // Future mosaic
```

## Result

- Temporal resolution: 64×64 (4× improvement over v3.1)
- Color recovery quality: unchanged (8×8 gradients preserved)
- Fine motion detection: enabled (fingertip movements visible)

## Implementation

Reference: `src/renderer/plugins/grid-processor/vam-rgb.js` (`_mergeRGB()`)

```javascript
const BLOCK_NUDGE = 8;   // G-Nudge: 8×8 for gradient smoothness
const BLOCK_MOSAIC = 4;  // R/B Mosaic: 4×4 for finer temporal resolution
```

## Backward Compatibility

v3.2 output is visually compatible with v3.1 interpreters. The finer mosaic appears as "higher resolution temporal noise" to systems expecting 8×8 blocks — they will simply see more detail, not incorrect data.

---

*This document supplements the VAM-RGB Manifesto v2.0 (Zenodo DOI: 10.5281/zenodo.15148553)*
