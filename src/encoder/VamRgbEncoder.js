/**
 * VamRgbEncoder - VAM-RGB v3.2
 *
 * Encodes video frames into VAM-RGB format using sharp (fast, no native build).
 * Stride is FIXED at 0.5s for physics precision.
 *
 * R(x,y) = avg(Past_R per 4×4 block)  ← Past mosaic (ψ3.2)
 * G(x,y) = Frame(T) + G-Nudge gradient  ← Present + color hints (ψ3.1)
 * B(x,y) = avg(Future_B per 4×4 block)  ← Future mosaic (ψ3.2)
 *
 * G-Nudge (ψ3.1): 8×8 block gradient field encodes R-G and B-G color
 * differences as horizontal and vertical brightness gradients.
 * R/B Mosaic (ψ3.2): R/B channels store 4×4 block averages for
 * temporal signal clarity — finer resolution (64×64 vs 32×32).
 */

const { execSync } = require('child_process');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');

class VamRgbEncoder {

  constructor(config = {}) {
    this.outputSize = config.outputSize || { width: 256, height: 256 };
    this.stride = 0.5;  // FIXED - physics precision, never changes
    this.tempDir = config.tempDir || path.join(os.tmpdir(), 'vamrgb-encoder');
  }

  /**
   * Extract a single frame from video at specified time
   * @param {string} videoPath
   * @param {number} timestamp - seconds
   * @returns {Promise<Buffer>} - Raw RGB buffer
   */
  async extractFrame(videoPath, timestamp) {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    const outputPath = path.join(this.tempDir, `frame_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

    // ffmpeg: extract frame and scale
    const cmd = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -vf scale=${this.outputSize.width}:${this.outputSize.height} -y "${outputPath}" 2>nul`;

    try {
      execSync(cmd, { windowsHide: true, stdio: 'pipe' });

      // Read with sharp, get raw RGB buffer
      const { data, info } = await sharp(outputPath)
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Cleanup temp file
      try { fs.unlinkSync(outputPath); } catch (e) {}

      return { data, info };
    } catch (error) {
      try { fs.unlinkSync(outputPath); } catch (e) {}
      console.error(`[VamRgbEncoder] Failed to extract frame at ${timestamp}s`);
      return null;
    }
  }

  /**
   * Encode single cell with FIXED stride (0.5s)
   * @param {string} videoPath
   * @param {number} centerTime - T (center timestamp in seconds)
   * @returns {Promise<Buffer>} - PNG buffer
   */
  async encodeCell(videoPath, centerTime) {
    const pastTime = Math.max(0, centerTime - this.stride);
    const presentTime = centerTime;
    const futureTime = centerTime + this.stride;

    // Extract three frames in parallel
    const [frameR, frameG, frameB] = await Promise.all([
      this.extractFrame(videoPath, pastTime),
      this.extractFrame(videoPath, presentTime),
      this.extractFrame(videoPath, futureTime)
    ]);

    if (!frameR || !frameG || !frameB) {
      throw new Error(`Failed to extract frames for cell at ${centerTime}s`);
    }

    const width = this.outputSize.width;
    const height = this.outputSize.height;
    const pixels = width * height;
    const BLOCK_NUDGE = 8;   // G-Nudge: 8×8 for gradient smoothness
    const BLOCK_MOSAIC = 4;  // R/B Mosaic: 4×4 for finer temporal resolution
    const SCALE = 0.15;
    const HALF_NUDGE = (BLOCK_NUDGE - 1) / 2;  // 3.5 for 8×8

    const output = Buffer.alloc(pixels * 3);

    // ψ3.2 Pass 1a: G-Nudge color diffs (8×8 blocks)
    const nudgeBlocksX = Math.ceil(width / BLOCK_NUDGE);
    const nudgeBlocksY = Math.ceil(height / BLOCK_NUDGE);
    const avgRG = new Float32Array(nudgeBlocksX * nudgeBlocksY);
    const avgBG = new Float32Array(nudgeBlocksX * nudgeBlocksY);

    for (let by = 0; by < nudgeBlocksY; by++) {
      for (let bx = 0; bx < nudgeBlocksX; bx++) {
        let sumRG = 0, sumBG = 0, count = 0;
        const yEnd = Math.min((by + 1) * BLOCK_NUDGE, height);
        const xEnd = Math.min((bx + 1) * BLOCK_NUDGE, width);

        for (let y = by * BLOCK_NUDGE; y < yEnd; y++) {
          for (let x = bx * BLOCK_NUDGE; x < xEnd; x++) {
            const i = (y * width + x) * 3;
            sumRG += frameG.data[i] - frameG.data[i + 1];      // R - G
            sumBG += frameG.data[i + 2] - frameG.data[i + 1];  // B - G
            count++;
          }
        }

        const idx = by * nudgeBlocksX + bx;
        avgRG[idx] = sumRG / count;
        avgBG[idx] = sumBG / count;
      }
    }

    // ψ3.2 Pass 1b: R/B Mosaic block averages (4×4 blocks)
    const mosaicBlocksX = Math.ceil(width / BLOCK_MOSAIC);
    const mosaicBlocksY = Math.ceil(height / BLOCK_MOSAIC);
    const blockR = new Uint8Array(mosaicBlocksX * mosaicBlocksY);
    const blockB = new Uint8Array(mosaicBlocksX * mosaicBlocksY);

    for (let by = 0; by < mosaicBlocksY; by++) {
      for (let bx = 0; bx < mosaicBlocksX; bx++) {
        let sumPastR = 0, sumFutureB = 0, count = 0;
        const yEnd = Math.min((by + 1) * BLOCK_MOSAIC, height);
        const xEnd = Math.min((bx + 1) * BLOCK_MOSAIC, width);

        for (let y = by * BLOCK_MOSAIC; y < yEnd; y++) {
          for (let x = bx * BLOCK_MOSAIC; x < xEnd; x++) {
            const i = (y * width + x) * 3;
            sumPastR += frameR.data[i];           // Past R
            sumFutureB += frameB.data[i + 2];     // Future B
            count++;
          }
        }

        const idx = by * mosaicBlocksX + bx;
        blockR[idx] = Math.round(sumPastR / count);
        blockB[idx] = Math.round(sumFutureB / count);
      }
    }

    // ψ3.2 Pass 2: Mosaic R (4×4) + Nudged G (8×8) + Mosaic B (4×4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;

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
        output[i] = blockR[mosaicIdx];

        // G = Present_G + 8×8 gradient nudge (ψ3.1)
        const g0 = frameG.data[i + 1];
        const nudge = Math.round(
          (avgRG[nudgeIdx] * dx + avgBG[nudgeIdx] * dy) * SCALE
        );
        output[i + 1] = Math.max(0, Math.min(255, g0 + nudge));

        // B = Future 4×4 block average (ψ3.2 mosaic)
        output[i + 2] = blockB[mosaicIdx];
      }
    }

