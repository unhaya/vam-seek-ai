/**
 * VAM-RGB Universal Translator Layer
 *
 * VAM-RGB Plugin Architecture v1.8a-translator
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * Converts VAM-RGB JSON Anchors to Video Generation AI platform formats:
 * - Runway GEN-3 (Motion Brush)
 * - Luma Dream Machine (Keyframe)
 * - Kling (ControlNet Depth)
 */

window.VAMRGBTranslator = {
  version: '1.8a-translator',
  name: 'VAM-RGB Universal Translator',

  /**
   * Supported platforms
   */
  platforms: ['runway', 'luma', 'kling'],

  /**
   * Easing function mapping for Luma Dream Machine
   * Based on chaos_hint.behavior
   */
  easingMap: {
    'soft_lift': 'ease-in-out',
    'soft_wave': 'ease-in-out',
    'sharp_fold': 'ease-out',
    'scatter': 'linear',
    'oscillation': 'sine-wave',
    'bounce': 'ease-out-bounce',
    'settle': 'ease-out',
    'default': 'ease-in-out'
  },

  /**
   * Convert VAM-RGB anchor to specified platform format
   * @param {Object} anchor - VAM-RGB JSON Anchor
   * @param {string} platform - Target platform ('runway' | 'luma' | 'kling')
   * @param {Object} options - Platform-specific options
   * @returns {Object} Platform-specific output
   */
  translate: function(anchor, platform, options = {}) {
    if (!this.platforms.includes(platform)) {
      throw new Error(`Unknown platform: ${platform}. Supported: ${this.platforms.join(', ')}`);
    }

    switch (platform) {
      case 'runway':
        return this.toRunway(anchor, options);
      case 'luma':
        return this.toLuma(anchor, options);
      case 'kling':
        return this.toKling(anchor, options);
      default:
        throw new Error(`Platform not implemented: ${platform}`);
    }
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * RUNWAY GEN-3: Motion Brush Conversion
   * ═══════════════════════════════════════════════════════════════════
   *
   * Converts motion_vector to 2D canvas coordinates (vx, vy)
   *
   * Formula:
   *   vx = velocity × cos(direction_deg × π / 180)
   *   vy = velocity × sin(direction_deg × π / 180)
   *
   * Velocity Mapping:
   *   VAM-RGB 0.0 → Runway intensity 0
   *   VAM-RGB 0.5 → Runway intensity 5
   *   VAM-RGB 1.0 → Runway intensity 10 (max)
   */
  toRunway: function(anchor, options = {}) {
    const { motion_vector, temporal_anchor, event, mass_momentum } = anchor;
    const canvasWidth = options.canvasWidth || 1920;
    const canvasHeight = options.canvasHeight || 1080;
    const maxIntensity = options.maxIntensity || 10;

    // Extract values
    const velocity = motion_vector?.velocity || 0;
    const directionDeg = motion_vector?.direction_deg || 0;
    const directionRad = directionDeg * Math.PI / 180;

    // Calculate vector components
    const vx = velocity * Math.cos(directionRad);
    const vy = velocity * Math.sin(directionRad);

    // Map velocity to Runway intensity (0-10)
    const intensity = velocity * maxIntensity;

    // Calculate brush stroke endpoints (normalized 0-1)
    const centerX = options.centerX || 0.5;
    const centerY = options.centerY || 0.5;
    const strokeLength = velocity * 0.2; // 20% of canvas at max velocity

    const startX = centerX;
    const startY = centerY;
    const endX = centerX + vx * strokeLength;
    const endY = centerY + vy * strokeLength;

    // Adjust intensity based on mass (heavier objects = more persistent motion)
    let adjustedIntensity = intensity;
    if (mass_momentum?.estimated_mass) {
      const massFactor = Math.min(mass_momentum.estimated_mass / 5.0, 2.0);
      adjustedIntensity = intensity * (0.5 + massFactor * 0.5);
    }

    return {
      platform: 'runway_gen3',
      format_version: '1.0',
      event_id: event?.id || 'unknown',
      motion_brush: {
        // Brush stroke definition
        stroke: {
          start: { x: startX, y: startY },
          end: { x: Math.max(0, Math.min(1, endX)), y: Math.max(0, Math.min(1, endY)) },
          intensity: Math.round(adjustedIntensity * 10) / 10,
          direction_deg: directionDeg
        },
        // Vector components for advanced usage
        vector: {
          vx: Math.round(vx * 1000) / 1000,
          vy: Math.round(vy * 1000) / 1000,
          magnitude: Math.round(velocity * 1000) / 1000
        },
        // Temporal info
        timing: {
          start_frame: this._timeToFrame(temporal_anchor?.t_start, 30),
          peak_frame: this._timeToFrame(temporal_anchor?.t_peak, 30),
          end_frame: this._timeToFrame(temporal_anchor?.t_end, 30)
        },
        // Mass-aware motion persistence
        persistence: mass_momentum ? {
          inertia_factor: mass_momentum.estimated_mass / 10.0,
          decay_rate: 1.0 / (1.0 + mass_momentum.kinetic_energy)
        } : null
      },
      canvas: {
        width: canvasWidth,
        height: canvasHeight
      }
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * LUMA DREAM MACHINE: Keyframe Constraints
   * ═══════════════════════════════════════════════════════════════════
   *
   * Generates keyframe sequence with physics-based easing
   *
   * Frame Calculation:
   *   start_frame = parse_time(t_start) × fps
   *   peak_frame = parse_time(t_peak) × fps
   *   end_frame = parse_time(t_end) × fps
   *
   * Easing Selection (based on chaos_hint.behavior):
   *   soft_lift/soft_wave → ease-in-out
   *   sharp_fold → ease-out
   *   scatter → linear
   *   oscillation → sine-wave
   */
  toLuma: function(anchor, options = {}) {
    const { motion_vector, temporal_anchor, chaos_hint, event, mass_momentum } = anchor;
    const fps = options.fps || 30;

    // Parse temporal anchors to frames
    const startFrame = this._timeToFrame(temporal_anchor?.t_start, fps);
    const peakFrame = this._timeToFrame(temporal_anchor?.t_peak, fps);
    const endFrame = this._timeToFrame(temporal_anchor?.t_end, fps);

    // Select easing function based on behavior
    const behavior = chaos_hint?.behavior || 'default';
    const easing = this.easingMap[behavior] || this.easingMap['default'];

    // Calculate velocity curve based on physics
    const velocity = motion_vector?.velocity || 0;
    const acceleration = motion_vector?.acceleration || 0;

    // Generate keyframes with physics interpolation
    const keyframes = [];

    // Start keyframe (motion begins)
    keyframes.push({
      frame: startFrame,
      velocity: 0,
      position_delta: 0,
      easing_to_next: this._getAccelerationEasing(acceleration, easing)
    });

    // Peak keyframe (maximum velocity)
    keyframes.push({
      frame: peakFrame,
      velocity: velocity,
      position_delta: this._calculateDisplacement(0, velocity, peakFrame - startFrame, fps),
      easing_to_next: this._getDecelerationEasing(mass_momentum, easing)
    });

    // End keyframe (motion settles)
    keyframes.push({
      frame: endFrame,
      velocity: 0,
      position_delta: this._calculateDisplacement(velocity, 0, endFrame - peakFrame, fps),
      easing_to_next: null
    });

    // Calculate "hold" and "anticipation" based on mass
    let anticipationFrames = 0;
    let settleFrames = 0;
    if (mass_momentum) {
      // Heavy objects need more anticipation (windup) and settle time
      anticipationFrames = Math.round(mass_momentum.estimated_mass * 2);
      settleFrames = Math.round(mass_momentum.kinetic_energy * fps * 0.5);
    }

    return {
      platform: 'luma_dream_machine',
      format_version: '1.0',
      event_id: event?.id || 'unknown',
      keyframe_sequence: {
        fps: fps,
        total_frames: endFrame - startFrame + settleFrames,
        keyframes: keyframes,
        // Physics-based timing adjustments
        timing_modifiers: {
          anticipation_frames: anticipationFrames,
          settle_frames: settleFrames,
          hold_at_peak: peakFrame === endFrame ? 0 : Math.round((endFrame - peakFrame) * 0.1)
        }
      },
      easing_profile: {
        base_easing: easing,
        behavior_hint: behavior,
        material_hint: chaos_hint?.material || 'unknown'
      },
      // Secondary motion for chaos events
      secondary_motion: chaos_hint && event?.type === 'chaos' ? {
        ripple_enabled: mass_momentum?.impact_prediction?.secondary_chaos_expected || false,
        oscillation_frequency: behavior === 'oscillation' ? 2.0 : 0,
        damping: mass_momentum ? 1.0 / (1.0 + mass_momentum.estimated_mass) : 0.5
      } : null
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * KLING: ControlNet Depth Map Conversion
   * ═══════════════════════════════════════════════════════════════════
   *
   * Converts δz (depth coefficient) to depth map intensity
   *
   * Z-Depth Rules:
   *   Blue fringe on outer edge → Object moving toward camera (Z+)
   *   Red fringe on outer edge → Object moving away from camera (Z-)
   *   Equal R/B distribution → Lateral motion only (Z=0)
   *
   * Depth Magnitude:
   *   z_delta = fringe_width × depth_coefficient
   */
  toKling: function(anchor, options = {}) {
    const { motion_vector, temporal_anchor, event, mass_momentum, physics_validation } = anchor;
    const resolution = options.resolution || { width: 1920, height: 1080 };
    const depthRange = options.depthRange || { min: 0, max: 255 };

    // Extract depth coefficient from mass_momentum
    const depthCoefficient = mass_momentum?.depth_coefficient || 0;
    const velocity = motion_vector?.velocity || 0;
    const directionDeg = motion_vector?.direction_deg || 0;

    // Calculate Z-axis motion direction from fringe analysis
    // Positive δz = moving toward camera, Negative = moving away
    const zDirection = depthCoefficient > 0.1 ? 'toward' :
                       depthCoefficient < -0.1 ? 'away' : 'lateral';

    // Calculate depth delta (normalized 0-1)
    const depthDelta = Math.abs(depthCoefficient) * velocity;

    // Map to ControlNet depth value (0-255)
    const depthValue = Math.round(128 + (depthCoefficient * velocity * 127));
    const clampedDepth = Math.max(depthRange.min, Math.min(depthRange.max, depthValue));

    // Calculate depth change over time
    const startFrame = this._timeToFrame(temporal_anchor?.t_start, 30);
    const endFrame = this._timeToFrame(temporal_anchor?.t_end, 30);
    const frameDuration = endFrame - startFrame;

    // Generate depth keyframes
    const depthKeyframes = [];
    if (frameDuration > 0) {
      // Linear interpolation with mass-based momentum
      const steps = Math.min(frameDuration, 10); // Max 10 keyframes
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const frame = startFrame + Math.round(t * frameDuration);

        // Apply easing based on mass (heavy objects change depth more slowly)
        let easedT = t;
        if (mass_momentum?.estimated_mass > 3.0) {
          // Heavy object: slow start, slow end
          easedT = t * t * (3 - 2 * t); // smoothstep
        }

        const currentDepth = 128 + (depthCoefficient * velocity * 127 * easedT);
        depthKeyframes.push({
          frame: frame,
          depth: Math.round(Math.max(0, Math.min(255, currentDepth))),
          confidence: physics_validation?.coherence_score || 1.0
        });
      }
    }

    return {
      platform: 'kling_controlnet',
      format_version: '1.0',
      event_id: event?.id || 'unknown',
      depth_control: {
        // Static depth info
        base_depth: 128, // Neutral plane
        depth_delta: Math.round(depthDelta * 1000) / 1000,
        z_direction: zDirection,
        depth_coefficient: Math.round(depthCoefficient * 1000) / 1000,

        // ControlNet values
        controlnet_depth: clampedDepth,
        controlnet_strength: Math.min(1.0, velocity + 0.3), // Base strength + velocity

        // Temporal depth sequence
        depth_keyframes: depthKeyframes
      },
      // Lateral motion (X/Y) for combined control
      lateral_motion: {
        direction_deg: directionDeg,
        velocity: velocity,
        vx: Math.round(velocity * Math.cos(directionDeg * Math.PI / 180) * 1000) / 1000,
        vy: Math.round(velocity * Math.sin(directionDeg * Math.PI / 180) * 1000) / 1000
      },
      // Mass influence on depth persistence
      depth_inertia: mass_momentum ? {
        mass_factor: mass_momentum.estimated_mass / 10.0,
        momentum_z: mass_momentum.momentum * depthCoefficient,
        settle_frames: Math.round(mass_momentum.estimated_mass * 3)
      } : null,
      resolution: resolution
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * BATCH TRANSLATION
   * ═══════════════════════════════════════════════════════════════════
   *
   * Translate multiple anchors for a video sequence
   */
  translateBatch: function(anchors, platform, options = {}) {
    if (!Array.isArray(anchors)) {
      throw new Error('anchors must be an array');
    }

    return {
      platform: platform,
      format_version: '1.0',
      anchor_count: anchors.length,
      translations: anchors.map((anchor, index) => ({
        index: index,
        ...this.translate(anchor, platform, options)
      }))
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * UTILITY FUNCTIONS
   * ═══════════════════════════════════════════════════════════════════
   */

  /**
   * Parse time string to frame number
   * @param {string} timeStr - Time in "MM:SS.ms" format
   * @param {number} fps - Frames per second
   * @returns {number} Frame number
   */
  _timeToFrame: function(timeStr, fps) {
    if (!timeStr) return 0;

    // Handle "MM:SS.ms" format
    const match = timeStr.match(/^(\d+):(\d+)\.(\d+)$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = parseInt(match[3], 10);
      const totalSeconds = minutes * 60 + seconds + ms / 1000;
      return Math.round(totalSeconds * fps);
    }

    // Handle plain seconds
    const seconds = parseFloat(timeStr);
    if (!isNaN(seconds)) {
      return Math.round(seconds * fps);
    }

    return 0;
  },

  /**
   * Calculate displacement given start/end velocity and frames
   */
  _calculateDisplacement: function(v0, v1, frames, fps) {
    const duration = frames / fps;
    // Average velocity × time
    return ((v0 + v1) / 2) * duration;
  },

  /**
   * Get appropriate easing for acceleration phase
   */
  _getAccelerationEasing: function(acceleration, baseEasing) {
    if (acceleration > 0.5) return 'ease-in';
    if (acceleration < -0.5) return 'ease-out';
    return baseEasing;
  },

  /**
   * Get appropriate easing for deceleration phase based on mass
   */
  _getDecelerationEasing: function(massMomentum, baseEasing) {
    if (!massMomentum) return baseEasing;

    // Heavy objects decelerate slowly
    if (massMomentum.estimated_mass > 5.0) return 'ease-out-slow';
    // Light objects can stop abruptly
    if (massMomentum.estimated_mass < 1.0) return 'ease-out';
    return baseEasing;
  },

  /**
   * Get system prompt describing translator capabilities
   */
  getSystemPrompt: function() {
    return `
[VAM-RGB Translator v1.8a]
Universal conversion layer for Video Generation AI platforms.

■ Supported Platforms
1. Runway GEN-3 (Motion Brush)
2. Luma Dream Machine (Keyframe)
3. Kling (ControlNet Depth)

■ Usage
Call VAMRGBTranslator.translate(anchor, platform, options)

■ Runway Output
- Motion brush stroke coordinates (start, end)
- Vector components (vx, vy)
- Intensity (0-10 scale)
- Mass-aware persistence

■ Luma Output
- Keyframe sequence with frame numbers
- Easing functions based on chaos_hint.behavior
- Anticipation and settle timing
- Secondary motion for chaos events

■ Kling Output
- ControlNet depth values (0-255)
- Z-direction (toward/away/lateral)
- Depth keyframes with mass inertia
- Combined lateral motion vectors`;
  }
};

console.log('[VAMRGBTranslator] v1.8a-translator loaded.');
