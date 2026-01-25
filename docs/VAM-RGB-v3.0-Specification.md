# VAM-RGB v3.0 Specification

**Status:** Design Phase
**Date:** 2026-01-24
**Authors:** HAASIY (Susumu Takahashi), Claude OPUS, Gemini 2.0 Flash, DeepSeek
**Target:** Claude Code Implementation

---

## 1. Executive Summary

VAM-RGB v3.0 unifies all previous innovations into a complete temporal codec:

- **v1.9**: VAM-RGB encoding (RGB = Past/Present/Future)
- **v2.0**: Closed Loop (Encode → Translate → Generate → Verify)
- **v3.0**: Elastic Reach + Audio-Driven Detection + AI Projector Mode

**Goal:** Transform AI from "video analyzer" to "video projector" — receiving minimal causal data and reconstructing full video.

**Core Philosophy:** "Connect, don't fill." Gaps are meaningful deleted frames.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         VAM-RGB v3.0 PIPELINE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [Original Video]                                                    │
│        │                                                             │
│        ▼                                                             │
│  ┌─────────────┐                                                     │
│  │ AUDIO LAYER │ ← m4a extraction (lightweight)                     │
│  └──────┬──────┘                                                     │
│         │                                                            │
│         ▼                                                            │
│  ┌─────────────────┐                                                 │
│  │ REACH DETECTOR  │ ← Waveform peaks → Reach map                   │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                 │
│  │ FRAME EXTRACTOR │ ← Keyframes (reach-aware)                      │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                 │
│  │ VAM-RGB ENCODER │ ← Fixed stride, variable reach                 │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────┐                                                 │
│  │ PACKAGE BUILDER │ ← .vamrgb.zip                                  │
│  └────────┬────────┘                                                 │
│           │                                                          │
│           ▼                                                          │
│     [VAM-RGB v3.0 Package]                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Stride vs Reach: Core Design Change

### 3.1 Key Distinction

| Concept | Definition | v3.0 Behavior |
|---------|------------|---------------|
| **Stride** | Time offset for R/B channels from G | **Fixed at 0.5s** (physics precision) |
| **Reach** | How far a cell "extends" to connect with neighbors | **Variable 1s–6.5s** (based on activity) |
| **Gap** | Unencoded frames between cells | **Always exists** (min 2s) |

### 3.2 Visual Model

```
Cell N                      Gap (余白)                    Cell N+1
[R←0.5s→G←0.5s→B]     ...deleted frames...     [R←0.5s→G←0.5s→B]
        │                                               │
        └────── reach (可変) ──────┬────── reach ───────┘
                                   │
                              gap (常に残る)
```

### 3.3 Philosophy

- **"Fill"** → ✗ (trying to cover everything)
- **"Connect"** → ✓ (linking causally important moments)
- **Gap = deleted frames** → meaningful absence, not error

---

## 4. Graduated Reach System

### 4.1 8-Level Activity Scale

| Level | Audio Activity | Stride | Reach | Gap |
|-------|---------------|--------|-------|-----|
| 1 | Silence | 0.5s | 1s | 13s |
| 2 | Very Low | 0.5s | 2s | 11s |
| 3 | Low | 0.5s | 3s | 9s |
| 4 | Medium-Low | 0.5s | 4s | 7s |
| 5 | Medium | 0.5s | 5s | 5s |
| 6 | Medium-High | 0.5s | 5.5s | 4s |
| 7 | High | 0.5s | 6s | 3s |
| 8 | Intense | 0.5s | 6.5s | 2s |

**Invariants:**
- Stride is **always 0.5s** (maintains physics precision in RGB encoding)
- Gap is **never zero** (minimum 2s ensures compression)
- Grid interval assumed: 15s between cell centers

### 4.2 Configuration

```javascript
const reachConfig = {
  stride_seconds: 0.5,        // FIXED - never changes
  grid_interval: 15,          // seconds between cell centers

  reach_levels: [
    { level: 1, activity_max: 0.05,  reach: 1.0 },
    { level: 2, activity_max: 0.15,  reach: 2.0 },
    { level: 3, activity_max: 0.25,  reach: 3.0 },
    { level: 4, activity_max: 0.40,  reach: 4.0 },
    { level: 5, activity_max: 0.55,  reach: 5.0 },
    { level: 6, activity_max: 0.70,  reach: 5.5 },
    { level: 7, activity_max: 0.85,  reach: 6.0 },
    { level: 8, activity_max: 1.00,  reach: 6.5 }
  ],

  min_gap: 2.0                // MINIMUM - gap never goes below this
};
```

---

## 5. Audio-Driven Reach Detection

### 5.1 Why Audio?

| Method | Processing Cost | Accuracy |
|--------|----------------|----------|
| Optical Flow (video) | 100x | High |
| Keyframe Diff | 10x | Medium |
| Audio Waveform | 1x | Medium-High |