    // Convert to PNG with timestamp overlay
    const pngBuffer = await this.addTimestampOverlay(output, width, height, centerTime);

    return pngBuffer;
  }

  /**
   * Format seconds as M:SS or MM:SS
   */
  formatTimestamp(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Add timestamp overlay to cell image
   * Uses SVG overlay for high visibility
   */
  async addTimestampOverlay(rawBuffer, width, height, timestamp) {
    const timeText = this.formatTimestamp(timestamp);

    // SVG with high-contrast timestamp (white text with black outline)
    // Position: bottom-left corner
    const fontSize = Math.max(16, Math.floor(width / 10));
    const padding = 4;
    const boxHeight = fontSize + padding * 2;
    const boxWidth = timeText.length * fontSize * 0.7 + padding * 2;

    const svg = `
      <svg width="${width}" height="${height}">
        <defs>
          <filter id="outline">
            <feMorphology in="SourceAlpha" result="dilated" operator="dilate" radius="1"/>
            <feFlood flood-color="black" result="black"/>
            <feComposite in="black" in2="dilated" operator="in" result="outline"/>
            <feMerge>
              <feMergeNode in="outline"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <rect x="0" y="${height - boxHeight}" width="${boxWidth}" height="${boxHeight}" fill="rgba(0,0,0,0.7)"/>
        <text x="${padding}" y="${height - padding - 2}"
              font-family="Arial, sans-serif"
              font-size="${fontSize}"
              font-weight="bold"
              fill="white"
              filter="url(#outline)">${timeText}</text>
      </svg>
    `;

    const pngBuffer = await sharp(rawBuffer, {
      raw: { width, height, channels: 3 }
    })
      .composite([{
        input: Buffer.from(svg),
        top: 0,
        left: 0
      }])
      .png()
      .toBuffer();

    return pngBuffer;
  }

  /**
   * Encode full video with reach map
   * @param {string} videoPath
   * @param {object} reachMap - Output from AudioReachDetector
   * @param {function} onProgress - Progress callback (index, total)
   * @returns {Promise<Array>}
   */
  async encodeVideo(videoPath, reachMap, onProgress = null) {
    const cells = [];
    const total = reachMap.cells.length;

    console.log(`[VamRgbEncoder] Encoding ${total} cells with fixed stride ${this.stride}s`);

    for (let i = 0; i < reachMap.cells.length; i++) {
      const cellInfo = reachMap.cells[i];

      if (onProgress) {
        onProgress(i + 1, total);
      }

      try {
        const pngBuffer = await this.encodeCell(videoPath, cellInfo.timestamp);

        cells.push({
          index: cellInfo.index,
          timestamp: cellInfo.timestamp,
          stride: this.stride,
          reach: cellInfo.reach,
          gap: cellInfo.gap,
          level: cellInfo.level,
          activity_score: cellInfo.activity_score,
          activity_type: cellInfo.activity_type,
          pngBuffer: pngBuffer
        });

        console.log(`[VamRgbEncoder] Cell ${i + 1}/${total}: T=${cellInfo.timestamp}s, reach=${cellInfo.reach}s, level=${cellInfo.level}`);
      } catch (error) {
        console.error(`[VamRgbEncoder] Failed to encode cell ${i}:`, error.message);
      }
    }

    return cells;
  }

  /**
   * Clean up temp directory
   */
  cleanup() {
    if (fs.existsSync(this.tempDir)) {
      try {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.tempDir, file));
        }
        fs.rmdirSync(this.tempDir);
      } catch (e) {}
    }
  }
}

module.exports = { VamRgbEncoder };
