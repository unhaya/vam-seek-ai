/**
 * VAMRGBProcessor - Temporal RGB Packing Processor ψ3.5
 *
 * VAM-RGB Plugin Architecture ψ3.5 (Pure Temporal)
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * INTELLECTUAL PROPERTY NOTICE:
 * The VAM-RGB concept (Temporal RGB Packing) is the original intellectual
 * property of Susumu Takahashi (haasiy/unhaya). This includes:
 * - The concept of encoding Past/Present/Future into R/G/B channels
 * - The "4x information density" principle
 * - The AI-first data structure philosophy
 *
 * ψ3.5 Pure Temporal:
 * - All channels use 4×4 block averages for maximum clarity
 * - No G-Nudge (color recovery deferred to future Thaw feature)
 * - Pure temporal signal: Past/Present/Future luminance only
 *
 * Encoding:
 * - R channel = T-0.5s (Past) — 4×4 block average
 * - G channel = T0 (Present) — 4×4 block average
 * - B channel = T+0.5s (Future) — 4×4 block average
 *
 * 「信号は残ったものであり、足したものではない」
 */

class VAMRGBProcessor extends BaseGridProcessor {
  constructor(video, config = {}) {
    super(video, {
      temporalOffsetSec: 0.5,  // FIXED at 0.5s - physics precision
      ...config
    });

    // ψ3.3: stride is fixed at 0.5s
    this.stride = 0.5;

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
    return 'VAM-RGB ψ3.5';
  }

  get version() {
    return '3.5';
  }

  /**
   * Format marker for self-describing data
   * ψ3.5 Pure Temporal: All channels 4×4 block average
   */
  get formatMarker() {
    return 'Ψ³·⁵';
  }

  async _captureToBuffer(timestamp, buffer) {
    await this._seekTo(timestamp);

    const ctx = buffer.getContext('2d');
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;

    // DEBUG: Log video dimensions to diagnose crop behavior
    if (!this._dimensionsLogged) {
      console.log(`[VAMRGBProcessor] Video dimensions: ${vw}x${vh} (${vw > vh ? 'landscape' : 'portrait/square'})`);
      this._dimensionsLogged = true;
    }

    // ψ3.2: Center60 crop for landscape videos (cut 20% from each side)
    // Vertical/square videos: no crop (full frame)
    let cropLeft = this.config.cropLeft || 0;
    let cropWidth = this.config.cropWidth || 1;

    // Default: use config values for portrait/square
    let cropTop = this.config.cropTop || 0;
    let cropHeight = this.config.cropHeight || 1;

    if (vw > vh) {
      // ψ3.4: Center60 crop for landscape videos
      // Cut 20% from each side, keep center 60%
      cropLeft = 0.2;
      cropWidth = 0.6;
      cropTop = 0;
      cropHeight = 1;
    }
    const cropX = vw * cropLeft;
    const cropY = vh * cropTop;
    const cropW = vw * cropWidth;
    const cropH = vh * cropHeight;

    // DEBUG: Log crop parameters on first capture
    if (!this._cropLogged) {
      console.log(`[VAMRGBProcessor] Crop: left=${cropLeft} top=${cropTop} width=${cropWidth} height=${cropHeight}`);
      console.log(`[VAMRGBProcessor] Crop px: x=${cropX} y=${cropY} w=${cropW} h=${cropH} → cell ${buffer.width}x${buffer.height}`);
      this._cropLogged = true;
    }

    ctx.drawImage(
      this.video,
      cropX, cropY, cropW, cropH,
      0, 0, buffer.width, buffer.height
    );
  }

  _mergeRGB() {
    const { cellWidth, cellHeight } = this.config;
    const BLOCK = 4;  // ψ3.5: All channels use 4×4 block average

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

    // Pass 1: Compute 4×4 block averages for all channels
    const blocksX = Math.ceil(cellWidth / BLOCK);
    const blocksY = Math.ceil(cellHeight / BLOCK);
    const blockR = new Uint8Array(blocksX * blocksY);  // Past
    const blockG = new Uint8Array(blocksX * blocksY);  // Present
    const blockB = new Uint8Array(blocksX * blocksY);  // Future

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        let sumPastR = 0, sumPresentG = 0, sumFutureB = 0, count = 0;
        const yEnd = Math.min((by + 1) * BLOCK, cellHeight);
        const xEnd = Math.min((bx + 1) * BLOCK, cellWidth);

        for (let y = by * BLOCK; y < yEnd; y++) {
          for (let x = bx * BLOCK; x < xEnd; x++) {
            const i = (y * cellWidth + x) * 4;
            sumPastR += past[i];           // Past R (luminance proxy)
            sumPresentG += present[i + 1]; // Present G (luminance)
            sumFutureB += future[i + 2];   // Future B (luminance proxy)
            count++;
          }
        }

        const idx = by * blocksX + bx;
        blockR[idx] = Math.round(sumPastR / count);
        blockG[idx] = Math.round(sumPresentG / count);
        blockB[idx] = Math.round(sumFutureB / count);
      }
    }

    // Pass 2: Write 4×4 mosaic pattern (ψ3.5 Pure Temporal)
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const i = (y * cellWidth + x) * 4;
        const bx = Math.floor(x / BLOCK);
        const by = Math.floor(y / BLOCK);
        const idx = by * blocksX + bx;

        out[i] = blockR[idx];      // Past (4×4 block avg)
        out[i + 1] = blockG[idx];  // Present (4×4 block avg)
        out[i + 2] = blockB[idx];  // Future (4×4 block avg)
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