**Key Insight:** Sound correlates with visual events. Speech, impacts, music changes — all visible in waveform.

### 5.2 Implementation

```javascript
// src/reach/AudioReachDetector.js

class AudioReachDetector {

  constructor(config = {}) {
    this.strideSeconds = 0.5;  // FIXED
    this.gridInterval = config.gridInterval || 15;
    this.minGap = config.minGap || 2.0;

    this.reachLevels = [
      { level: 1, activityMax: 0.05,  reach: 1.0 },
      { level: 2, activityMax: 0.15,  reach: 2.0 },
      { level: 3, activityMax: 0.25,  reach: 3.0 },
      { level: 4, activityMax: 0.40,  reach: 4.0 },
      { level: 5, activityMax: 0.55,  reach: 5.0 },
      { level: 6, activityMax: 0.70,  reach: 5.5 },
      { level: 7, activityMax: 0.85,  reach: 6.0 },
      { level: 8, activityMax: 1.00,  reach: 6.5 }
    ];
  }

  /**
   * Main entry point
   * @param {string} audioPath - Path to m4a file
   * @returns {Promise<ReachMap>}
   */
  async analyze(audioPath) {
    const audioBuffer = await this.loadAudio(audioPath);
    const peaks = this.detectPeaks(audioBuffer);
    const reachMap = this.peaksToReach(peaks);
    return reachMap;
  }

  /**
   * Load audio file into buffer
   */
  async loadAudio(audioPath) {
    const { execSync } = require('child_process');
    const cmd = `ffmpeg -i "${audioPath}" -f f32le -acodec pcm_f32le -ac 1 -ar 16000 -`;
    const buffer = execSync(cmd, { maxBuffer: 100 * 1024 * 1024 });
    return new Float32Array(buffer.buffer);
  }

  /**
   * Simple peak detection
   */
  detectPeaks(samples, sampleRate = 16000) {
    const windowSize = Math.floor(sampleRate * 0.1); // 100ms windows
    const peaks = [];

    for (let i = 0; i < samples.length; i += windowSize) {
      const window = samples.slice(i, i + windowSize);
      const rms = Math.sqrt(window.reduce((sum, s) => sum + s * s, 0) / window.length);
      const time = i / sampleRate;
      peaks.push({ time, rms });
    }

    return peaks;
  }

  /**
   * Convert activity to reach level
   */
  activityToReach(normalizedActivity) {
    for (const level of this.reachLevels) {
      if (normalizedActivity <= level.activityMax) {
        return { level: level.level, reach: level.reach };
      }
    }
    return { level: 8, reach: 6.5 };
  }

  /**
   * Convert peaks to reach map
   */
  peaksToReach(peaks) {
    const reachMap = [];
    const duration = peaks[peaks.length - 1].time;
    const cellCount = Math.floor(duration / this.gridInterval);

    for (let i = 0; i < cellCount; i++) {
      const cellCenter = i * this.gridInterval + (this.gridInterval / 2);
      const cellStart = i * this.gridInterval;
      const cellEnd = (i + 1) * this.gridInterval;

      // Get peaks within this cell's interval
      const cellPeaks = peaks.filter(p => p.time >= cellStart && p.time < cellEnd);

      // Calculate average activity
      const avgRms = cellPeaks.reduce((sum, p) => sum + p.rms, 0) / cellPeaks.length;

      // Normalize (0.3 RMS = max activity)
      const normalizedActivity = Math.min(1, avgRms / 0.3);

      // Get reach from activity level
      const { level, reach } = this.activityToReach(normalizedActivity);

      // Calculate gap
      const gap = this.gridInterval - (reach * 2);

      reachMap.push({
        cellIndex: i,
        timestamp: cellCenter,
        stride: this.strideSeconds,  // ALWAYS 0.5
        reach: reach,
        gap: Math.max(gap, this.minGap),
        activity: Math.round(normalizedActivity * 100) / 100,
        level: level
      });
    }

    return reachMap;
  }
}

module.exports = { AudioReachDetector };
```

---

## 6. VAM-RGB Encoder (Fixed Stride)

### 6.1 Encoding Formula

```
R(x,y) = Frame(T - 0.5s)    ← ALWAYS 0.5s offset
G(x,y) = Frame(T)           ← Center frame
B(x,y) = Frame(T + 0.5s)    ← ALWAYS 0.5s offset
```

**Stride is fixed for physics precision.** Reach only affects metadata and keyframe selection.

### 6.2 Implementation

