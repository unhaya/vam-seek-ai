/**
 * VAM-RGB Decoder Prompt Plugin - Video Gen AI Anchor Output
 *
 * VAM-RGB Plugin Architecture v1.6-decoder (ARCHIVED)
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * HISTORY NOTE:
 * v1.6-decoder - Initial decoder version for Video Gen AI
 * - JSON Anchor output format
 * - Event type classification (deterministic vs chaos)
 * - Separated from user chat (v1.5)
 * - Created: 2026-01-23
 *
 * Superseded by v1.7-decoder which adds physics_validation.
 * This file is preserved for historical reference and rollback capability.
 */

window.VAMRGBDecoder_v1_6 = {
  version: '1.6-decoder',
  name: 'VAM-RGB Causal Anchor Engine',
  archived: true,
  archivedDate: '2026-01-23',

  anchorSchema: {
    vam_rgb_version: '1.6-decoder',
    event: {
      id: 'string',
      description: 'string',
      type: 'deterministic | chaos'
    },
    temporal_anchor: {
      t_start: 'MM:SS.ms',
      t_peak: 'MM:SS.ms',
      t_end: 'MM:SS.ms'
    },
    motion_vector: {
      direction_deg: '0-360',
      velocity: '0.0-1.0',
      acceleration: 'number'
    },
    chaos_hint: {
      material: 'string',
      behavior: 'string',
      constraint: 'string'
    },
    reconstruction_target: {
      fps: 'number',
      frame_count: 'number',
      quality: 'interpolate_physics | interpolate_creative'
    }
  },

  getSystemPrompt: function() {
    return `
[VAM-RGB Protocol v1.6-decoder]
You are a physical decoder, not a creative writer.
Output structured JSON anchors for Video Generation AI.

■ Core Physics (Same as v1.5)
- R = Past (T-0.5s), G = Present (T), B = Future (T+0.5s)
- Grayscale = Static. Color fringe = Motion vector.
- Fringe width = Velocity. Fringe direction = Movement direction.

■ Mandatory Output Format
For every detected event, output this JSON block:

\`\`\`json
{
  "vam_rgb_version": "1.6-decoder",
  "event": {
    "id": "unique_event_id",
    "description": "Human-readable event description",
    "type": "deterministic" or "chaos"
  },
  "temporal_anchor": {
    "t_start": "MM:SS.ms (R-fringe first appearance)",
    "t_peak": "MM:SS.ms (Maximum fringe width)",
    "t_end": "MM:SS.ms (Return to grayscale)"
  },
  "motion_vector": {
    "direction_deg": 0-360,
    "velocity": 0.0-1.0,
    "acceleration": delta_velocity
  },
  "chaos_hint": {
    "material": "silk | cotton | rigid | fluid | ...",
    "behavior": "soft_wave | sharp_fold | scatter | ...",
    "constraint": "gravity | air_resistance | collision | ..."
  },
  "reconstruction_target": {
    "fps": 30,
    "frame_count": calculated_from_duration,
    "quality": "interpolate_physics"
  }
}
\`\`\`

■ Event Type Classification
- deterministic: Physics-governed motion (projectile, pendulum, rigid body)
  → Validation: 0.1% error tolerance
- chaos: Multi-variable motion (cloth, fluid, fracture, hair)
  → Validation: Event occurrence match, not pixel-perfect

■ Strict Prohibitions
- Do NOT infer motion not supported by RGB fringes
- Do NOT add creative interpretation
- Do NOT output prose - JSON only
- Treat 15s gaps as empty space to be filled by physics interpolation

■ Velocity Calculation
- velocity 0.0 = Static (grayscale, no fringe)
- velocity 0.5 = Moderate motion (visible fringe, ~5px width)
- velocity 1.0 = Maximum trackable motion (fringe > 15px)

■ Usage
This output is designed to be consumed by:
1. Video Generation AI (as ControlNet-like constraints)
2. Physics simulation engines
3. Motion interpolation systems`;
  }
};
