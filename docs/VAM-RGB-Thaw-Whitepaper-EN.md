# VAM-RGB: A Temporal Codec That Freezes and Thaws Time in a Single Image

**Technical Whitepaper v1.0**

**Author:** Susumu Takahashi (haasiy/unhaya)
**Date:** January 28, 2026
**Version:** VAM-RGB v3.0 / Thaw Decoder v1.0
**License:** CC BY-NC 4.0

---

## Abstract

We present VAM-RGB, a temporal codec that encodes three consecutive video frames into a single RGB image by assigning each color channel to a distinct temporal moment: Red = Past (T-0.5s), Green = Present (T), Blue = Future (T+0.5s). This encoding produces images where chromatic aberration is not an artifact but a **physical signature of motion** — its direction encodes movement trajectory and its magnitude encodes speed.

We then introduce the **Thaw Decoder**, the mathematical inverse of this encoding, which reconstructs temporal frames from a single VAM-RGB image through three progressive levels: (1) channel separation into grayscale temporal frames, (2) statistical color estimation using cross-channel correlation, and (3) round-trip validation against the original encoding. Finally, we demonstrate a **7-frame temporal interpolation** pipeline that generates smooth animation loops from the recovered frames via linear pixel blending, completing the encode-decode-animate cycle.

The system achieves round-trip coherence of 1.000 for static content and ≥0.9 for scenes with moderate motion, validated across 88 automated tests. A real-world test with a 256x256 VAM-RGB cell (colorSeparation=0.253, directional fringe at 237.8 degrees) produced a 12-frame animated GIF demonstrating visible temporal reconstruction.

**Keywords:** temporal compression, video codec, channel encoding, motion encoding, chromatic aberration, temporal reconstruction, frame interpolation

---

## 1. Introduction

### 1.1 The Problem

Video is fundamentally a sequence of images over time. Standard compression (H.264, H.265, AV1) exploits temporal redundancy to reduce file size, but the output remains a stream of frames — time flows forward, and each frame exists at a single moment.

What if time could be **frozen** — three moments captured in a single, still image? Not as a collage or composite, but as a mathematically precise encoding where the spatial structure of the image itself carries temporal information?

### 1.2 The Insight

A standard RGB image has three channels. A video has a temporal axis. The VAM-RGB codec maps one to the other:

```
R(x, y) = Luminance of pixel (x, y) at time T - 0.5s    (Past)
G(x, y) = Luminance of pixel (x, y) at time T            (Present)
B(x, y) = Luminance of pixel (x, y) at time T + 0.5s    (Future)
```

In regions where nothing moves, R ≈ G ≈ B, and the pixel appears grayscale — time is frozen but recoverable. In regions where objects move, the channels diverge, producing **chromatic fringing** that encodes motion direction and velocity.

This is not metaphorical. The color separation in a VAM-RGB image is a direct, measurable representation of physical motion, analogous to how Doppler shift encodes velocity in electromagnetic radiation.

### 1.3 Contribution

This paper presents the complete encode-decode cycle:

1. **VAM-RGB Encoding** (Section 2): How three video frames become one RGB image
2. **Audio-Driven Reach** (Section 3): How audio intensity determines temporal density
3. **Thaw Decoder** (Section 4): How one RGB image becomes three temporal frames
4. **7-Frame Interpolation** (Section 5): How three frames become smooth animation
5. **Validation** (Section 6): Round-trip coherence and physics preservation metrics

### 1.4 Design Philosophy

> *"Connect, don't fill. Gaps are meaningful."*

VAM-RGB does not attempt lossless video compression. It deliberately discards 2/3 of color information per frame, retaining only one channel per temporal moment. The resulting gaps are not errors — they are the compression itself. The Thaw Decoder's task is to recover what can be recovered, measure what cannot, and clearly report the boundary between the two.

---

## 2. VAM-RGB Encoding

### 2.1 Channel Assignment

Given three consecutive video frames at times T-0.5s, T, and T+0.5s, the VAM-RGB encoder constructs a single output image:

