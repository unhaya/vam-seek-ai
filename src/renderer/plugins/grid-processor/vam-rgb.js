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
 * v3.1 Changes (G-Nudge):
 * - G channel carries gradient field encoding Present color differences
 * - 8×8 block gradient: horizontal = R-G, vertical = B-G
 * - Center preserved (nudge=0), DC unchanged
 *
 * v3.2 Changes (R/B Mosaic):
 * - R/B channels store 8×8 block averages instead of per-pixel values
 * - Each 8×8 area = uniform value (Past/Future average intensity)
 * - "Send what AI looks at, at 10× size" — temporal signal clarity
 *
 * Encoding:
 * - R channel = T-0.5s (Past) - 8×8 block average (ψ3.2 mosaic)
 * - G channel = T0 (Present) - per-pixel + gradient nudge (ψ3.1)
 * - B channel = T+0.5s (Future) - 8×8 block average (ψ3.2 mosaic)
 *
 * Motion appears as block-level R/B differences (temporal signal).
 * G-Nudge encodes Present color hints as directional gradients within 8×8 blocks.
 * AI interprets block R/B differences as motion, gradients as color recovery hints.
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
    return 'VAM-RGB v3.2';
  }

  get version() {
    return '3.2';
  }

  /**
   * Format marker for self-describing data
   * Tells AI this is temporal-encoded with G-Nudge + R/B Mosaic
   */
  get formatMarker() {
    return 'Ψ³·²';
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
    const BLOCK = 8;
    const SCALE = 0.15;
    const HALF = (BLOCK - 1) / 2;  // 3.5 for 8×8

    const pastData = this._bufferPast.getContext('2d')
      .getImageData(0, 0, cellWidth, cellHeight);
    const presentData = this._bufferPresent.getContext('2d')
      .getImageData(0, 0, cellWidth, cellHeight);
    const futureData = this._bufferFuture.getContext('2d')
      .getImageData(0, 0, cellWidth, cellHeight);

    const outputData = this._outputCtx.createImageData(cellWidth, cellHeight);
    const out = outputData.data;
    const past = pastData.data;
    const present = presentData.data;
    const future = futureData.data;

    // ψ3.2 Pass 1: G-Nudge color diffs + R/B Mosaic block averages
    const blocksX = Math.ceil(cellWidth / BLOCK);
    const blocksY = Math.ceil(cellHeight / BLOCK);
    const avgRG = new Float32Array(blocksX * blocksY);
    const avgBG = new Float32Array(blocksX * blocksY);
    const blockR = new Uint8Array(blocksX * blocksY);
    const blockB = new Uint8Array(blocksX * blocksY);

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        let sumRG = 0, sumBG = 0, count = 0;
        let sumPastR = 0, sumFutureB = 0;
        const yEnd = Math.min((by + 1) * BLOCK, cellHeight);
        const xEnd = Math.min((bx + 1) * BLOCK, cellWidth);

        for (let y = by * BLOCK; y < yEnd; y++) {
          for (let x = bx * BLOCK; x < xEnd; x++) {
            const i = (y * cellWidth + x) * 4;
            sumRG += present[i] - present[i + 1];      // R - G (G-Nudge)
            sumBG += present[i + 2] - present[i + 1];  // B - G (G-Nudge)
            sumPastR += past[i];                        // Past R (mosaic)
            sumFutureB += future[i + 2];                // Future B (mosaic)
            count++;
          }
        }

        const idx = by * blocksX + bx;
        avgRG[idx] = sumRG / count;
        avgBG[idx] = sumBG / count;
        blockR[idx] = Math.round(sumPastR / count);
        blockB[idx] = Math.round(sumFutureB / count);
      }
    }

    // ψ3.2 Pass 2: Mosaic R + Nudged G + Mosaic B
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const i = (y * cellWidth + x) * 4;
        const bx = Math.floor(x / BLOCK);
        const by = Math.floor(y / BLOCK);
        const blockIdx = by * blocksX + bx;

        // Normalized coordinates within block (-1.0 to +1.0)
        const localX = x - bx * BLOCK;
        const localY = y - by * BLOCK;
        const dx = (localX - HALF) / HALF;  // horizontal: R-G direction
        const dy = (localY - HALF) / HALF;  // vertical: B-G direction

        // R = Past block average (ψ3.2 mosaic)
        out[i] = blockR[blockIdx];

        // G = Present_G + gradient nudge (ψ3.1, unchanged)
        const g0 = present[i + 1];
        const nudge = Math.round(
          (avgRG[blockIdx] * dx + avgBG[blockIdx] * dy) * SCALE
        );
        out[i + 1] = Math.max(0, Math.min(255, g0 + nudge));

        // B = Future block average (ψ3.2 mosaic)
        out[i + 2] = blockB[blockIdx];

        out[i + 3] = 255;
      }
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