```javascript
// src/encoder/VamRgbEncoder.js

class VamRgbEncoder {

  constructor(config = {}) {
    this.outputSize = config.outputSize || { width: 256, height: 256 };
    this.stride = 0.5;  // FIXED - physics precision
  }

  /**
   * Encode single cell (stride is always 0.5s)
   * @param {VideoSource} video
   * @param {number} centerTime - T (center timestamp)
   * @returns {ImageData}
   */
  async encodeCell(video, centerTime) {
    const frameR = await video.getFrame(centerTime - this.stride);
    const frameG = await video.getFrame(centerTime);
    const frameB = await video.getFrame(centerTime + this.stride);

    const width = this.outputSize.width;
    const height = this.outputSize.height;
    const output = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < width * height; i++) {
      output[i * 4 + 0] = frameR.data[i * 4 + 0]; // R from past
      output[i * 4 + 1] = frameG.data[i * 4 + 1]; // G from present
      output[i * 4 + 2] = frameB.data[i * 4 + 2]; // B from future
      output[i * 4 + 3] = 255; // Alpha
    }

    return new ImageData(output, width, height);
  }

  /**
   * Encode full video with reach map
   */
  async encodeVideo(video, reachMap) {
    const cells = [];

    for (const cell of reachMap) {
      const imageData = await this.encodeCell(video, cell.timestamp);
      cells.push({
        index: cell.cellIndex,
        timestamp: cell.timestamp,
        stride: this.stride,  // Always 0.5
        reach: cell.reach,
        gap: cell.gap,
        level: cell.level,
        imageData: imageData
      });
    }

    return cells;
  }
}

module.exports = { VamRgbEncoder };
```

---

## 7. Package Structure (v3.0)

```
video-name.vamrgb.zip
├── manifest.json           # Package descriptor
├── anchor.json             # Temporal metadata
├── reach-map.json          # Audio-derived reach data (renamed from stride-map)
├── vam-rgb/
│   ├── cell_000.png        # VAM-RGB encoded cells
│   ├── cell_001.png
│   └── ...
├── keyframes/
│   ├── kf_000_0.jpg        # Keyframes within reach zone
│   ├── kf_000_1.jpg
│   └── ...
└── audio/
    └── waveform.json       # Peak data for verification
```

### 7.1 manifest.json

```json
{
  "vam_rgb_version": "3.0",
  "package_id": "uuid-v4",
  "created_at": "2026-01-24T00:00:00Z",

  "source": {
    "filename": "original.mp4",
    "duration_seconds": 600,
    "fps": 30,
    "resolution": { "width": 1920, "height": 1080 }
  },

  "grid": {
    "interval_seconds": 15,
    "cell_count": 40,
    "cell_resolution": { "width": 256, "height": 256 }
  },

  "encoding": {
    "stride_seconds": 0.5,
    "stride_mode": "fixed",
    "reach_mode": "elastic",
    "reach_detection": "audio",
    "min_gap_seconds": 2.0
  },

  "keyframes": {
    "selection": "within_reach",
    "resolution": { "width": 960, "height": 540 }
  },

  "inference_contract": {
    "coherence_threshold": 0.7,
    "r_index_max": 0.3,
    "reconstructable": true
  }
}
```

### 7.2 reach-map.json

```json
{
  "stride_seconds": 0.5,
  "grid_interval_seconds": 15,
  "min_gap_seconds": 2.0,

  "cells": [
    {
      "index": 0,
      "timestamp": 7.5,
      "stride": 0.5,
      "reach": 1.0,
      "gap": 13.0,
      "level": 1,
      "activity_score": 0.03,
      "activity_type": "silence"
    },
    {
      "index": 1,
      "timestamp": 22.5,
      "stride": 0.5,
      "reach": 5.0,
      "gap": 5.0,
      "level": 5,
      "activity_score": 0.52,
      "activity_type": "speech"
    },
    {
      "index": 2,
      "timestamp": 37.5,
      "stride": 0.5,
      "reach": 6.5,
      "gap": 2.0,
      "level": 8,
      "activity_score": 0.95,
      "activity_type": "music"
    }
  ]
}
```

---

## 8. Physics Validation (v3.0)

### 8.1 Dual Validation

```javascript
// src/validation/PhysicsValidator.js

class PhysicsValidator {

  async validate(vamRgbCell, keyframes, reachData) {
    const semantic = await this.validateSemantic(vamRgbCell, keyframes);
    const physics = await this.validatePhysics(vamRgbCell, reachData);

    return {
      coherence_score: Math.sqrt(semantic.confidence * physics.validity),
      r_index: this.calculateRIndex(physics.intensity, semantic.verbalization),
      violations: [...semantic.violations, ...physics.violations],
      reconstructable: this.isReconstructable(semantic, physics)
    };
  }

  calculateRIndex(physicsIntensity, verbalizationWillingness) {
    // R-index = gap between perception and expression
    return Math.abs(physicsIntensity - verbalizationWillingness) /
           Math.max(physicsIntensity, 0.001);
  }

  isReconstructable(semantic, physics) {
    return semantic.confidence > 0.6 &&
           physics.validity > 0.6 &&
           semantic.violations.length === 0;
  }
}

module.exports = { PhysicsValidator };
```

