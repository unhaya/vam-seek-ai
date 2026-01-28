/**
 * VAM-RGB Encoder - Video to Causal RGB Image Converter
 *
 * VAM-RGB Plugin Architecture v1.9-encoder
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * Converts video frames to VAM-RGB encoded images:
 * - R channel: Past (T-0.5s) + High-frequency motion (friction/tremor)
 * - G channel: Present (T) + Viscosity (flow divergence)
 * - B channel: Future (T+0.5s) + Depth coefficient (δz)
 *
 * Core algorithms derived from Gemini 2.0 Flash "Anarchy Edition" spec.
 * No semantics. Only displacement vectors and F = ma.
 */

window.VAMRGBEncoder = {
  version: '1.9-encoder',
  name: 'VAM-RGB Causal Encoder',

  /**
   * Encoder configuration
   */
  config: {
    // Temporal offset in seconds
    temporalOffset: 0.5,
    // Frame window size (7frame-del)
    frameWindow: 7,
    // Channel weights
    alpha: 0.6,  // R: Red intensity change weight
    beta: 0.4,   // R: High-frequency motion weight
    gamma: 1.0,  // G: Viscosity weight
    eta: 1.0,    // B: Depth coefficient weight
    // Lucas-Kanade regularization
    lambda: 0.01,
    // Depth scaling factor (κ)
    kappa: 2.0,
    // Output resolution
    outputWidth: 256,
    outputHeight: 256
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * CORE ENCODING PIPELINE
   * ═══════════════════════════════════════════════════════════════════
   *
   * Input: Video element or frame sequence
   * Output: VAM-RGB encoded image data
   */

  /**
   * Encode a video segment to VAM-RGB image
   * @param {HTMLVideoElement} video - Source video
   * @param {number} centerTime - Center timestamp in seconds
   * @param {Object} options - Encoding options
   * @returns {ImageData} VAM-RGB encoded image
   */
  encode: function(video, centerTime, options = {}) {
    const config = { ...this.config, ...options };
    const fps = options.fps || 30;
    const frameInterval = 1 / fps;

    // Extract 7 frames centered on centerTime
    const frames = this._extractFrames(video, centerTime, config.frameWindow, frameInterval);

    if (frames.length < config.frameWindow) {
      throw new Error(`Insufficient frames: got ${frames.length}, need ${config.frameWindow}`);
    }

    // Calculate optical flow between consecutive frames
    const flows = this._computeOpticalFlows(frames);

    // Generate VAM-RGB channels
    const width = config.outputWidth;
    const height = config.outputHeight;
    const output = new ImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = this._encodePixel(x, y, frames, flows, config);
        const idx = (y * width + x) * 4;
        output.data[idx] = pixel.r;     // R: Past + Friction
        output.data[idx + 1] = pixel.g; // G: Present + Viscosity
        output.data[idx + 2] = pixel.b; // B: Future + Depth
        output.data[idx + 3] = 255;     // Alpha
      }
    }

    return output;
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * CHANNEL MAPPING (Temporal-Arousal Mapping)
   * ═══════════════════════════════════════════════════════════════════
   *
   * R(p,t) = α·Norm(|ΔI_Red|) + β·HighFreq(||v||)
   * G(p,t) = γ·Viscosity(∇·v)
   * B(p,t) = η·δz
   */

  /**
   * Encode a single pixel using VAM-RGB mapping
   */
  _encodePixel: function(x, y, frames, flows, config) {
    const centerIdx = Math.floor(frames.length / 2);
    const { alpha, beta, gamma, eta, kappa } = config;

    // Normalize coordinates to frame space
    const fx = Math.floor(x * frames[0].width / config.outputWidth);
    const fy = Math.floor(y * frames[0].height / config.outputHeight);

    // ─────────────────────────────────────────────────────────────────
    // R Channel: Past + High-frequency motion (friction/tremor)
    // R(p,t) = α·Norm(|ΔI_Red|) + β·HighFreq(||v||)
    // ─────────────────────────────────────────────────────────────────
    const pastFrame = frames[0];
    const presentFrame = frames[centerIdx];

    // Red intensity change between past and present
    const pastRed = this._getPixelValue(pastFrame, fx, fy, 0);
    const presentRed = this._getPixelValue(presentFrame, fx, fy, 0);
    const deltaRed = Math.abs(presentRed - pastRed);

    // High-frequency motion component (velocity magnitude variation)
    let highFreqMotion = 0;
    for (let i = 1; i < flows.length; i++) {
      const flow0 = flows[i - 1];
      const flow1 = flows[i];
      const v0 = this._getFlowMagnitude(flow0, fx, fy);
      const v1 = this._getFlowMagnitude(flow1, fx, fy);
      highFreqMotion += Math.abs(v1 - v0);
    }
    highFreqMotion /= (flows.length - 1);

    const r = alpha * this._normalize(deltaRed, 255) +
              beta * this._normalize(highFreqMotion, 10);

    // ─────────────────────────────────────────────────────────────────
    // G Channel: Present + Viscosity (flow divergence)
    // G(p,t) = γ·Viscosity(∇·v)
    // ─────────────────────────────────────────────────────────────────
    const presentGreen = this._getPixelValue(presentFrame, fx, fy, 1);

    // Viscosity from flow divergence (how "thick" the motion feels)
    const centerFlow = flows[Math.floor(flows.length / 2)];
    const divergence = this._computeDivergence(centerFlow, fx, fy);

    // Viscosity is inversely related to divergence magnitude
    // High divergence = low viscosity (thin fluid, fast spread)
    // Low divergence = high viscosity (thick fluid, slow spread)
    const viscosity = 1.0 / (1.0 + Math.abs(divergence) * 10);

    const g = gamma * (this._normalize(presentGreen, 255) * 0.5 +
                       viscosity * 0.5);

    // ─────────────────────────────────────────────────────────────────
    // B Channel: Future + Depth coefficient (δz)
    // B(p,t) = η·δz
    // δz ≈ κ·∫∫(∂u/∂x + ∂v/∂y)dxdy
    // ─────────────────────────────────────────────────────────────────
    const futureFrame = frames[frames.length - 1];
    const futureBlue = this._getPixelValue(futureFrame, fx, fy, 2);

    // Depth coefficient from accumulated divergence
    // div(v) > 0: approaching camera (expansion)
    // div(v) < 0: receding from camera (contraction)
    let deltaZ = 0;
    for (const flow of flows) {
      deltaZ += this._computeDivergence(flow, fx, fy);
    }
    deltaZ = kappa * deltaZ / flows.length;

    // Map deltaZ to [0, 1] range: 0.5 = no depth change
    const depthNormalized = 0.5 + deltaZ * 0.5;

    const b = eta * (this._normalize(futureBlue, 255) * 0.3 +
                     Math.max(0, Math.min(1, depthNormalized)) * 0.7);

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * OPTICAL FLOW (Lucas-Kanade with weighted regularization)
   * ═══════════════════════════════════════════════════════════════════
   *
   * E_flow = Σ W(p)[I_x·u + I_y·v + I_t]² + λ∫(||∇u||² + ||∇v||²)dΩ
   */

  /**
   * Compute optical flow between consecutive frames
   * Simplified Lucas-Kanade implementation
   */
  _computeOpticalFlows: function(frames) {
    const flows = [];

    for (let i = 0; i < frames.length - 1; i++) {
      const flow = this._lucasKanade(frames[i], frames[i + 1]);
      flows.push(flow);
    }

    return flows;
  },

  /**
   * Lucas-Kanade optical flow estimation
   * @param {ImageData} frame1 - First frame
   * @param {ImageData} frame2 - Second frame
   * @returns {Object} Flow field { u: Float32Array, v: Float32Array, width, height }
   */
  _lucasKanade: function(frame1, frame2) {
    const width = frame1.width;
    const height = frame1.height;
    const windowSize = 5;
    const halfWindow = Math.floor(windowSize / 2);

    // Convert to grayscale
    const gray1 = this._toGrayscale(frame1);
    const gray2 = this._toGrayscale(frame2);

    // Compute gradients
    const Ix = this._computeGradientX(gray1, width, height);
    const Iy = this._computeGradientY(gray1, width, height);
    const It = new Float32Array(width * height);
    for (let i = 0; i < It.length; i++) {
      It[i] = gray2[i] - gray1[i];
    }

    // Flow vectors
    const u = new Float32Array(width * height);
    const v = new Float32Array(width * height);

    // Lucas-Kanade for each pixel (simplified)
    for (let y = halfWindow; y < height - halfWindow; y++) {
      for (let x = halfWindow; x < width - halfWindow; x++) {
        let sumIxIx = 0, sumIyIy = 0, sumIxIy = 0;
        let sumIxIt = 0, sumIyIt = 0;

        // Window summation
        for (let wy = -halfWindow; wy <= halfWindow; wy++) {
          for (let wx = -halfWindow; wx <= halfWindow; wx++) {
            const idx = (y + wy) * width + (x + wx);
            const ix = Ix[idx];
            const iy = Iy[idx];
            const it = It[idx];

            sumIxIx += ix * ix;
            sumIyIy += iy * iy;
            sumIxIy += ix * iy;
            sumIxIt += ix * it;
            sumIyIt += iy * it;
          }
        }

        // Solve 2x2 system with regularization
        const lambda = this.config.lambda;
        const det = (sumIxIx + lambda) * (sumIyIy + lambda) - sumIxIy * sumIxIy;

        const idx = y * width + x;
        if (Math.abs(det) > 1e-6) {
          u[idx] = -((sumIyIy + lambda) * sumIxIt - sumIxIy * sumIyIt) / det;
          v[idx] = -(-(sumIxIy) * sumIxIt + (sumIxIx + lambda) * sumIyIt) / det;
        }
      }
    }

    return { u, v, width, height };
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * DELTA-Z ESTIMATION (Depth from Divergence)
   * ═══════════════════════════════════════════════════════════════════
   *
   * δz ≈ κ·∫∫(∂u/∂x + ∂v/∂y)dxdy
   * div(v) > 0: Expansion (approaching camera)
   * div(v) < 0: Contraction (receding from camera)
   */

  /**
   * Compute divergence of flow field at a point
   * div(v) = ∂u/∂x + ∂v/∂y
   */
  _computeDivergence: function(flow, x, y) {
    const { u, v, width, height } = flow;

    if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) {
      return 0;
    }

    const idx = y * width + x;
    const idxLeft = y * width + (x - 1);
    const idxRight = y * width + (x + 1);
    const idxUp = (y - 1) * width + x;
    const idxDown = (y + 1) * width + x;

    // Central difference approximation
    const dudx = (u[idxRight] - u[idxLeft]) / 2;
    const dvdy = (v[idxDown] - v[idxUp]) / 2;

    return dudx + dvdy;
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * 7-FRAME WINDOW WEIGHTING
   * ═══════════════════════════════════════════════════════════════════
   *
   * P_out(x,y) = Clamp(Σ ωi·Enc(I_{t+i}))
   * ωi defines the temporal weight for each frame in the 7-frame window
   */

  /**
   * Get frame weights for 7-frame window
   * Gaussian-like weighting centered on present frame
   */
  getFrameWeights: function(frameCount) {
    const weights = [];
    const center = Math.floor(frameCount / 2);
    const sigma = frameCount / 4;

    for (let i = 0; i < frameCount; i++) {
      const dist = i - center;
      const w = Math.exp(-(dist * dist) / (2 * sigma * sigma));
      weights.push(w);
    }

    // Normalize
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map(w => w / sum);
  },

  /**
   * ═══════════════════════════════════════════════════════════════════
   * UTILITY FUNCTIONS
   * ═══════════════════════════════════════════════════════════════════
   */

  /**
   * Extract frames from video at specified times
   */
  _extractFrames: function(video, centerTime, frameCount, frameInterval) {
    const frames = [];
    const startTime = centerTime - (frameCount / 2) * frameInterval;

    // This is a synchronous placeholder - actual implementation needs async canvas capture
    // For now, return empty array to indicate frames need to be captured externally
    console.warn('[VAMRGBEncoder] Frame extraction requires external capture implementation');

    return frames;
  },

  /**
   * Extract frames from pre-captured ImageData array
   */
  encodeFromFrames: function(frames, options = {}) {
    if (frames.length < 7) {
      throw new Error(`Need at least 7 frames, got ${frames.length}`);
    }

    const config = { ...this.config, ...options };

    // Use center 7 frames
    const startIdx = Math.floor((frames.length - 7) / 2);
    const selectedFrames = frames.slice(startIdx, startIdx + 7);

    // Compute optical flows
    const flows = this._computeOpticalFlows(selectedFrames);

    // Generate output
    const width = config.outputWidth;
    const height = config.outputHeight;
    const output = new ImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = this._encodePixel(x, y, selectedFrames, flows, config);
        const idx = (y * width + x) * 4;
        output.data[idx] = pixel.r;
        output.data[idx + 1] = pixel.g;
        output.data[idx + 2] = pixel.b;
        output.data[idx + 3] = 255;
      }
    }

    return output;
  },

  /**
   * Get pixel value from ImageData
   */
  _getPixelValue: function(imageData, x, y, channel) {
    const idx = (y * imageData.width + x) * 4 + channel;
    return imageData.data[idx] || 0;
  },

  /**
   * Get flow magnitude at a point
   */
  _getFlowMagnitude: function(flow, x, y) {
    const idx = y * flow.width + x;
    const u = flow.u[idx] || 0;
    const v = flow.v[idx] || 0;
    return Math.sqrt(u * u + v * v);
  },

  /**
   * Convert ImageData to grayscale array
   */
  _toGrayscale: function(imageData) {
    const gray = new Float32Array(imageData.width * imageData.height);
    for (let i = 0; i < gray.length; i++) {
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return gray;
  },

  /**
   * Compute X gradient using Sobel operator
   */
  _computeGradientX: function(gray, width, height) {
    const Ix = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        Ix[idx] = (gray[idx + 1] - gray[idx - 1]) / 2;
      }
    }
    return Ix;
  },

  /**
   * Compute Y gradient using Sobel operator
   */
  _computeGradientY: function(gray, width, height) {
    const Iy = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        Iy[idx] = (gray[(y + 1) * width + x] - gray[(y - 1) * width + x]) / 2;
      }
    }
    return Iy;
  },

  /**
   * Normalize value to [0, 1]
   */
  _normalize: function(value, max) {
    return Math.max(0, Math.min(1, value / max));
  },

  /**
   * Get system prompt for encoder mode
   */
  getSystemPrompt: function() {
    return `
[VAM-RGB Encoder v1.9]
Video to Causal RGB Image Converter.

■ Channel Mapping
R(p,t) = α·Norm(|ΔI_Red|) + β·HighFreq(||v||)
G(p,t) = γ·Viscosity(∇·v)
B(p,t) = η·δz

■ Optical Flow (Lucas-Kanade)
E_flow = Σ W(p)[I_x·u + I_y·v + I_t]² + λ∫(||∇u||² + ||∇v||²)dΩ

■ Depth Estimation
δz ≈ κ·∫∫(∂u/∂x + ∂v/∂y)dxdy
div(v) > 0 → approaching camera
div(v) < 0 → receding from camera

■ 7-Frame Window
P_out(x,y) = Clamp(Σ ωi·Enc(I_{t+i}))

■ Usage
const encoder = window.VAMRGBEncoder;
const output = encoder.encodeFromFrames(frames, options);

■ No Semantics
Only displacement vectors. F = ma.`;
  }
};

console.log('[VAMRGBEncoder] v1.9-encoder loaded.');
