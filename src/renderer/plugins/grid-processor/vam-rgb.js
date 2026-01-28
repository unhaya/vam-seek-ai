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

    // v7.39: Frame cache for consecutive cells (reduce redundant seeks)
    // Key: timestamp (rounded to 0.1s), Value: ImageData
    this._frameCache = new Map();
    this._frameCacheMaxSize = 10;  // Keep last 10 frames
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
    const cropX = vw * this.config.cropLeft;
    const cropY = vh * this.config.cropTop;
    const cropW = vw * this.config.cropWidth;
    const cropH = vh * this.config.cropHeight;

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