---

## 9. CLI Interface

### 9.1 Commands

```bash
# Encode video to VAM-RGB v3.0 package
vamrgb encode input.mp4 -o output.vamrgb.zip

# Analyze existing package
vamrgb analyze package.vamrgb.zip

# Extract reach map only (for debugging)
vamrgb reach input.mp4 -o reach-map.json

# Validate package integrity
vamrgb validate package.vamrgb.zip
```

### 9.2 Implementation

```javascript
// src/cli/index.js

const { program } = require('commander');
const { AudioReachDetector } = require('../reach/AudioReachDetector');
const { VamRgbEncoder } = require('../encoder/VamRgbEncoder');
const { PackageBuilder } = require('../package/PackageBuilder');

program
  .name('vamrgb')
  .version('3.0.0')
  .description('VAM-RGB Temporal Codec');

program
  .command('encode <input>')
  .option('-o, --output <path>', 'Output package path')
  .option('--interval <seconds>', 'Grid interval', '15')
  .action(async (input, options) => {
    console.log(`Encoding ${input}...`);

    // 1. Extract audio
    const audioPath = await extractAudio(input);

    // 2. Detect reach levels
    const detector = new AudioReachDetector({ gridInterval: parseInt(options.interval) });
    const reachMap = await detector.analyze(audioPath);
    console.log(`Detected ${reachMap.length} cells`);

    // 3. Encode VAM-RGB (fixed stride)
    const encoder = new VamRgbEncoder();
    const cells = await encoder.encodeVideo(input, reachMap);

    // 4. Build package
    const builder = new PackageBuilder();
    await builder.build(cells, reachMap, options.output);

    console.log(`Package saved to ${options.output}`);
  });

program.parse();
```

---

## 10. File Structure for Implementation

```
V7.4/
├── package.json
├── src/
│   ├── cli/
│   │   └── index.js           # CLI entry point
│   ├── reach/
│   │   └── AudioReachDetector.js
│   ├── encoder/
│   │   └── VamRgbEncoder.js
│   ├── keyframes/
│   │   └── KeyframeExtractor.js
│   ├── package/
│   │   └── PackageBuilder.js
│   ├── validation/
│   │   └── PhysicsValidator.js
│   └── utils/
│       ├── ffmpeg.js
│       └── canvas.js
├── test/
│   ├── reach.test.js
│   ├── encoder.test.js
│   └── fixtures/
└── docs/
    └── VAM-RGB-v3.0-Specification.md
```

---

## 11. Dependencies

```json
{
  "name": "vam-rgb",
  "version": "3.0.0",
  "dependencies": {
    "commander": "^11.0.0",
    "canvas": "^2.11.0",
    "archiver": "^6.0.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  },
  "bin": {
    "vamrgb": "./src/cli/index.js"
  }
}
```

**External Requirements:**
- FFmpeg (for audio extraction and video processing)
- Node.js 18+

---

## 12. Implementation Phases

| Phase | Scope | Deliverable | Priority |
|-------|-------|-------------|----------|
| 1 | AudioReachDetector | reach-map.json generation | **HIGH** |
| 2 | VamRgbEncoder | Fixed stride encoding | **HIGH** |
| 3 | PackageBuilder | .vamrgb.zip packaging | **HIGH** |
| 4 | KeyframeExtractor | Reach-aware frame extraction | MEDIUM |
| 5 | PhysicsValidator | Coherence & R-index | MEDIUM |
| 6 | CLI | Full command interface | MEDIUM |
| 7 | Tests | Unit & integration tests | LOW |

---

## 13. Success Criteria

1. **Audio → Reach Map**: 1-minute video processes in < 5 seconds
2. **Fixed Stride**: All cells encoded with exactly 0.5s stride
3. **Variable Reach**: Each cell has appropriate reach (1s–6.5s) based on activity
4. **Minimum Gap**: No gap ever goes below 2 seconds
5. **Package Size**: < 10% of original video size
6. **Validation**: coherence_score ≥ 0.7 for reconstructable content

---

## 14. Philosophy

> "Sound tells you where to look."

> "Time is measured not by clocks, but by the density of events."

> "Connect, don't fill. Gaps are meaningful deleted frames."

> "Compress the cause, teleport the effect, reconstruct the truth."

---

## 15. Credits

- **HAASIY:** Protocol design, Stride/Reach separation, Audio-stride insight
- **Gemini:** Elastic reach algorithm, graduated activity levels
- **Claude OPUS:** Documentation, architecture
- **DeepSeek:** Physics validation module

---

*VAM-RGB v3.0 — The Temporal Codec*
*2026-01-24*
