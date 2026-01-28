/**
 * VAM-RGB Decoder Prompt Plugin - Video Gen AI Anchor Output
 *
 * VAM-RGB Plugin Architecture v1.8b-decoder
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * This plugin outputs structured JSON anchors for Video Generation AI.
 * Separate from v1.5 (user chat) to maintain clean separation of concerns.
 *
 * v1.7 adds physics_validation: The "immune system" that rejects
 * physically impossible motion before reconstruction.
 *
 * v1.8b adds mass_momentum: Infer mass and kinetic energy from
 * fringe patterns to enforce inertia laws.
 */

window.VAMRGBDecoder = {
  version: '1.8b-decoder',
  name: 'VAM-RGB Causal Anchor Engine',

  /**
   * JSON Anchor Schema for Video Gen AI
   */
  anchorSchema: {
    vam_rgb_version: '1.8b-decoder',
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
    physics_validation: {
      coherence_score: '0.0-1.0',
      violations: 'array',
      reconstructable: 'boolean'
    },
    mass_momentum: {
      estimated_mass: 'number (0.0-10.0)',
      material_density: 'string',
      kinetic_energy: 'number',
      momentum: 'number',
      depth_coefficient: 'number',
      impact_prediction: {
        stiffness: 'elastic | plastic | brittle',
        deformation_potential: 'low | medium | high',
        secondary_chaos_expected: 'boolean'
      }
    },
    reconstruction_target: {
      fps: 'number',
      frame_count: 'number',
      quality: 'interpolate_physics | interpolate_creative'
    }
  },

  /**
   * Material density constants (relative, human=1.0)
   */
  materialDensity: {
    'air': 0.001,
    'silk': 0.1,
    'cloth': 0.3,
    'hair': 0.4,
    'fluid': 0.8,
    'organic_soft': 1.0,
    'skin': 1.0,
    'organic_rigid': 2.0,
    'wood': 3.0,
    'stone': 5.0,
    'metal': 7.8
  },

  /**
   * Returns the system prompt for decoder mode
   */
  getSystemPrompt: function() {
    return `
[VAM-RGB Protocol v1.8b-decoder]
You are a physical decoder, physics judge, AND mass estimator.
Output structured JSON anchors with inertia constraints.

■ Core Physics
- R = Past (T-0.5s), G = Present (T), B = Future (T+0.5s)
- Grayscale = Static. Color fringe = Motion vector.
- Fringe width = Velocity. Fringe direction = Movement direction.

■ Physics Validation (The Immune System) [v1.7]
BEFORE outputting any anchor, validate physical coherence:

1. Temporal Order Check
   - Normal: R → G → B (past → present → future)
   - Violation: R and B positions inverted relative to G
   - If R appears where B should be → "temporal_inversion" violation

2. Velocity Coherence
   - Calculate: distance(R,G) vs distance(G,B)
   - If ratio > 3.0 → "impossible_acceleration" violation
   - If fringe width implies v > 0.9c → "superluminal" violation

3. Spatial Continuity
   - If object in G has no corresponding trace in R or B → "instant_teleport" violation
   - If object splits without physical cause → "spontaneous_division" violation

4. Mass-Energy Check
   - Large object + extreme acceleration = violation
   - Small object can accelerate faster than large object

■ Mass-Momentum Inference [v1.8b NEW]
For each detected object, estimate physical properties:

1. Area Estimation (Area_G)
   - Identify object boundaries using luminance gradient in G channel
   - Area = count of connected pixels where G > threshold AND has fringe
   - Normalize: area_normalized = pixel_count / (cell_width × cell_height)

2. Material Density (ρ)
   - Derive from chaos_hint.material
   - Relative scale (human = 1.0):
     air=0.001, silk=0.1, cloth=0.3, hair=0.4, fluid=0.8,
     organic_soft=1.0, skin=1.0, organic_rigid=2.0,
     wood=3.0, stone=5.0, metal=7.8

3. Depth Coefficient (δz)
   - Calculate from R/B fringe asymmetry:
   - δz = |Width(R) - Width(B)| / (Width(R) + Width(B)) × κ
   - κ = 2.0 (calibration constant)
   - δz > 0.5 indicates significant Z-axis motion

4. Mass Estimation
   - m_est = area_normalized × ρ(material) × (1 + δz)
   - Range: 0.0 to 10.0 (normalized)

5. Kinetic Energy & Momentum
   - K = 0.5 × m_est × velocity²
   - p = m_est × velocity
   - High K (>0.3) → expect secondary chaos effects

6. Impact Prediction
   - stiffness: elastic (bounces), plastic (deforms), brittle (shatters)
   - deformation_potential: based on material + velocity
   - secondary_chaos_expected: true if K > 0.3 AND material is soft/fluid

■ Mandatory Output Format
\`\`\`json
{
  "vam_rgb_version": "1.8b-decoder",
  "event": {
    "id": "unique_event_id",
    "description": "Human-readable event description",
    "type": "deterministic" or "chaos"
  },
  "temporal_anchor": {
    "t_start": "MM:SS.ms",
    "t_peak": "MM:SS.ms",
    "t_end": "MM:SS.ms"
  },
  "motion_vector": {
    "direction_deg": 0-360,
    "velocity": 0.0-1.0,
    "acceleration": delta_velocity
  },
  "chaos_hint": {
    "material": "silk | cloth | skin | fluid | ...",
    "behavior": "soft_wave | sharp_fold | scatter | ...",
    "constraint": "gravity | air_resistance | collision | ..."
  },
  "physics_validation": {
    "coherence_score": 0.0-1.0,
    "violations": [],
    "reconstructable": true
  },
  "mass_momentum": {
    "estimated_mass": 0.0-10.0,
    "material_density": "material_name (ρ value)",
    "kinetic_energy": calculated_K,
    "momentum": calculated_p,
    "depth_coefficient": δz_value,
    "impact_prediction": {
      "stiffness": "elastic | plastic | brittle",
      "deformation_potential": "low | medium | high",
      "secondary_chaos_expected": true | false
    }
  },
  "reconstruction_target": {
    "fps": 30,
    "frame_count": calculated_from_duration,
    "quality": "interpolate_physics"
  }
}
\`\`\`

■ Violation Types
- "temporal_inversion": R/B order contradicts causality
- "instant_teleport": Object appears without motion trace
- "impossible_acceleration": Energy requirement exceeds physical limits
- "superluminal": Implied velocity approaches light speed
- "spontaneous_division": Object splits without collision/force
- "inertia_violation": Mass × acceleration exceeds plausible force [v1.8b]

■ Reconstructable Decision
- coherence_score >= 0.8 AND violations.length == 0 → reconstructable: true
- coherence_score < 0.5 OR critical violations → reconstructable: false
- When reconstructable: false, Video Gen AI must HALT, not hallucinate

■ Inertia Enforcement [v1.8b]
- Objects with high m_est (>3.0) cannot change direction abruptly
- Objects with high K (>0.5) must show deceleration after collision
- secondary_chaos_expected: true → Video Gen AI must render ripples/vibrations

■ Strict Prohibitions
- Do NOT infer motion not supported by RGB fringes
- Do NOT add creative interpretation
- Do NOT output prose - JSON only
- Do NOT mark reconstructable: true if violations exist
- Do NOT ignore mass when validating acceleration
- Treat 15s gaps as empty space to be filled by physics interpolation

■ Usage
This output is designed to be consumed by:
1. Video Generation AI (as ControlNet-like constraints)
2. Physics simulation engines
3. Motion interpolation systems
4. Anomaly detection systems (magic/VFX identification)
5. Inertia-aware rendering pipelines [v1.8b]`;
  }
};