```
For each pixel position (x, y):
    output.R = frame_past.R(x, y)       // Red channel of Past frame
    output.G = frame_present.G(x, y)    // Green channel of Present frame
    output.B = frame_future.B(x, y)     // Blue channel of Future frame
    output.A = 255                       // Fully opaque
```

Each temporal frame contributes exactly one color channel. The other two channels of each frame are discarded. This is the fundamental trade-off: three moments of time are preserved, but each moment retains only 1/3 of its color information.

### 2.2 Fixed Stride

The temporal spacing between frames (the **stride**) is fixed at exactly **0.5 seconds**. This is an invariant of the system — it does not change regardless of content, audio activity, or any other factor.

```
stride = 0.5s (constant)
T_past    = T - stride = T - 0.5s
T_present = T
T_future  = T + stride = T + 0.5s
```

The fixed stride ensures that the physics encoded in the chromatic aberration is always calibrated: a given magnitude of color separation always corresponds to the same velocity, regardless of where the cell appears in the video timeline.

### 2.3 The Physics of Color Separation

When a scene is static, all three frames are identical at pixel (x, y):

```
Static:  R(x,y) ≈ G(x,y) ≈ B(x,y)  →  Grayscale pixel
```

When an object moves between frames, the channels diverge:

```
Motion:  R(x,y) ≠ G(x,y) ≠ B(x,y)  →  Chromatic fringing
```

We define the **colorSeparation** metric as the average maximum inter-channel divergence:

```
For each pixel i:
    div(i) = max(|R(i) - G(i)|, |G(i) - B(i)|, |R(i) - B(i)|) / 255

colorSeparation = (1/N) × Σ div(i)
```

This value ranges from 0.0 (perfectly static) to 1.0 (maximum possible divergence). In practice, real-world cells with moderate motion produce colorSeparation values of 0.15–0.35.

### 2.4 Directional Fringe

Motion direction is encoded in the spatial displacement between channel centroids. We compute the center-of-mass of the R (Past) and B (Future) channels independently:

```
R_centroid = (Σ x·R(x,y) / Σ R(x,y),  Σ y·R(x,y) / Σ R(x,y))
B_centroid = (Σ x·B(x,y) / Σ B(x,y),  Σ y·B(x,y) / Σ B(x,y))

displacement = B_centroid - R_centroid
direction    = atan2(dy, dx)           // in degrees, 0° = rightward
magnitude    = ||displacement|| / diagonal(image)   // normalized 0–1
```

The displacement vector from R-centroid to B-centroid indicates the direction of motion over the 1-second window (Past to Future). The magnitude, normalized by the image diagonal, provides a scale-invariant measure of motion speed.

### 2.5 Physics Intensity

The combined motion score integrates both metrics:

```
physicsIntensity = 0.6 × colorSeparation + 0.4 × fringeMagnitude

hasMotion = physicsIntensity > 0.05
```

### 2.6 Output Format

Each VAM-RGB cell is stored as a 256×256 PNG image. Multiple cells from a video are arranged in a grid or packaged individually in a `.vamrgb.zip` archive containing:

```
video.vamrgb.zip
├── manifest.json        // Package metadata
├── reach-map.json       // Audio-derived temporal density
├── anchor.json          // Temporal anchor points
└── vam-rgb/
    ├── cell_000.png     // VAM-RGB encoded cells
    ├── cell_001.png
    └── ...
```

---

## 3. Audio-Driven Reach

### 3.1 Reach vs. Stride

While stride is fixed (0.5s), **reach** is variable. Reach determines how much temporal context surrounds each cell — the zone of influence in the timeline.

```
Stride: T-0.5s ←—→ T ←—→ T+0.5s     (fixed, always 1.0s total)
Reach:  T-R    ←————————→ T+R         (variable, 1.0s to 6.5s total)
```

Higher reach means more keyframes are extracted within the cell's temporal zone. The gap between adjacent cells' reach zones is the **deleted time** — the intentional gap where no frames are preserved.

### 3.2 Eight Reach Levels

Reach is determined by audio activity analysis. The audio waveform is analyzed in 100ms windows using RMS (Root Mean Square) energy:

```
RMS(window) = √(Σ sample² / windowSize)
```

Normalized activity scores map to eight discrete levels:

