# VAM-RGB v1.8-draft: Mass-Momentum Inference Layer

**Status:** Draft (2026-01-23)
**Authors:** Gemini, reviewed by OPUS

## Purpose

Infer object mass and momentum from VAM-RGB data to enforce inertia laws on Video Gen AI.

---

## 1. Mass Estimation Model

### Formula

```
m_est = Area(G) × ρ(material) × δz
```

Where:
- `Area(G)`: Object pixel area in G channel
- `ρ(material)`: Estimated density constant from chaos_hint
- `δz`: Depth thickness coefficient from fringe spread

### Material Density Constants (Relative)

| material      | ρ (relative) |
|---------------|--------------|
| silk          | 0.1          |
| cloth         | 0.3          |
| organic_soft  | 1.0          |
| skin          | 1.0          |
| organic_rigid | 2.0          |
| metal         | 7.8          |

**Note:** These are relative values, not physical kg/m³. Calibration needed.

---

## 2. Kinetic Energy & Momentum

### Formulas

```
K = (1/2) × m_est × v²    (Kinetic Energy)
p = m_est × v              (Momentum)
```

Where `v` is the velocity from VAM-RGB fringe width (0.0-1.0).

---

## 3. Extended JSON Schema

```json
{
  "physics_validation": {
    "coherence_score": 0.85,
    "violations": []
  },
  "mass_momentum": {
    "estimated_mass": 0.45,
    "material_density": "organic_soft (1.0)",
    "kinetic_energy": 0.324,
    "momentum_vector": 0.27,
    "impact_prediction": {
      "stiffness": "elastic | plastic | brittle",
      "deformation_potential": "low | medium | high",
      "secondary_chaos_expected": true | false
    }
  }
}
```

---

## 4. Implementation Concerns (OPUS Review)

### Unresolved Issues

1. **Area(G) extraction**: Requires segmentation logic not yet implemented
2. **ρ(material) calibration**: Relative values need empirical validation
3. **δz estimation**: Single-image depth inference is a separate AI problem
4. **Secondary chaos**: Prediction logic undefined

### Proposed Implementation Phases

| Phase | Version | Scope |
|-------|---------|-------|
| 1     | v1.8a   | Translator Layer (Runway/Luma/Kling) |
| 2     | v1.8b   | Mass Estimation (with segmentation) |
| 3     | v1.8c   | Secondary Chaos Prediction |

---

## 5. Potential Applications

- **Inertia enforcement**: Heavy objects can't stop/turn abruptly
- **Chaos resolution**: Cloth weight affects gravity and air drag simulation
- **Causal necessity**: High-K regions trigger secondary effects (air distortion, vibration)

---

## Next Steps

1. Implement v1.8a (Translator Layer) first
2. Develop segmentation logic for Area(G) extraction
3. Calibrate ρ(material) with test videos
4. Validate K/p calculations against real physics
