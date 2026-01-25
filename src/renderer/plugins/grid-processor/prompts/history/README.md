# VAM-RGB Prompt Version History

This directory contains archived versions of VAM-RGB prompts for historical reference and rollback capability.

## Version Timeline

| Version | Type | Date | Status | Key Changes |
|---------|------|------|--------|-------------|
| v1.5 | User Chat | 2026-01-23 | Archived | Intent Router, Temporal Interpolation, Motion Priority Rule |
| v1.6-decoder | Video Gen AI | 2026-01-23 | Archived | JSON Anchor output, Event classification |
| v1.7-decoder | Video Gen AI | 2026-01-23 | Archived | Physics Validation (immune system) |
| v1.8a-translator | Video Gen AI | 2026-01-23 | **Active** | Universal Translator (Runway/Luma/Kling) |
| v1.8b-decoder | Video Gen AI | 2026-01-23 | **Active** | Mass-Momentum Inference, Inertia Enforcement |
| v1.8c-chaos | Video Gen AI | 2026-01-23 | **Active** | Secondary Chaos Prediction (Fluid/Collision/Deformation) |
| v1.9-encoder | Video Gen AI | 2026-01-23 | **Active** | Video→VAM-RGB Encoder (Optical Flow, δz Estimation) |
| v2.0 | Video Gen AI | 2026-01-23 | **Draft** | Closed Loop (VAM-RGB + Keyframes + Verification) |

## Active Files

- `../vam-rgb.js` - User chat mode (v1.5)
- `../vam-rgb-decoder.js` - Video Gen AI mode (v1.8b-decoder)
- `../vam-rgb-translator.js` - Platform translator (v1.8a-translator)
- `../vam-rgb-chaos.js` - Secondary chaos prediction (v1.8c-chaos)
- `../vam-rgb-encoder.js` - Video→VAM-RGB encoder (v1.9-encoder)

## How to Rollback

To restore an archived version:

1. Copy the archived file content
2. Replace the active file's `getSystemPrompt()` function
3. Update the version number if needed

## File Naming Convention

`{module}-v{major}.{minor}.js`

- `vam-rgb-v1.5.js` - User chat prompt, version 1.5
- `vam-rgb-decoder-v1.6.js` - Decoder prompt, version 1.6

## Notes

- Archived files use `_v{X}_{Y}` suffix in window object name (e.g., `VAMRGBPrompt_v1_5`)
- Each archived file includes `archived: true` and `archivedDate` properties
- The registry in `../index.js` only loads active versions