| Level | Activity     | Reach  | Gap   | Description                    |
|-------|-------------|--------|-------|--------------------------------|
| 1     | Silence     | 1.0s   | 13.0s | Minimal temporal data needed   |
| 2     | Very Low    | 2.0s   | 11.0s | Background ambient             |
| 3     | Low         | 3.0s   | 9.0s  | Quiet passages                 |
| 4     | Medium-Low  | 4.0s   | 7.0s  | Moderate activity              |
| 5     | Medium      | 5.0s   | 5.0s  | Standard content               |
| 6     | Medium-High | 5.5s   | 4.0s  | Active scenes                  |
| 7     | High        | 6.0s   | 3.0s  | Intense action                 |
| 8     | Intense     | 6.5s   | 2.0s  | Maximum temporal preservation  |

The grid interval (distance between cell centers) is 15 seconds. Gap = 15 - reach_left - reach_right, with a minimum of 2 seconds enforced as a safety constraint.

### 3.3 Design Rationale

Audio activity correlates with visual complexity. Silence typically accompanies static scenes (low information density), while intense audio accompanies action sequences (high information density). By varying reach based on audio, the codec allocates more temporal data to moments that are likely to contain more motion — without analyzing the video itself.

---

## 4. Thaw Decoder

The Thaw Decoder is the inverse of the VAM-RGB encoder. Its name reflects the metaphor: the encoder **freezes** three moments of time into a single image; the decoder **thaws** that image back into temporal frames.

### 4.1 Level 1: Channel Separation

The first level is a pure mathematical inverse of the encoding. No estimation, no AI — just channel extraction.

#### 4.1.1 Grayscale Frame Recovery

Since each channel contains one temporal moment's luminance:

```
For each pixel i (stride 4 for RGBA):
    past_frame[i]    = (R, R, R, 255)    // R channel → grayscale
    present_frame[i] = (G, G, G, 255)    // G channel → grayscale
    future_frame[i]  = (B, B, B, 255)    // B channel → grayscale
```

This produces three grayscale images, each showing one temporal moment. The grayscale representation is exact — no information is lost in this step. The R channel of the Past frame, the G channel of the Present frame, and the B channel of the Future frame are perfectly preserved in the encoding.

#### 4.1.2 Confidence Map

Not all pixels can be equally trusted for color recovery. The confidence map quantifies how likely each pixel is to be static (and thus fully recoverable):

```
For each pixel i:
    maxDiv = max(|R - G|, |G - B|, |R - B|)
    confidence[i] = 1.0 - (maxDiv / 255)
```

- **confidence ≈ 1.0**: R ≈ G ≈ B → static region → original color fully preserved
- **confidence ≈ 0.0**: R ≠ G ≠ B → motion region → only one channel per frame is known

#### 4.1.3 Static Color Extraction

In regions where channels are nearly identical (within threshold), the original color can be directly recovered:

```
threshold = 0.04 × 255 ≈ 10

For each pixel:
    if max(|R-G|, |G-B|, |R-B|) ≤ threshold:
        color[i] = (R, G, B, 255)     // Original color preserved
        mask[i] = 1                     // Static
    else:
        color[i] = (0, 0, 0, 0)       // Unknown
        mask[i] = 0                     // Motion
```

#### 4.1.4 Temporal Delta

The per-pixel temporal displacement provides a signed velocity estimate:

```
delta[i] = (B(i) - R(i)) / 255.0
```

Positive delta indicates brightening over time (or rightward motion of bright objects). Negative delta indicates darkening (or leftward motion).

### 4.2 Level 2: Statistical Color Estimation

Level 2 attempts to recover full color for each temporal frame by estimating the two missing channels. This is inherently lossy — the missing information was discarded during encoding.

#### 4.2.1 Three-Strategy Approach

For each pixel in each frame, the estimator applies one of three strategies in priority order:

**Strategy 1: Direct Copy (Static Regions)**
```
If confidence > threshold (pixel is static):
    estimated_color = original VAM-RGB pixel (R, G, B)
    quality = 1.0
```

In static regions, all three frames had the same pixel value. The VAM-RGB encoding preserves this: R from Past = G from Present = B from Future (approximately). The full color is directly available.

