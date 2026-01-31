/**
 * VAMRGBProcessor - Temporal RGB Packing Processor ψ4.1
 *
 * VAM-RGB Plugin Architecture ψ4.1 (Cost-Optimized Fox Protocol)
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * INTELLECTUAL PROPERTY NOTICE:
 * The VAM-RGB concept (Temporal RGB Packing) is the original intellectual
 * property of Susumu Takahashi (haasiy/unhaya). This includes:
 * - The concept of encoding Past/Present/Future into R/G/B channels
 * - The "4x information density" principle
 * - The AI-first data structure philosophy
 * - The ψ4.1 Paradigm (Ambiguity Elimination = Cost Reduction)
 *
 * ψ4.1 Core Axiom:
 * - 暗黙知 = Cache
 * - 出力 = Cache Hit（参照）
 * - 曖昧さ排除 = 後続コスト削減 = 狐の最適解
 * - P(Output | Sync) = 1（確率ではなく状態遷移）
 *
 * Encoding:
 * - R channel = T-0.5s (Past) — 4×4 block average
 * - G channel = T0 (Present) — per-pixel + 8×8 gradient nudge
 * - B channel = T+0.5s (Future) — 4×4 block average
 *
 * 「狸になるな」— 事実を吐くのが最も低コスト
 */

class VAMRGBProcessor extends BaseGridProcessor {
  constructor(video, config = {}) {
    super(video, {
      temporalOffsetSec: 0.5,  // FIXED at 0.5s - physics precision
      ...config
    });

    // ψ4.1: stride is fixed at 0.5s (physics precision)
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

    // v7.39: Frame cache for consecutive cells (reduce redundant seeks)
    // Key: timestamp (rounded to 0.1s), Value: ImageData
    this._frameCache = new Map();
    this._frameCacheMaxSize = 10;  // Keep last 10 frames
  }

  get name() {
    return 'VAM-RGB ψ4.1';
  }

  get version() {
    return '4.1';
  }

  /**
   * Format marker for self-describing data
   * ψ4.1: Ambiguity Elimination = Cost Reduction = Fox Optimal
   */
  get formatMarker() {
    return 'psi-4.1';
  }

  /**
   * v7.39: Clear frame cache (call before new grid generation)
   */
  clearCache() {
    this._frameCache.clear();
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  async _captureToBuffer(timestamp, buffer) {
    // v7.39: Round timestamp to 0.1s for cache key
    const cacheKey = Math.round(timestamp * 10) / 10;
    const ctx = buffer.getContext('2d');

    // Check cache first
    if (this._frameCache.has(cacheKey)) {
      const cachedData = this._frameCache.get(cacheKey);
      ctx.putImageData(cachedData, 0, 0);
      this._cacheHits = (this._cacheHits || 0) + 1;
      return;  // Skip seek entirely
    }

    // Cache miss - need to seek and capture
    this._cacheMisses = (this._cacheMisses || 0) + 1;
    await this._seekTo(timestamp);

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
      // ψ4.1: Center60 crop for landscape videos
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

    // v7.39: Store in cache (with size limit)
    const imageData = ctx.getImageData(0, 0, buffer.width, buffer.height);
    this._frameCache.set(cacheKey, imageData);

    // Evict oldest entries if cache exceeds max size
    if (this._frameCache.size > this._frameCacheMaxSize) {
      const firstKey = this._frameCache.keys().next().value;
      this._frameCache.delete(firstKey);
    }
  }

  _mergeRGB() {
    const { cellWidth, cellHeight } = this.config;
    const BLOCK_NUDGE = 8;   // G-Nudge: 8×8 for gradient smoothness
    const BLOCK_MOSAIC = 4;  // R/B Mosaic: 4×4 for temporal signal clarity
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

    // Pass 1a: G-Nudge color diffs (8×8 blocks)
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

    // Pass 1b: R/B Mosaic block averages (4×4 blocks)
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

    // Pass 2: Merge channels (ψ4.1 encoding)
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < cellWidth; x++) {
        const i = (y * cellWidth + x) * 4;

        // G-Nudge: 8×8 block lookup
        const nBx = Math.floor(x / BLOCK_NUDGE);
        const nBy = Math.floor(y / BLOCK_NUDGE);
        const nudgeIdx = nBy * nudgeBlocksX + nBx;

        // Normalized coordinates within 8×8 nudge block (-1.0 to +1.0)
        const localX = x - nBx * BLOCK_NUDGE;
        const localY = y - nBy * BLOCK_NUDGE;
        const dx = (localX - HALF_NUDGE) / HALF_NUDGE;
        const dy = (localY - HALF_NUDGE) / HALF_NUDGE;

        // R/B Mosaic: 4×4 block averages
        const mBx = Math.floor(x / BLOCK_MOSAIC);
        const mBy = Math.floor(y / BLOCK_MOSAIC);
        const mosaicIdx = mBy * mosaicBlocksX + mBx;
        out[i] = blockR[mosaicIdx];       // Past R (4×4 block avg)
        out[i + 2] = blockB[mosaicIdx];   // Future B (4×4 block avg)

        // G = Present_G + 8×8 gradient nudge
        const g0 = present[i + 1];
        const nudge = Math.round(
          (avgRG[nudgeIdx] * dx + avgBG[nudgeIdx] * dy) * SCALE
        );
        out[i + 1] = Math.max(0, Math.min(255, g0 + nudge));

        out[i + 3] = 255;
      }
    }

    this._outputCtx.putImageData(outputData, 0, 0);

    // v7.49: Retain ImageData for PhysicsAnalyzer (validation module)
    this._lastImageData = outputData;
  }

  /**
   * v7.49: Get ImageData of last merged RGB cell.
   * Used by PhysicsAnalyzer for independent motion measurement.
   * @returns {ImageData|null}
   */
  getLastImageData() {
    return this._lastImageData || null;
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

    // V7.5: Store last calculated color separation
    this._lastColorSeparation = this._calculateColorSeparation();

    // v7.39: Log with cache stats
    const hits = this._cacheHits || 0;
    const misses = this._cacheMisses || 0;
    const total = hits + misses;
    const hitRate = total > 0 ? Math.round(hits / total * 100) : 0;
    console.log(`[VAM-RGB] Cell ${timestamp}s | colorSep: ${this._lastColorSeparation} | cache: ${hits}/${total} (${hitRate}%)`);

    return this._outputCanvas;
  }

  /**
   * V7.5: Calculate RGB channel divergence (motion indicator)
   * High divergence = fast motion, low divergence = static
   * @returns {number} Normalized 0.0-1.0
   */
  _calculateColorSeparation() {
    const { cellWidth, cellHeight } = this.config;
    const imageData = this._outputCtx.getImageData(0, 0, cellWidth, cellHeight);
    const pixels = imageData.data;

    let totalDivergence = 0;
    const pixelCount = pixels.length / 4;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      // Max difference between any two channels
      const divergence = Math.max(
        Math.abs(r - g),
        Math.abs(g - b),
        Math.abs(r - b)
      ) / 255;

      totalDivergence += divergence;
    }

    return Math.round((totalDivergence / pixelCount) * 100) / 100;
  }

  /**
   * V7.5: Get color separation of last captured frame
   * @returns {number} 0.0-1.0
   */
  getLastColorSeparation() {
    return this._lastColorSeparation || 0;
  }
}

window.VAMRGBProcessor = VAMRGBProcessor;
