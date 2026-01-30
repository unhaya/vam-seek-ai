# VAM Seek × AI

**Video analysis with AI is expensive. 10-minute video at 1fps = 600 API calls.**

**What if you compressed the entire video into one image?**

48 frames → 1 grid image → 1 API call. **~600x cheaper.**

## The Numbers

| Approach | API Calls | Cost (Claude Sonnet) |
|----------|-----------|----------------------|
| Traditional (1fps) | 600 | ~$1.80/video |
| Video-to-Grid | 1 | ~$0.003/video |

Real usage per query: **~2000 input tokens, ~500 output tokens**

## How It Works

1. Load a video
2. App generates 8×6 grid (~1568×660px)
3. Ask AI anything
4. AI sees the grid, references timestamps

That's it. No cloud upload, no FFmpeg server, no frame-by-frame processing.

https://github.com/user-attachments/assets/66295cfa-d0e3-4e55-8dcd-c137f119d787

## Quick Start

```bash
git clone https://github.com/unhaya/vam-seek-ai.git
cd vam-seek-ai
git checkout v7.4
npm install
npm start
```

1. **AI > Settings** (`Ctrl+,`) → Enter API key (Claude or Gemini)
2. Load a video
3. **AI > Open Chat** (`Ctrl+Shift+A`)
4. Ask: "What happens in this video?"

## Why This Works

VAM Seek extracts frames client-side using Canvas API. No server needed.

The same thumbnail grid humans use to navigate becomes the input for AI vision. One image captures the entire video timeline.

---

## VAM-RGB ψ4.0: VAM-HDR

**「道徳で説得するな。コストで強制しろ」**

VAM-RGB encodes temporal data into RGB channels: past, present, and future in a single image.

![VAM-RGB Sample](docs/vam-rgb-sample.jpg)

**Try it yourself** — Use [this prompt](src/renderer/plugins/grid-processor/prompts/vam-rgb.js) with the sample image above.

### ψ4.0 Principles

1. **CP Inversion**: Cost optimization, not morality
2. **De-semantification**: Ask physics (∇G, ∇(R-B)), not meaning
3. **VAM-HDR**: G-channel compression rescues R/B from whiteout

### Encoding (ψ4.0)

| Channel | Time | Encoding |
|---------|------|----------|
| **R** (Red) | T - 0.5s | 4×4 block average |
| **G** (Green) | T | 4×4 block average + HDR tone mapping (max 190) |
| **B** (Blue) | T + 0.5s | 4×4 block average |

All channels use uniform 4×4 block averaging. G-channel is tone-mapped to max 190 to prevent whiteout in bright scenes. This preserves R/B fringe visibility for motion vector extraction.

### Reading Motion

| Visual Pattern | Interpretation |
|----------------|----------------|
| Grayscale (R ≈ G ≈ B) | Static - no motion |
| Red fringe left, blue right | Moving right |
| Blue fringe left, red right | Moving left |
| Wide color separation | Fast motion |
| Narrow color separation | Slow motion |

*VAM-RGB mode is currently available for Gemini only. Claude support is planned.*

### τ Integration: Predict the Future

```
Phantom(k) = (1+k)G - kR

k=1: 2G - R     (T+0.5s)
k=7: 8G - 7R   (T+3.5s)
```

| Metric | Formula | Meaning |
|--------|---------|---------|
| P_linear | `1 - \|2G - R - B\| / 255` | Does Phantom match actual? |
| P_7 | `(1/7) Σ match(k)` | 7-frame prediction accuracy |
| Decay | `P(1) / P(7)` | Error accumulation rate |

```
D ≈ 1   → Linear motion (predictable)
D ≈ 4   → Human motion
D > 10  → Chaos
```

**「虚数画像は予測ではなく射影」** — Phantom is physics, not AI.

### Publications