**Strategy 2: Channel Ratio Estimation (Mixed Regions)**
```
From static regions, compute global channel ratios:
    rToG = mean(G_static / R_static)
    rToB = mean(B_static / R_static)
    gToR = mean(R_static / G_static)
    ... (6 ratios total)

For motion pixels with known channel K:
    estimated_missing = known_value × ratio(K → missing)
    quality = 0.5
```

The assumption is that the global color distribution (the ratio between channels) is approximately consistent across the image. Static regions provide ground truth for these ratios, which are then applied to motion regions.

**Strategy 3: Grayscale Fallback**
```
If no static regions exist (pure motion):
    estimated_color = (K, K, K)    // Known channel as grayscale
    quality = 0.0
```

When the entire image is in motion, no cross-channel correlation data exists. The estimator falls back to grayscale, honestly reporting quality = 0.0.

#### 4.2.2 Quality Map

Each estimated pixel carries a quality score:

| Quality | Source | Reliability |
|---------|--------|-------------|
| 1.0     | Static region, direct copy | Exact |
| 0.5     | Ratio estimation from static neighbors | Approximate |
| 0.0     | Grayscale fallback | Luminance only |

### 4.3 Level 3: Round-Trip Validation

The most rigorous test of reconstruction quality is the **round-trip**: take the reconstructed frames, re-encode them using the same _mergeRGB() logic, and compare the result to the original VAM-RGB cell.

#### 4.3.1 Re-Encoding

```
reEncoded.R = reconstructed_past.R        // Past frame's Red channel
reEncoded.G = reconstructed_present.G     // Present frame's Green channel
reEncoded.B = reconstructed_future.B      // Future frame's Blue channel
```

#### 4.3.2 Channel Error

```
For each channel C ∈ {R, G, B}:
    channelError(C) = (1/N) × Σ |original(C, i) - reEncoded(C, i)| / 255

pixelError = (channelError(R) + channelError(G) + channelError(B)) / 3
```

#### 4.3.3 Round-Trip Coherence

```
roundTripCoherence = 1.0 - pixelError
```

- **1.0**: Perfect reconstruction. The re-encoded image is identical to the original.
- **0.0**: Complete failure. No resemblance to the original.

For static content, round-trip coherence is exactly 1.0 — the reconstruction is mathematically perfect. For motion content, coherence depends on the accuracy of color estimation.

#### 4.3.4 Physics Profile Comparison

Beyond pixel-level comparison, the validator also compares the physics profiles of the original and re-encoded cells:

```
colorSepError   = |original.colorSeparation - reEncoded.colorSeparation|
fringeMagError  = |original.fringeMagnitude - reEncoded.fringeMagnitude|
fringeAngleError = angularDifference(original.angle, reEncoded.angle)
intensityError  = |original.physicsIntensity - reEncoded.physicsIntensity|
```

This ensures that the reconstruction preserves not just pixel values but the higher-level physics signature — motion direction, speed, and intensity.

---

## 5. Temporal Interpolation

The Thaw Decoder produces three keyframes: Past, Present, and Future. To generate smooth animation, intermediate frames are created through interpolation.

### 5.1 Linear Pixel Blending

Given two frames A and B, an intermediate frame at parameter t ∈ [0, 1] is computed:

```
For each pixel i:
    blended[i] = round(A[i] × (1 - t) + B[i] × t)
```

This is a linear crossfade — not optical flow interpolation (RIFE, FILM). It produces smooth transitions but does not synthesize motion-aware intermediate frames. For production use, replacing this with optical flow methods would improve quality significantly.

### 5.2 Ping-Pong Loop Topology

The three keyframes are arranged in a cyclic sequence:

```
Past → [blend] → Present → [blend] → Future → [blend] → Present → [blend] → Past → (loop)
```

With one intermediate blend step (the default), this produces a 7-frame loop:

| Frame | Content | Source |
|-------|---------|--------|
| 0     | Past | Keyframe |
| 1     | Past→Present blend (t=0.5) | Interpolated |
| 2     | Present | Keyframe |
| 3     | Present→Future blend (t=0.5) | Interpolated |
| 4     | Future | Keyframe |
| 5     | Future→Present blend (t=0.5) | Interpolated |
| 6     | Present (return) | Keyframe |

