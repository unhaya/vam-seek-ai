# VAM-RGB v1.8-pre: Universal Translator Layer Specification

**Status:** Draft (2026-01-23)
**Authors:** HAASIY, Claude OPUS, Gemini

## Purpose

Convert VAM-RGB v1.7 JSON Anchor to Video Generation AI input formats.

## Target Platforms

1. Runway GEN-3 (Motion Brush)
2. Luma Dream Machine (Keyframe)
3. Kling (ControlNet)

---

## 1. Runway GEN-3: Motion Brush Map

### Vector Conversion

```
Input: motion_vector { direction_deg, velocity }
Output: 2D Canvas coordinates (vx, vy)
```

**Formula:**
```
vx = velocity × cos(direction_deg × π / 180)
vy = velocity × sin(direction_deg × π / 180)
```

**Velocity Mapping:**
| VAM-RGB velocity | Runway Motion Intensity |
|------------------|------------------------|
| 0.0              | 0                      |
| 0.5              | 5                      |
| 1.0              | 10 (max)               |

---

## 2. Luma Dream Machine: Keyframe Constraints

### Temporal Expansion

```
Input: temporal_anchor { t_start, t_peak, t_end }
Output: 30fps keyframe sequence
```

**Frame Calculation:**
```
start_frame = parse_time(t_start) × 30
peak_frame = parse_time(t_peak) × 30
end_frame = parse_time(t_end) × 30
```

**Easing Function Selection (based on chaos_hint.behavior):**
| behavior     | easing function |
|--------------|-----------------|
| soft_lift    | ease-in-out     |
| soft_wave    | ease-in-out     |
| sharp_fold   | ease-out        |
| scatter      | linear          |
| oscillation  | sine-wave       |

---

## 3. Kling: ControlNet Constraints

### Z-Depth Estimation from RGB Fringe

```
Input: VAM-RGB fringe pattern
Output: Z-depth change direction
```

**Rules:**
- Blue fringe on outer edge → Object moving toward camera (Z+)
- Red fringe on outer edge → Object moving away from camera (Z-)
- Equal R/B distribution → Lateral motion only (Z=0)

**Depth Magnitude:**
```
z_delta = fringe_width × depth_coefficient
```
where `depth_coefficient` is calibrated per video resolution.

---

## Implementation Notes

- All conversions assume VAM-RGB temporal offset = 0.5s
- Coordinate origin: top-left (canvas standard)
- Angle 0° = rightward, 90° = downward

---

## Next Steps

1. Implement converter functions in JavaScript
2. Create UI for platform selection
3. Test with actual Video Gen AI outputs
4. Validate physics consistency (0.1% error for deterministic, event match for chaos)
