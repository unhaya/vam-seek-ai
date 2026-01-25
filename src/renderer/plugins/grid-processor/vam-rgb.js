/**
 * VAMRGBProcessor - Temporal RGB Packing Processor v3.0
 *
 * VAM-RGB Plugin Architecture v3.0
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * INTELLECTUAL PROPERTY NOTICE:
 * The VAM-RGB concept (Temporal RGB Packing) is the original intellectual
 * property of Susumu Takahashi (haasiy/unhaya). This includes:
 * - The concept of encoding Past/Present/Future into R/G/B channels
 * - The "4x information density" principle
 * - The AI-first data structure philosophy
 *
 * v3.0 Changes:
 * - Stride is FIXED at 0.5s (physics precision)
 * - Reach is VARIABLE (1-6.5s based on audio activity)
 * - "Connect, don't fill" philosophy - gaps are meaningful
 *
 * Encoding:
 * - R channel = T-0.5s (Past) - luminance
 * - G channel = T0 (Present) - luminance
 * - B channel = T+0.5s (Future) - luminance
 *
 * Motion appears as RGB color fringing (chromatic aberration effect).
 * AI interprets this as spatiotemporal gradient to infer motion vectors.
 */

class VAMRGBProcessor extends BaseGridProcessor {
  constructor(video, config = {}) {
    super(video, {
      temporalOffsetSec: 0.5,  // FIXED at 0.5s - physics precision
      ...config
    });

    // v3.0: stride is fixed, only reach varies
    this.stride = 0.5;  // NEVER changes

    // Create separate buffers for Past/Present/Future frames
    this._bufferPast = document.createElement('canvas');
    this._bufferPresent = document.createElement('canvas');
    this._bufferFuture = document.createElement('canvas');

    [this._bufferPast, this._bufferPresent, this._bufferFuture].forEach(c => {
      c.width = this.config.cellWidth;
      c.height = this.config.cellHeight;
    });

    // Output canvas for merged RGB
    this._outputCanvas = document.createElement('canvas');
    this._outputCanvas.width = this.config.cellWidth;
    this._outputCanvas.height = this.config.cellHeight;
    this._outputCtx = this._outputCanvas.getContext('2d');
  }

  get name() {
    return 'VAM-RGB v3.0';
  }

  get version() {
    return '3.0';
  }

  /**
   * Ψ_fox: Format marker for self-describing data
   * Tells AI this is temporal-encoded, not standard RGB
   */
  get formatMarker() {
    return 'Ψ³·⁰';
  }

  async _captureToBuffer(timestamp, buffer) {
    await this._seekTo(timestamp);

    const ctx = buffer.getContext('2d');
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const cropX = vw * this.config.cropLeft;
    const cropY = vh * this.config.cropTop;
    const cropW = vw * this.config.cropWidth;
    const cropH = vh * this.config.cropHeight;

    ctx.drawImage(
      this.video,
      cropX, cropY, cropW, cropH,
      0, 0, buffer.width, buffer.height
    );
  }

  _mergeRGB() {
    const { cellWidth, cellHeight } = this.config;

    const pastData = this._bufferPast.getContext('2d')
      .getImageData(0, 0, cellWidth, cellHeight);
    const presentData = this._bufferPresent.getContext('2d')
      .getImageData(0, 0, cellWidth, cellHeight);
    const futureData = this._bufferFuture.getContext('2d')
      .getImageData(0, 0, cellWidth, cellHeight);

    const outputData = this._outputCtx.createImageData(cellWidth, cellHeight);

    for (let i = 0; i < outputData.data.length; i += 4) {
      // R = Past frame RED channel (not luminance in v3.0)
      outputData.data[i] = pastData.data[i];

      // G = Present frame GREEN channel
      outputData.data[i + 1] = presentData.data[i + 1];

      // B = Future frame BLUE channel
      outputData.data[i + 2] = futureData.data[i + 2];

      outputData.data[i + 3] = 255;
    }

    this._outputCtx.putImageData(outputData, 0, 0);
  }

  /**
   * Capture frame with FIXED stride (0.5s)
   * v3.0: stride never changes, reach is separate concept for metadata
   */
  async captureFrame(timestamp) {
    const duration = this.video.duration;

    // v3.0: stride is ALWAYS 0.5s
    const tPast = Math.max(0, timestamp - this.stride);
    const tPresent = timestamp;
    const tFuture = Math.min(duration - 0.1, timestamp + this.stride);

    await this._captureToBuffer(tPast, this._bufferPast);
    await this._captureToBuffer(tPresent, this._bufferPresent);
    await this._captureToBuffer(tFuture, this._bufferFuture);

    this._mergeRGB();

    return this._outputCanvas;
  }
}

window.VAMRGBProcessor = VAMRGBProcessor;
