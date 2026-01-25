/**
 * VamRgbEncoder - VAM-RGB v3.0
 *
 * Encodes video frames into VAM-RGB format using sharp (fast, no native build).
 * Stride is FIXED at 0.5s for physics precision.
 *
 * R(x,y) = Frame(T - 0.5s)  ← Past
 * G(x,y) = Frame(T)         ← Present
 * B(x,y) = Frame(T + 0.5s)  ← Future
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

    // Combine channels: R from past, G from present, B from future
    const output = Buffer.alloc(pixels * 3);

    for (let i = 0; i < pixels; i++) {
      const srcIdx = i * 3;
      const dstIdx = i * 3;

      output[dstIdx + 0] = frameR.data[srcIdx + 0];  // R from past
      output[dstIdx + 1] = frameG.data[srcIdx + 1];  // G from present
      output[dstIdx + 2] = frameB.data[srcIdx + 2];  // B from future
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
