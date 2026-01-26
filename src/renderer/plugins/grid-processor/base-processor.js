/**
 * BaseGridProcessor - Grid Processor Plugin Base Class
 *
 * VAM-RGB Plugin Architecture v1.0
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 *
 * All grid processors must extend this class.
 */

class BaseGridProcessor {
  constructor(video, config = {}) {
    this.video = video;

    // Default configuration (V7.30 - optimized for Gemini 3072px limit)
    // Grid: 8 cols × 375px + 2px gaps = 3014px, 14 rows × 211px + 2px gaps = 2980px
    this.config = {
      columns: 8,
      cellWidth: 375,
      cellHeight: 211,
      cellGap: 2,           // v7.30: 2px black line between cells for AI clarity
      maxCellsPerImage: 112,
      secondsPerCell: 15,
      jpegQuality: 0.85,
      cropLeft: 0.15,       // V7.1復元: 左右15%ずつカット
      cropTop: 0.05,
      cropWidth: 0.70,      // V7.1復元: 横70%維持
      cropHeight: 0.90,
      fontSize: 31,         // v7.30: 1.3x larger (was 24) for better timestamp visibility
      ...config
    };

    // Reusable frame canvas
    this._frameCanvas = document.createElement('canvas');
    this._frameCanvas.width = this.config.cellWidth;
    this._frameCanvas.height = this.config.cellHeight;
    this._frameCtx = this._frameCanvas.getContext('2d');
  }

  get name() {
    return 'BaseProcessor';
  }

  /**
   * Format marker for self-describing data (Ψ_fox concept)
   * Override in subclasses to identify the encoding format
   * @returns {string|null} Marker text or null for no marker
   */
  get formatMarker() {
    return null;
  }

  async captureFrame(timestamp) {
    throw new Error('captureFrame() must be implemented by subclass');
  }

  async _seekTo(timestamp) {
    return new Promise(resolve => {
      this.video.currentTime = timestamp;
      const onSeeked = () => {
        this.video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      this.video.addEventListener('seeked', onSeeked);
    });
  }

  async _captureRawFrame(timestamp) {
    await this._seekTo(timestamp);

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const cropX = vw * this.config.cropLeft;
    const cropY = vh * this.config.cropTop;
    const cropW = vw * this.config.cropWidth;
    const cropH = vh * this.config.cropHeight;

    this._frameCtx.drawImage(
      this.video,
      cropX, cropY, cropW, cropH,
      0, 0, this.config.cellWidth, this.config.cellHeight
    );

    return this._frameCanvas;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  _drawTimestamp(ctx, x, y, timestamp) {
    const { fontSize } = this.config;
    const timeLabel = this._formatTime(timestamp);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.ceil(fontSize / 5);
    ctx.strokeText(timeLabel, x + 3, y + this.config.cellHeight - 4);
    ctx.fillStyle = '#000';
    ctx.fillText(timeLabel, x + 3, y + this.config.cellHeight - 4);
  }

  /**
   * Draw format marker in top-left corner (Ψ_fox: self-describing data)
   */
  _drawFormatMarker(ctx) {
    const marker = this.formatMarker;
    if (!marker) return;

    const fontSize = Math.max(20, Math.floor(this.config.fontSize * 0.8));
    const padding = 6;

    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.ceil(fontSize / 4);
    ctx.strokeText(marker, padding, fontSize + padding);
    ctx.fillStyle = '#000';
    ctx.fillText(marker, padding, fontSize + padding);
  }

  async generateGrid() {
    if (!this.video.duration || this.video.readyState < 2) {
      return null;
    }

    const originalTime = this.video.currentTime;
    const wasPlaying = !this.video.paused;
    if (wasPlaying) this.video.pause();

    try {
      const { columns, cellWidth, cellHeight, cellGap, maxCellsPerImage, secondsPerCell, jpegQuality } = this.config;
      const duration = this.video.duration;

      const totalCells = Math.ceil(duration / secondsPerCell);
      const imageCount = Math.ceil(totalCells / maxCellsPerImage);
      const gridImages = [];
      const timestamps = [];

      for (let imgIdx = 0; imgIdx < imageCount; imgIdx++) {
        const startCell = imgIdx * maxCellsPerImage;
        const endCell = Math.min(startCell + maxCellsPerImage, totalCells);
        const cellsInThisImage = endCell - startCell;
        const rowsInThisImage = Math.ceil(cellsInThisImage / columns);

        // v7.30: Include gap in grid size calculation
        const gridCanvas = document.createElement('canvas');
        gridCanvas.width = columns * cellWidth + (columns - 1) * cellGap;
        gridCanvas.height = rowsInThisImage * cellHeight + (rowsInThisImage - 1) * cellGap;
        const ctx = gridCanvas.getContext('2d');

        // Black background (gaps will remain black)
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

        for (let cellIdx = startCell; cellIdx < endCell; cellIdx++) {
          const timestamp = cellIdx * secondsPerCell;
          if (timestamp >= duration) break;

          const localIdx = cellIdx - startCell;
          const col = localIdx % columns;
          const row = Math.floor(localIdx / columns);
          // v7.30: Account for gap in position calculation
          const x = col * (cellWidth + cellGap);
          const y = row * (cellHeight + cellGap);

          const frame = await this.captureFrame(timestamp);
          ctx.drawImage(frame, x, y);
          this._drawTimestamp(ctx, x, y, timestamp);

          timestamps.push(this._formatTime(timestamp));
        }

        // Ψ_fox: Draw format marker for self-describing data
        this._drawFormatMarker(ctx);

        gridImages.push(gridCanvas.toDataURL('image/jpeg', jpegQuality).split(',')[1]);
      }

      return {
        gridImages: gridImages,
        base64: gridImages[0] || null,
        columns: columns,
        rows: Math.ceil(totalCells / columns),
        secondsPerCell: secondsPerCell,
        totalCells: totalCells,
        imageCount: imageCount,
        timestampList: timestamps,
        processorName: this.name
      };

    } finally {
      this.video.currentTime = originalTime;
      if (wasPlaying) this.video.play();
    }
  }
}

// Browser export only (no require/module.exports in browser context)
window.BaseGridProcessor = BaseGridProcessor;