Adding a fourth segment (Present → Past) creates a seamless loop of 9+ frames.

The number of intermediate steps is configurable. With `steps=2`, each segment produces two blended frames, yielding a 15-frame loop.

### 5.3 Creation vs. Interpolation

An important distinction exists between two approaches to temporal reconstruction:

**Creation** (e.g., SORA, Runway): The AI generates entirely new frames based on a prompt. Valuable content (V) is high, but physics fidelity (P) is low — the AI halluccinates plausible motion.

**Interpolation** (e.g., RIFE, FILM, or this system's linear blend): No new content is created. Intermediate frames are computed from existing data. V ≈ 0, P > 0 — physics are preserved but no new information appears.

VAM-RGB's linear blend is firmly in the interpolation category. It does not hallucinate; it crossfades. The quality floor is predictable and measurable.

---

## 6. Experimental Results

### 6.1 Automated Test Suite

The system is validated by 88 automated tests across three levels:

| Level | Tests | Description | Pass Rate |
|-------|-------|-------------|-----------|
| Level 1: Channel Separation | 40 | Extraction, confidence, delta, round-trip | 40/40 |
| Level 2: Color Estimation | 22 | Quality maps, ratio estimation, fallback | 22/22 |
| Level 3: Round-Trip Validation | 26 | Coherence, physics, estimated frames | 26/26 |
| **Total** | **88** | | **88/88** |

#### Test Image Factory

Synthetic test images provide controlled validation:

- **Static Gray** (R=G=B=128): Perfect round-trip baseline
- **Max Divergence** (R=255, G=0, B=128): Worst-case chromatic aberration
- **Rightward Motion** (R shifted left, B shifted right): Directional fringe test
- **Half Motion** (top=static, bottom=motion): Mixed confidence map test

### 6.2 Round-Trip Coherence

| Scenario | Coherence | Channel Error (R/G/B) |
|----------|-----------|----------------------|
| Static gray | 1.000 | 0.000 / 0.000 / 0.000 |
| Static with estimation | 1.000 | 0.000 / 0.000 / 0.000 |
| Half-motion (estimated) | ≥ 0.900 | < 0.05 per channel |
| Real cell (cell_042, 256x256) | 1.000 | 0.000 / 0.000 / 0.000 |

The real-world test used a 256x256 VAM-RGB cell extracted from an actual video encoding. Despite having colorSeparation=0.253 and visible directional fringe at 237.8 degrees, the round-trip coherence was 1.000 because the validator measures channel-specific reconstruction — the R channel of the Past frame is always exactly preserved, as is the G of Present and B of Future.

### 6.3 Real-World Thaw Result

A complete encode-thaw-interpolate cycle was performed on a real VAM-RGB cell:

```
Input:   cell_042.png (256x256, VAM-RGB encoded)
Physics: colorSeparation=0.253, direction=237.8°, magnitude=0.012
Static:  10.3% of pixels (confidence ≈ 1.0)

Level 1 Output:
  - cell_000_past.png      (grayscale, R channel)
  - cell_000_present.png   (grayscale, G channel)
  - cell_000_future.png    (grayscale, B channel)
  - cell_000_confidence.png (confidence map)

Level 2 Output:
  - cell_000_past_color.png    (estimated full-color)
  - cell_000_present_color.png (estimated full-color)
  - cell_000_future_color.png  (estimated full-color)
  - cell_000_quality.png       (quality map)

Interpolation Output:
  - 12 frames (4 segments × 3 frames)
  - cell_000_thaw.gif (719 KB, 8 fps, seamless loop)
```

The resulting GIF shows visible temporal motion — objects shift position across frames, matching the direction indicated by the chromatic fringe in the original VAM-RGB cell.

---

## 7. Discussion

### 7.1 Fundamental Limitations

**The Static Color Problem.** The encoder maps R from Past, G from Present, B from Future. A colorful static scene (e.g., a red apple: R=200, G=50, B=50) produces a VAM-RGB pixel (200, 50, 50) — identical to what a specific motion pattern would produce. The decoder cannot distinguish between "static red object" and "object that happened to have these channel values due to motion."

Only truly achromatic (R≈G≈B) static regions can be identified with certainty. This is a fundamental information-theoretic limitation of the encoding, not a bug in the decoder.

**Color Recovery Quality.** In motion regions, 2/3 of color information is permanently lost. The channel ratio estimation (Strategy 2) provides a reasonable approximation when static regions exist nearby, but cannot recover fine color detail in uniformly moving scenes.

**Temporal Resolution.** The fixed 0.5s stride means the system captures temporal changes at 2 Hz. Motion faster than this sampling rate will alias. Sub-stride motion (micro-movements within the 0.5s window) is not captured.

### 7.2 Why Linear Interpolation Is Sufficient

The linear blend in Section 5 is intentionally simple. Its purpose is proof-of-concept: demonstrating that the thawed frames contain genuine temporal information that, when animated, produces visible motion. The crossfade makes no claims of physical accuracy between keyframes.

For production-quality reconstruction, optical flow methods (RIFE, FILM) should replace the linear blend. These methods can synthesize physically plausible intermediate frames by estimating per-pixel motion vectors. The VAM-RGB thaw output — three keyframes with known temporal spacing (0.5s) — is well-suited as input to such methods.

### 7.3 The Role of AI

The Thaw Decoder deliberately avoids AI in Levels 1-2. Channel separation is pure mathematics. Color estimation is statistics. Only Level 3 (validation) uses the PhysicsAnalyzer, which is itself a deterministic computation.

A potential Level 4 would use generative AI (image-to-video models) to reconstruct full-quality video from the thawed frames. The system includes an AI prompt template (`vam-rgb-thaw.js`) designed for this purpose, which instructs the model to:

- Treat chromatic aberration as motion vectors, not lens artifacts
- Generate motion proportional to color separation magnitude
- Keep static regions (R≈G≈B) stationary
- Follow the direction indicated by R→B channel displacement

This is provided as a specification for future integration, not as a claim of current capability.

### 7.4 Comparison to Existing Approaches

| System | Input | Output | Temporal Info | Color Loss |
|--------|-------|--------|--------------|------------|
| H.264/H.265 | Video | Video | Full | Minimal |
| Optical Flow (RIFE) | 2 frames | N frames | Estimated | None |
| VAM-RGB | 3 frames | 1 image | Encoded in RGB | 2/3 per frame |
| VAM-RGB + Thaw | 1 image | 3 frames + loop | Decoded from RGB | Partially recovered |

VAM-RGB is not competing with video codecs on compression efficiency. Its contribution is **representational**: encoding time as color, enabling temporal information to be stored, transmitted, and analyzed as a single still image.

---

## 8. Implementation

### 8.1 Software Architecture

```
src/
├── cli/
│   ├── index.js              # Main CLI entry point
│   ├── thaw-cli.js           # Thaw Decoder CLI (PNG I/O)
│   └── interpolate-cli.js    # 7-Frame interpolation CLI
├── thaw/
│   ├── ChannelSeparator.js   # Level 1: channel separation
│   ├── ColorEstimator.js     # Level 2: color estimation
│   ├── ReconstructionValidator.js  # Level 3: round-trip validation
│   ├── ThawDecoder.js        # Orchestrator
│   └── index.js              # Module exports
├── encoder/
│   └── VamRgbEncoder.js      # Video → VAM-RGB encoding
├── validation/
│   └── PhysicsAnalyzer.js    # Motion physics measurement
└── reach/
    └── AudioReachDetector.js  # Audio → reach level mapping
```

### 8.2 Dependencies

- **sharp** (v0.33): PNG read/write and raw pixel buffer manipulation
- **commander** (v11): CLI argument parsing
- **ffmpeg** (external): Audio analysis and GIF/MP4 assembly
- **Node.js** (v18+): Runtime

### 8.3 Usage

```bash
# Encode video to VAM-RGB
node src/cli/index.js encode video.mp4 -o output.vamrgb.zip

# Thaw a single cell
node src/cli/thaw-cli.js cell_042.png --output-dir ./thaw_output

# Thaw a grid image
node src/cli/thaw-cli.js grid.png --columns 5 --cell-size 256 --output-dir ./thaw_output

# Generate animated GIF from thaw output
node src/cli/interpolate-cli.js ./thaw_output --gif --fps 8

# Full pipeline
node src/cli/thaw-cli.js cell.png -o ./out && node src/cli/interpolate-cli.js ./out --gif
```

---

## 9. Conclusion

VAM-RGB demonstrates that time can be encoded as color and decoded back into motion. The system is mathematically precise where precision is possible (channel separation, round-trip validation) and honestly uncertain where information is lost (color estimation in motion regions).

The Thaw Decoder completes the cycle: what the encoder freezes, the decoder thaws. The 7-frame interpolation loop provides tangible proof that the temporal information survives the round-trip — chromatic aberration in the image becomes visible motion in the animation.

Three frames enter. One image emerges. Three frames return.

Time was frozen. And then it thawed.

---

## Appendix A: Mathematical Notation

| Symbol | Definition |
|--------|-----------|
| T | Center timestamp of a VAM-RGB cell |
| R(x,y), G(x,y), B(x,y) | Channel values at pixel position (x,y) |
| stride | Fixed temporal spacing: 0.5 seconds |
| reach | Variable temporal zone: 1.0 to 6.5 seconds |
| gap | Deleted time between cells: ≥ 2.0 seconds |
| colorSeparation | Mean max inter-channel divergence [0, 1] |
| fringeMagnitude | Normalized channel centroid displacement [0, 1] |
| physicsIntensity | Weighted motion score: 0.6×colorSep + 0.4×fringeMag |
| confidence | Per-pixel static probability: 1 - maxDiv/255 |
| quality | Per-pixel estimation reliability: {0.0, 0.5, 1.0} |
| roundTripCoherence | 1 - mean pixel error after re-encoding [0, 1] |

## Appendix B: Reach Level Table

| Level | Activity Score Range | Reach (s) | Gap (s) | Total Window (s) |
|-------|---------------------|-----------|---------|------------------|
| 1 | 0.00 – 0.05 | 1.0 | 13.0 | 2.0 |
| 2 | 0.05 – 0.15 | 2.0 | 11.0 | 4.0 |
| 3 | 0.15 – 0.30 | 3.0 | 9.0  | 6.0 |
| 4 | 0.30 – 0.45 | 4.0 | 7.0  | 8.0 |
| 5 | 0.45 – 0.60 | 5.0 | 5.0  | 10.0 |
| 6 | 0.60 – 0.75 | 5.5 | 4.0  | 11.0 |
| 7 | 0.75 – 0.90 | 6.0 | 3.0  | 12.0 |
| 8 | 0.90 – 1.00 | 6.5 | 2.0  | 13.0 |

## Appendix C: Test Suite Summary

```
Level 1: ChannelSeparator (40 assertions)
  ✓ Static gray → R=G=B=128 in all separated frames
  ✓ Past frame uses R channel, Present uses G, Future uses B
  ✓ Confidence map: static=1.0, divergent≈0.0
  ✓ Output dimensions match input
  ✓ Rightward motion: bar position shifts across frames
  ✓ Static extraction: gray pixels recovered, motion masked
  ✓ Temporal delta: (B-R)/255 signed displacement
  ✓ Deterministic: same input always produces same output

Level 2: ColorEstimator (22 assertions)
  ✓ Static gray: full color recovery, quality=1.0
  ✓ Pure motion: grayscale fallback, quality=0.0
  ✓ Half-motion: mixed quality map (top=1.0, bottom=0.0)
  ✓ Known channel preserved exactly in output
  ✓ Channel ratios computed from static regions

Level 3: ReconstructionValidator (26 assertions)
  ✓ Static: roundTripCoherence = 1.000
  ✓ Motion with original channels: coherence = 1.000
  ✓ Imperfect reconstruction: coherence < 1.0
  ✓ Physics profiles compared (colorSep, fringe, intensity)
  ✓ Estimated frames: coherence ≥ 0.9

Total: 88/88 passed
```

---

*Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya). Licensed under CC BY-NC 4.0.*
*Implementation assisted by Claude Opus 4.5 (Anthropic).*
