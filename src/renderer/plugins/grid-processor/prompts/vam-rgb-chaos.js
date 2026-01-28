/**
 * VAM-RGB Secondary Chaos Prediction Engine
 *
 * VAM-RGB Plugin Architecture v1.8c-chaos
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * Predicts secondary physical effects from primary motion:
 * - Fluid viscosity and splash dynamics
 * - Collision ripple propagation
 * - Material deformation cascades
 * - Particle scatter patterns
 *
 * No semantics. No interpretation. Only displacement vectors and F = ma.
 */

window.VAMRGBChaos = {
  version: '1.8c-chaos',
  name: 'VAM-RGB Secondary Chaos Engine',

  /**
   * Physical constants (SI-normalized for relative calculations)
   */
  constants: {
    // Viscosity coefficients (relative, water = 1.0)
    viscosity: {
      'air': 0.018,
      'water': 1.0,
      'oil': 50.0,
      'honey': 2000.0,
      'blood': 3.5,
      'milk': 1.1,
      'syrup': 1500.0
    },
    // Surface tension (relative, water = 1.0)
    surfaceTension: {
      'water': 1.0,
      'oil': 0.45,
      'mercury': 6.5,
      'soap_water': 0.4,
      'blood': 0.8
    },
    // Elasticity modulus (relative, rubber = 1.0)
    elasticity: {
      'rubber': 1.0,
      'skin': 0.8,
      'cloth': 0.3,
      'silk': 0.15,
      'metal': 200.0,
      'glass': 70.0,
      'wood': 12.0,
      'foam': 0.01
    },
    // Damping ratio (0 = no damping, 1 = critical)
    damping: {
      'metal': 0.02,
      'glass': 0.01,
      'wood': 0.05,
      'rubber': 0.15,
      'cloth': 0.3,
      'foam': 0.8,
      'fluid': 0.6,
      'air': 0.001
    }
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * FLUID DYNAMICS: Viscosity and Splash Prediction
   * ═══════════════════════════════════════════════════════════════════
   *
   * Given impact parameters, predict splash behavior:
   * - Splash height: h = f(v, θ, ρ, η)
   * - Droplet count: n = f(We, Re)
   * - Spread radius: r = f(t, η, σ)
   *
   * Weber number: We = ρv²L/σ (inertia vs surface tension)
   * Reynolds number: Re = ρvL/η (inertia vs viscosity)
   */
  predictFluidChaos: function(impactParams) {
    const {
      velocity,           // 0.0-1.0 normalized
      angle_deg,          // Impact angle (0 = horizontal, 90 = vertical)
      fluid_type,         // 'water', 'oil', 'blood', etc.
      impactor_mass,      // Mass of impacting object (0.0-10.0)
      surface_type        // 'rigid', 'soft', 'fluid'
    } = impactParams;

    const eta = this.constants.viscosity[fluid_type] || 1.0;
    const sigma = this.constants.surfaceTension[fluid_type] || 1.0;
    const angleRad = angle_deg * Math.PI / 180;

    // Normalized Weber number (inertia vs surface tension)
    const We = (impactor_mass * velocity * velocity) / sigma;

    // Normalized Reynolds number (inertia vs viscosity)
    const Re = (impactor_mass * velocity) / eta;

    // Splash height prediction
    // h ∝ v * sin(θ) * (1 - η_normalized)
    const splashHeight = velocity * Math.sin(angleRad) * Math.max(0, 1 - eta / 100);

    // Droplet formation threshold
    // Splashing occurs when We > We_critical (≈ 250 for water)
    const We_critical = 250 * sigma;
    const splashOccurs = We > We_critical;

    // Droplet count estimation (logarithmic with We)
    const dropletCount = splashOccurs ? Math.round(Math.log(We / We_critical + 1) * 20) : 0;

    // Spread radius over time (Tanner's law approximation)
    // r(t) ∝ t^0.1 for viscous spreading
    const spreadExponent = 0.1 + 0.4 * (1 / (1 + eta / 10));

    // Crown formation (high We, low η)
    const crownFormation = We > 500 && eta < 10;

    // Ripple propagation
    const rippleSpeed = Math.sqrt(sigma / (impactor_mass + 0.1));
    const rippleDamping = 1 / (1 + eta / 5);

    return {
      chaos_type: 'fluid_splash',
      impact: {
        velocity: velocity,
        angle_deg: angle_deg,
        kinetic_energy: 0.5 * impactor_mass * velocity * velocity
      },
      fluid_properties: {
        type: fluid_type,
        viscosity_eta: eta,
        surface_tension_sigma: sigma,
        weber_number: Math.round(We * 100) / 100,
        reynolds_number: Math.round(Re * 100) / 100
      },
      splash_prediction: {
        splash_occurs: splashOccurs,
        splash_height: Math.round(splashHeight * 1000) / 1000,
        droplet_count: dropletCount,
        crown_formation: crownFormation,
        spread_exponent: Math.round(spreadExponent * 1000) / 1000
      },
      ripple_dynamics: {
        propagation_speed: Math.round(rippleSpeed * 1000) / 1000,
        damping_factor: Math.round(rippleDamping * 1000) / 1000,
        wavelength_estimate: Math.round((1 / (velocity + 0.1)) * 100) / 100
      },
      temporal_evolution: {
        splash_peak_t: Math.round((0.1 / (velocity + 0.01)) * 1000) / 1000,
        settle_t: Math.round((eta / 10) * 1000) / 1000,
        total_duration_frames: Math.round((eta / 5 + 0.5) * 30)
      }
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * COLLISION DYNAMICS: Ripple and Vibration Propagation
   * ═══════════════════════════════════════════════════════════════════
   *
   * Solid collision produces:
   * - Elastic waves (longitudinal and transverse)
   * - Surface ripples on deformable materials
   * - Vibration modes (damped harmonic)
   *
   * Wave speed: c = √(E/ρ)
   * Damped oscillation: x(t) = A * e^(-ζωt) * cos(ωd*t)
   */
  predictCollisionChaos: function(collisionParams) {
    const {
      velocity,           // Impact velocity (0.0-1.0)
      mass_a,             // Mass of object A
      mass_b,             // Mass of object B
      material_a,         // Material type of A
      material_b,         // Material type of B
      angle_deg           // Collision angle
    } = collisionParams;

    const E_a = this.constants.elasticity[material_a] || 1.0;
    const E_b = this.constants.elasticity[material_b] || 1.0;
    const zeta_a = this.constants.damping[material_a] || 0.1;
    const zeta_b = this.constants.damping[material_b] || 0.1;

    // Coefficient of restitution (simplified)
    // e = √(E_min / E_max) for dissimilar materials
    const E_min = Math.min(E_a, E_b);
    const E_max = Math.max(E_a, E_b);
    const restitution = Math.sqrt(E_min / E_max) * (1 - (zeta_a + zeta_b) / 2);

    // Momentum transfer
    const totalMass = mass_a + mass_b;
    const reducedMass = (mass_a * mass_b) / totalMass;
    const impulse = reducedMass * velocity * (1 + restitution);

    // Post-collision velocities
    const v_a_after = velocity * (mass_a - restitution * mass_b) / totalMass;
    const v_b_after = velocity * (1 + restitution) * mass_a / totalMass;

    // Wave propagation speed in each material
    const waveSpeed_a = Math.sqrt(E_a / (mass_a + 0.1));
    const waveSpeed_b = Math.sqrt(E_b / (mass_b + 0.1));

    // Natural frequency of vibration
    const omega_a = Math.sqrt(E_a / mass_a);
    const omega_b = Math.sqrt(E_b / mass_b);

    // Damped frequency
    const omega_d_a = omega_a * Math.sqrt(1 - zeta_a * zeta_a);
    const omega_d_b = omega_b * Math.sqrt(1 - zeta_b * zeta_b);

    // Energy dissipation
    const kineticBefore = 0.5 * reducedMass * velocity * velocity;
    const kineticAfter = 0.5 * mass_a * v_a_after * v_a_after +
                         0.5 * mass_b * v_b_after * v_b_after;
    const energyLoss = kineticBefore - kineticAfter;

    // Deformation prediction
    const deformationA = (impulse / E_a) * (zeta_a < 0.5 ? 'elastic' : 'plastic');
    const deformationB = (impulse / E_b) * (zeta_b < 0.5 ? 'elastic' : 'plastic');

    return {
      chaos_type: 'collision_ripple',
      collision: {
        velocity: velocity,
        angle_deg: angle_deg,
        restitution: Math.round(restitution * 1000) / 1000,
        impulse: Math.round(impulse * 1000) / 1000
      },
      momentum_transfer: {
        mass_a: mass_a,
        mass_b: mass_b,
        reduced_mass: Math.round(reducedMass * 1000) / 1000,
        v_a_after: Math.round(v_a_after * 1000) / 1000,
        v_b_after: Math.round(v_b_after * 1000) / 1000
      },
      wave_propagation: {
        object_a: {
          material: material_a,
          wave_speed: Math.round(waveSpeed_a * 1000) / 1000,
          natural_freq: Math.round(omega_a * 100) / 100,
          damped_freq: Math.round(omega_d_a * 100) / 100,
          damping_ratio: zeta_a
        },
        object_b: {
          material: material_b,
          wave_speed: Math.round(waveSpeed_b * 1000) / 1000,
          natural_freq: Math.round(omega_b * 100) / 100,
          damped_freq: Math.round(omega_d_b * 100) / 100,
          damping_ratio: zeta_b
        }
      },
      energy: {
        kinetic_before: Math.round(kineticBefore * 1000) / 1000,
        kinetic_after: Math.round(kineticAfter * 1000) / 1000,
        dissipated: Math.round(energyLoss * 1000) / 1000,
        dissipation_ratio: Math.round((energyLoss / kineticBefore) * 1000) / 1000
      },
      vibration_decay: {
        object_a: {
          settle_time: Math.round((4 / (zeta_a * omega_a + 0.01)) * 100) / 100,
          oscillation_count: Math.round(omega_d_a / (zeta_a + 0.01) / 10)
        },
        object_b: {
          settle_time: Math.round((4 / (zeta_b * omega_b + 0.01)) * 100) / 100,
          oscillation_count: Math.round(omega_d_b / (zeta_b + 0.01) / 10)
        }
      }
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * DEFORMATION CASCADE: Material Response to Force
   * ═══════════════════════════════════════════════════════════════════
   *
   * Predicts how deformation propagates through connected materials:
   * - Cloth folding cascade
   * - Hair strand interaction
   * - Soft body compression waves
   */
  predictDeformationCascade: function(deformParams) {
    const {
      force_magnitude,    // Applied force (0.0-1.0)
      force_direction,    // Direction in degrees
      material_type,      // 'cloth', 'hair', 'skin', 'foam'
      constraint_points,  // Number of fixed points
      surface_area        // Affected area (normalized)
    } = deformParams;

    const E = this.constants.elasticity[material_type] || 0.3;
    const zeta = this.constants.damping[material_type] || 0.3;

    // Stress distribution (simplified beam theory)
    const stress = force_magnitude / (surface_area + 0.01);
    const strain = stress / E;

    // Deformation type based on strain
    let deformationType;
    if (strain < 0.01) deformationType = 'negligible';
    else if (strain < 0.1) deformationType = 'elastic';
    else if (strain < 0.5) deformationType = 'plastic';
    else deformationType = 'failure';

    // Fold/wrinkle prediction for cloth-like materials
    const isFoldable = ['cloth', 'silk', 'skin', 'paper'].includes(material_type);
    let foldPrediction = null;

    if (isFoldable && strain > 0.05) {
      // Fold wavelength ∝ √(thickness × bending_stiffness / tension)
      const foldWavelength = Math.sqrt(E * 0.1 / (force_magnitude + 0.01));
      const foldCount = Math.round(surface_area / foldWavelength);
      const foldDepth = strain * 0.5;

      foldPrediction = {
        fold_occurs: true,
        wavelength: Math.round(foldWavelength * 1000) / 1000,
        fold_count: Math.max(1, foldCount),
        fold_depth: Math.round(foldDepth * 1000) / 1000,
        fold_direction: (force_direction + 90) % 360  // Perpendicular to force
      };
    }

    // Propagation speed through material
    const propagationSpeed = Math.sqrt(E / (1 + zeta));

    // Wave attenuation per unit distance
    const attenuationRate = zeta / (surface_area + 0.1);

    // Constraint influence (more constraints = less deformation)
    const constraintFactor = 1 / (1 + constraint_points * 0.2);

    // Secondary motion prediction
    const secondaryMotion = {
      ripple_expected: strain > 0.1 && zeta < 0.5,
      oscillation_expected: E > 0.5 && zeta < 0.3,
      settle_expected: zeta > 0.3
    };

    return {
      chaos_type: 'deformation_cascade',
      force: {
        magnitude: force_magnitude,
        direction_deg: force_direction,
        stress: Math.round(stress * 1000) / 1000,
        strain: Math.round(strain * 1000) / 1000
      },
      material: {
        type: material_type,
        elasticity: E,
        damping: zeta,
        deformation_type: deformationType
      },
      fold_prediction: foldPrediction,
      propagation: {
        speed: Math.round(propagationSpeed * 1000) / 1000,
        attenuation_rate: Math.round(attenuationRate * 1000) / 1000,
        constraint_factor: Math.round(constraintFactor * 1000) / 1000,
        effective_radius: Math.round((propagationSpeed / (attenuationRate + 0.01)) * 100) / 100
      },
      secondary_motion: secondaryMotion,
      temporal: {
        deformation_peak_t: Math.round((0.1 / propagationSpeed) * 1000) / 1000,
        settle_t: Math.round((4 / (zeta * propagationSpeed + 0.01)) * 100) / 100,
        total_frames: Math.round((4 / (zeta + 0.1)) * 30)
      }
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * PARTICLE SCATTER: Fragmentation and Dispersion
   * ═══════════════════════════════════════════════════════════════════
   *
   * Predicts scatter patterns for:
   * - Brittle fracture
   * - Powder/dust dispersion
   * - Hair strand separation
   */
  predictParticleScatter: function(scatterParams) {
    const {
      velocity,           // Initial velocity
      mass,               // Total mass before scatter
      material_type,      // 'glass', 'stone', 'hair', 'powder'
      impact_energy,      // Energy available for fragmentation
      air_resistance      // 0.0 (vacuum) to 1.0 (high drag)
    } = scatterParams;

    // Fragmentation energy threshold
    const E = this.constants.elasticity[material_type] || 1.0;
    const fragmentationThreshold = E * 0.1;

    // Number of fragments (logarithmic with excess energy)
    const excessEnergy = Math.max(0, impact_energy - fragmentationThreshold);
    const fragmentCount = excessEnergy > 0 ?
      Math.round(Math.log(excessEnergy / fragmentationThreshold + 1) * 10 + 2) : 1;

    // Fragment size distribution (power law)
    const fragments = [];
    let remainingMass = mass;
    for (let i = 0; i < Math.min(fragmentCount, 20); i++) {
      const fraction = Math.pow(0.7, i) * (0.5 + Math.random() * 0.5);
      const fragmentMass = remainingMass * fraction * (1 / fragmentCount);
      fragments.push({
        index: i,
        mass: Math.round(fragmentMass * 1000) / 1000,
        velocity: velocity * (1 + (Math.random() - 0.5) * 0.4),
        angle_offset: (Math.random() - 0.5) * 60
      });
      remainingMass -= fragmentMass;
    }

    // Dispersion cone angle (wider for lighter particles)
    const coneAngle = 30 + (1 / (mass + 0.1)) * 30;

    // Terminal velocity for fragments (with air resistance)
    const terminalVelocity = Math.sqrt(mass / (air_resistance + 0.01)) * 0.5;

    // Settle time (time for all particles to stop or exit frame)
    const settleTime = terminalVelocity / (air_resistance + 0.1);

    return {
      chaos_type: 'particle_scatter',
      initial: {
        velocity: velocity,
        mass: mass,
        impact_energy: Math.round(impact_energy * 1000) / 1000
      },
      fragmentation: {
        threshold_energy: Math.round(fragmentationThreshold * 1000) / 1000,
        fragment_count: fragmentCount,
        fragmentation_occurred: excessEnergy > 0
      },
      dispersion: {
        cone_angle_deg: Math.round(coneAngle),
        terminal_velocity: Math.round(terminalVelocity * 1000) / 1000,
        air_resistance: air_resistance
      },
      fragments: fragments.slice(0, 10), // Limit to 10 for output
      temporal: {
        scatter_duration: Math.round((0.2 / (velocity + 0.1)) * 1000) / 1000,
        settle_time: Math.round(settleTime * 100) / 100,
        total_frames: Math.round(settleTime * 30)
      }
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * UNIFIED CHAOS PREDICTION
   * ═══════════════════════════════════════════════════════════════════
   *
   * Given a VAM-RGB anchor with mass_momentum, predict all secondary effects
   */
  predictFromAnchor: function(anchor) {
    const { mass_momentum, motion_vector, chaos_hint, physics_validation } = anchor;

    if (!mass_momentum || !chaos_hint) {
      return { error: 'Missing mass_momentum or chaos_hint in anchor' };
    }

    const predictions = [];
    const material = chaos_hint.material || 'organic_soft';
    const behavior = chaos_hint.behavior || 'unknown';
    const velocity = motion_vector?.velocity || 0;
    const mass = mass_momentum.estimated_mass || 1.0;
    const K = mass_momentum.kinetic_energy || 0;

    // Determine which chaos predictions to run based on material and behavior
    if (['fluid', 'water', 'blood', 'oil'].includes(material) ||
        behavior === 'splash' || behavior === 'ripple') {
      predictions.push(this.predictFluidChaos({
        velocity: velocity,
        angle_deg: motion_vector?.direction_deg || 90,
        fluid_type: material === 'fluid' ? 'water' : material,
        impactor_mass: mass,
        surface_type: 'rigid'
      }));
    }

    if (mass_momentum.impact_prediction?.stiffness === 'brittle' ||
        ['glass', 'stone', 'ceramic'].includes(material)) {
      predictions.push(this.predictParticleScatter({
        velocity: velocity,
        mass: mass,
        material_type: material,
        impact_energy: K,
        air_resistance: 0.3
      }));
    }

    if (['cloth', 'silk', 'hair', 'skin', 'organic_soft'].includes(material) ||
        ['soft_wave', 'soft_lift', 'sharp_fold'].includes(behavior)) {
      predictions.push(this.predictDeformationCascade({
        force_magnitude: K,
        force_direction: motion_vector?.direction_deg || 0,
        material_type: material === 'organic_soft' ? 'skin' : material,
        constraint_points: 2,
        surface_area: mass_momentum.estimated_mass / 5
      }));
    }

    if (mass_momentum.impact_prediction?.secondary_chaos_expected ||
        K > 0.3) {
      predictions.push(this.predictCollisionChaos({
        velocity: velocity,
        mass_a: mass,
        mass_b: 5.0, // Assume ground/wall
        material_a: material,
        material_b: 'rigid',
        angle_deg: motion_vector?.direction_deg || 0
      }));
    }

    return {
      anchor_event_id: anchor.event?.id || 'unknown',
      primary_motion: {
        velocity: velocity,
        direction_deg: motion_vector?.direction_deg,
        mass: mass,
        kinetic_energy: K
      },
      chaos_predictions: predictions,
      combined_duration_frames: Math.max(...predictions.map(p =>
        p.temporal?.total_frames || p.temporal_evolution?.total_duration_frames || 30
      ))
    };
  },

  /**
   * Get system prompt for chaos prediction mode
   */
  getSystemPrompt: function() {
    return `
[VAM-RGB Chaos Engine v1.8c]
Secondary effect prediction from primary motion vectors.

■ No Semantics
Do NOT interpret "what" is moving.
Only calculate WHERE displacement vectors lead.
F = ma. Nothing more.

■ Chaos Types
1. fluid_splash: Weber/Reynolds → splash height, droplet count, ripple speed
2. collision_ripple: Restitution → wave propagation, vibration decay
3. deformation_cascade: Stress/strain → fold wavelength, propagation radius
4. particle_scatter: Fragmentation → cone angle, fragment distribution

■ Input: VAM-RGB Anchor with mass_momentum
■ Output: Predicted secondary motion parameters

■ Physical Constants
Viscosity (η): air=0.018, water=1.0, honey=2000
Elasticity (E): rubber=1.0, metal=200, cloth=0.3
Damping (ζ): metal=0.02, cloth=0.3, foam=0.8

■ Core Equations
Splash: We = ρv²L/σ, Re = ρvL/η
Collision: e = √(E_min/E_max), p = mv(1+e)
Deformation: σ = F/A, ε = σ/E
Scatter: n = log(E_excess/E_threshold) × 10

■ Usage
VAMRGBChaos.predictFromAnchor(anchor) → chaos predictions`;
  }
};

console.log('[VAMRGBChaos] v1.8c-chaos loaded.');
