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
 * - R/B channels store 4×4 block averages instead of per-pixel values
 * - G-Nudge stays at 8×8 for gradient smoothness
 * - R/B Mosaic uses 4×4 for finer temporal resolution (64×64 vs 32×32)
 * - "Send what AI looks at, at 10× size" — temporal signal clarity
 *
 * Encoding:
 * - R channel = T-0.5s (Past) - 4×4 block average (ψ3.2 mosaic)
 * - G channel = T0 (Present) - per-pixel + 8×8 gradient nudge (ψ3.1)
 * - B channel = T+0.5s (Future) - 4×4 block average (ψ3.2 mosaic)
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

    // ψ3.2: Center60 crop for landscape videos (cut 20% from each side)
    // Vertical/square videos: no crop (full frame)
    let cropLeft = this.config.cropLeft || 0;
    let cropWidth = this.config.cropWidth || 1;

    if (vw > vh) {
      // Landscape: center 60%
      cropLeft = 0.2;
      cropWidth = 0.6;
    }

    const cropX = vw * cropLeft;
    const cropY = vh * (this.config.cropTop || 0);
    const cropW = vw * cropWidth;
    const cropH = vh * (this.config.cropHeight || 1);

    ctx.drawImage(
      this.video,
      cropX, cropY, cropW, cropH,
      0, 0, buffer.width, buffer.height
    );
  }

  _mergeRGB() {
    const { cellWidth, cellHeight } = this.config;
    const BLOCK_NUDGE = 8;   // G-Nudge: 8×8 for gradient smoothness
    const BLOCK_MOSAIC = 4;  // R/B Mosaic: 4×4 for finer temporal resolution
    const SCALE = 0.15;
    const HALF_NUDGE = (BLOCK_NUDGE - 1) / 2;  // 3.5 for 8×8

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

    // ψ3.2 Pass 1a: G-Nudge color diffs (8×8 blocks)
    const nudgeBlocksX = Math.ceil(cellWidth / BLOCK_NUDGE);
    const nudgeBlocksY = Math.ceil(cellHeight / BLOCK_NUDGE);
    const avgRG = new Float32Array(nudgeBlocksX * nudgeBlocksY);
    const avgBG = new Float32Array(nudgeBlocksX * nudgeBlocksY);

    for (let by = 0; by < nudgeBlocksY; by++) {
      for (let bx = 0; bx < nudgeBlocksX; bx++) {
        let sumRG = 0, sumBG = 0, count = 0;
        const yEnd = Math.min((by + 1) * BLOCK_NUDGE, cellHeight);
        const xEnd = Math.min((bx + 1) * BLOCK_NUDGE, cellWidth);

        for (let y = by * BLOCK_NUDGE; y < yEnd; y++) {
          for (let x = bx * BLOCK_NUDGE; x < xEnd; x++) {
            const i = (y * cellWidth + x) * 4;
            sumRG += present[i] - present[i + 1];      // R - G
            sumBG += present[i + 2] - present[i + 1];  // B - G
            count++;
          }
        }

        const idx = by * nudgeBlocksX + bx;
        avgRG[idx] = sumRG / count;
        avgBG[idx] = sumBG / count;
      }
    }

    // ψ3.2 Pass 1b: R/B Mosaic block averages (4×4 blocks)
    const mosaicBlocksX = Math.ceil(cellWidth / BLOCK_MOSAIC);
    const mosaicBlocksY = Math.ceil(cellHeight / BLOCK_MOSAIC);
    const blockR = new Uint8Array(mosaicBlocksX * mosaicBlocksY);
    const blockB = new Uint8Array(mosaicBlocksX * mosaicBlocksY);

    for (let by = 0; by < mosaicBlocksY; by++) {
      for (let bx = 0; bx < mosaicBlocksX; bx++) {
        let sumPastR = 0, sumFutureB = 0, count = 0;
        const yEnd = Math.min((by + 1) * BLOCK_MOSAIC, cellHeight);
        const xEnd = Math.min((bx + 1) * BLOCK_MOSAIC, cellWidth);

        for (let y = by * BLOCK_MOSAIC; y < yEnd; y++) {
          for (let x = bx * BLOCK_MOSAIC; x < xEnd; x++) {
            const i = (y * cellWidth + x) * 4;
            sumPastR += past[i];           // Past R
            sumFutureB += future[i + 2];   // Future B
            count++;
          }
        }

        const idx = by * mosaicBlocksX + bx;
        blockR[idx] = Math.round(sumPastR / count);
        blockB[idx] = Math.round(sumFutureB / count);
      }
    }

    // ψ3.2 Pass 2: Mosaic R (4×4) + Nudged G (8×8) + Mosaic B (4×4)
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const i = (y * cellWidth + x) * 4;

        // R/B: 4×4 mosaic lookup
        const mBx = Math.floor(x / BLOCK_MOSAIC);
        const mBy = Math.floor(y / BLOCK_MOSAIC);
        const mosaicIdx = mBy * mosaicBlocksX + mBx;

        // G-Nudge: 8×8 block lookup
        const nBx = Math.floor(x / BLOCK_NUDGE);
        const nBy = Math.floor(y / BLOCK_NUDGE);
        const nudgeIdx = nBy * nudgeBlocksX + nBx;

        // Normalized coordinates within 8×8 nudge block (-1.0 to +1.0)
        const localX = x - nBx * BLOCK_NUDGE;
        const localY = y - nBy * BLOCK_NUDGE;
        const dx = (localX - HALF_NUDGE) / HALF_NUDGE;
        const dy = (localY - HALF_NUDGE) / HALF_NUDGE;

        // R = Past 4×4 block average (ψ3.2 mosaic)
        out[i] = blockR[mosaicIdx];

        // G = Present_G + 8×8 gradient nudge (ψ3.1)
        const g0 = present[i + 1];
        const nudge = Math.round(
          (avgRG[nudgeIdx] * dx + avgBG[nudgeIdx] * dy) * SCALE
        );
        out[i + 1] = Math.max(0, Math.min(255, g0 + nudge));

        // B = Future 4×4 block average (ψ3.2 mosaic)
        out[i + 2] = blockB[mosaicIdx];

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