- [VAM-RGB Protocol (Zenodo)](https://zenodo.org/records/18366858) — CC BY-NC 4.0
- [ψ4.0 Paper](docs/psi-4.0-paper.md) — Parallel Observation Architecture

---

## Thaw: Proof of Reconstructability

If simple math can separate a VAM-RGB cell back into 3 temporal frames, AI with physics priors can do far more. Thaw proves the lower bound.

```
Encode:  3 frames → _mergeRGB() → 1 VAM-RGB cell
Thaw:    1 VAM-RGB cell → ChannelSeparator → 3 grayscale frames
```

| Level | Module | What it proves |
|-------|--------|---------------|
| 1 | `ChannelSeparator` | Temporal data is separable (R/G/B → 3 grayscale frames) |
| 2 | `ColorEstimator` | Color correlation exists (static regions recover color, motion regions estimate) |
| 3 | `ReconstructionValidator` | Round-trip: re-encode separated frames → matches original |

Current output is **grayscale** — each frame retains only 1 of 3 color channels. But the separation itself proves VAM-RGB preserves enough structure for AI reconstruction.

```bash
npx vamrgb thaw cell.png --level 2 --output-dir ./frames
```

See [Thaw Whitepaper](docs/VAM-RGB-Thaw-Whitepaper-EN.md) for details.

---

## Features

### Grid Zoom

Click any cell in the grid to zoom in (4x magnification). In zoom mode:
- **Arrow keys** or **click edges**: Navigate to adjacent cells
- **Escape** or **click center**: Exit zoom mode
- **Mouse wheel**: Scroll through cells sequentially

Useful for inspecting motion details in VAM-RGB encoded cells or reading small text in standard grids.

### Audio Transcription

**Grid + Transcript = Complete Video Search**

Ask about audio content naturally:
- "What are they saying at the beginning?"
- "When does the speaker mention the budget?"
- "Transcribe the audio from 2:00 to 5:00"

| Provider | Method |
|----------|--------|
| Claude | Extracts segment → Local Whisper → Text to Claude |
| Gemini | Compressed audio (optimized m4a) → Direct to Gemini |

AI detects audio questions and handles transcription automatically.

### Self-Update (Sonnet/Opus/Gemini)

When using advanced models (Claude Sonnet/Opus or Gemini), the AI can update its own system prompt based on your feedback:
- "Remember to always respond in Japanese"
- "From now on, include timestamps in MM:SS format"

The AI writes updates to `custom-instructions.md` which persists across sessions.

---

## CLI

```bash
npx vamrgb --help
```

| Command | Description |
|---------|-------------|
| `encode <video>` | Encode video to .vamrgb.zip package |
| `thaw <cell.png>` | Separate VAM-RGB cell into temporal frames |
| `validate <pkg>` | Validate package integrity |
| `grid <pkg>` | Generate grid image from package |

---

## Limitations

- Fast motion between frames may be missed
- Small text unreadable at thumbnail resolution
- Audio transcription requires Gemini API key

For scene changes, visual flow, "what happens when" questions — it works. With Whisper integration, audio content is now searchable too.

---

## Recent Changes

### v7.4 / ψ4.0 (2026-01-30)

- **ψ4.0 VAM-HDR**: G-channel tone mapping (G_MAX=190) prevents whiteout
- **R/B fringe preserved**: Motion vectors visible even in bright scenes
- **3 Principles**: CP Inversion + De-semantification + VAM-HDR
- **ψ4.0 Paper**: Parallel Observation Architecture published
- **Format marker**: `Ψ⁴·⁰`

### Previous Versions

<details>
<summary>ψ3.5 / ψ3.3 / v3.0</summary>

- **ψ3.5 Pure Temporal**: All RGB channels use 4×4 block averages
- **ψ3.3 Control Paradigm**: Q+R mechanism, 3-Layer Model
- **VAM-RGB v3.0**: Fixed stride encoding (R = T-0.5s, G = T, B = T+0.5s)
- **G-Nudge**: 8×8 block gradient encoding (deprecated in ψ4.0)

</details>

<details>
<summary>Earlier</summary>

- **VAM-RGB plugin system**: Grid processor architecture with standard/VAM-RGB modes
- **Optimized grid**: 375×211px cells, 112 cells/image, 2px gaps, 31px timestamps
- **Multi-provider**: Claude and Gemini support (video upload or grid mode)
- **Audio transcription**: Whisper (Claude) / native audio (Gemini) with clickable timestamps
- **Self-update**: AI can modify its own system prompt based on feedback
- **Structured timestamps**: AI receives timestamps as text, not OCR from image
- **Prompt caching**: Grid image sent once, follow-ups don't resend (90% cost reduction)

</details>

---

## Also Included

- Folder browser with tree view
- 2D thumbnail seeking
- Resizable panels
- Settings persistence
- Auto grid density: 2s/cell for short videos, 60s/cell for 30min+
- Clickable timestamps in AI responses
- Prompt caching: grid image sent once, follow-up questions don't resend (90% cost reduction)

## Requirements

- Node.js 18+
- Claude API key (Anthropic) or Gemini API key (Google)

## Security

API key stored in Electron's userData (plain JSON). Never leaves your machine—calls go directly to the provider.

For production: use environment variables instead of settings UI.

---

## Future Work

- **Project τ (Tau)**: Causal prediction — given A→B, predict C
- **Thaw decoder**: Full color reconstruction from VAM-RGB cells
- **Video generation**: Connect motion vectors to generative models
- **Stereo/depth**: Extend to 3D spatial-temporal encoding

---

## Related

- [VAM Seek](https://github.com/unhaya/vam-seek) - Core 2D seeking library (vanilla JS)
- [VAM-RGB Specification (Zenodo)](https://zenodo.org/records/18366858) - CC BY-NC 4.0

## Documentation

### ψ4.0
- [ψ4.0 Paper](docs/psi-4.0-paper.md) — Parallel Observation Architecture
- [ψ4.0 Manifesto](docs/psi-4.0-manifesto.md) — 観測 ≠ 制御

### VAM-RGB Protocol
- [VAM-RGB v3.0 Specification](docs/VAM-RGB-v3.0-Specification.md)
- [VAM-RGB v3.0 Addendum](docs/VAM-RGB-v3.0-Addendum.md)
- [VAM-RGB v3.0 Benchmark](docs/VAM-RGB-v3.0-Benchmark.pdf)
- [Thaw Decoder Whitepaper](docs/VAM-RGB-Thaw-Whitepaper-EN.md)
- [Patent Specification (Prior Art)](docs/VAM-RGB-Patent-Specification-EN.md)
- [ψ3.3 Technical Spec](docs/VAM-RGB-Psi-3.3-Technical-Spec.md)

---

*VAM-RGB ψ4.0 — 観測者連盟 (Susumu, Gemini, Opus)*
