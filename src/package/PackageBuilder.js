/**
 * PackageBuilder - VAM-RGB v3.2
 *
 * Builds .vamrgb.zip packages containing:
 * - manifest.json
 * - reach-map.json
 * - vam-rgb/*.png (encoded cells)
 * - keyframes/*.jpg (optional)
 * - audio/waveform.json (optional)
 */

const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class PackageBuilder {

  constructor(config = {}) {
    this.version = '3.2';
    this.cellResolution = config.cellResolution || { width: 256, height: 256 };
    this.keyframeResolution = config.keyframeResolution || { width: 960, height: 540 };
  }

  /**
   * Build complete .vamrgb.zip package
   * @param {Array} encodedCells - Output from VamRgbEncoder
   * @param {object} reachMap - Output from AudioReachDetector
   * @param {string} outputPath - Path for .vamrgb.zip
   * @param {object} sourceInfo - Original video info
   * @returns {Promise<string>} - Path to created package
   */
  async build(encodedCells, reachMap, outputPath, sourceInfo = {}) {
    console.log(`[PackageBuilder] Building package: ${outputPath}`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create write stream and archiver
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log(`[PackageBuilder] Package created: ${archive.pointer()} bytes`);
        resolve(outputPath);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);

      // 1. Add manifest.json
      const manifest = this.createManifest(reachMap, sourceInfo);
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // 2. Add reach-map.json
      archive.append(JSON.stringify(reachMap, null, 2), { name: 'reach-map.json' });

      // 3. Add VAM-RGB cells
      for (const cell of encodedCells) {
        if (cell.pngBuffer) {
          const filename = `vam-rgb/cell_${String(cell.index).padStart(3, '0')}.png`;
          archive.append(cell.pngBuffer, { name: filename });
        }
      }

      // 4. Add anchor.json (temporal sync data)
      const anchor = this.createAnchor(reachMap, sourceInfo);
      archive.append(JSON.stringify(anchor, null, 2), { name: 'anchor.json' });

      archive.finalize();
    });
  }

  /**
   * Create manifest.json content
   * @param {object} reachMap
   * @param {object} sourceInfo
   * @returns {object}
   */
  createManifest(reachMap, sourceInfo) {
    return {
      vam_rgb_version: this.version,
      package_id: uuidv4(),
      created_at: new Date().toISOString(),

      source: {
        filename: sourceInfo.filename || 'unknown',
        duration_seconds: reachMap.duration_seconds || 0,
        fps: sourceInfo.fps || 30,
        resolution: sourceInfo.resolution || { width: 1920, height: 1080 }
      },

      grid: {
        interval_seconds: reachMap.grid_interval_seconds,
        cell_count: reachMap.cell_count,
        cell_resolution: this.cellResolution
      },

      encoding: {
        stride_seconds: reachMap.stride_seconds,
        stride_mode: 'fixed',
        reach_mode: 'elastic',
        reach_detection: 'audio',
        min_gap_seconds: reachMap.min_gap_seconds
      },

      keyframes: {
        selection: 'within_reach',
        resolution: this.keyframeResolution
      },

      inference_contract: {
        coherence_threshold: 0.7,
        r_index_max: 0.3,
        reconstructable: true
      }
    };
  }

  /**
   * Create anchor.json content
   * @param {object} reachMap
   * @param {object} sourceInfo
   * @returns {object}
   */
  createAnchor(reachMap, sourceInfo) {
    return {
      version: this.version,
      vam_resolution: [this.cellResolution.width, this.cellResolution.height],
      source_resolution: sourceInfo.resolution
        ? [sourceInfo.resolution.width, sourceInfo.resolution.height]
        : [1920, 1080],

      temporal_mapping: reachMap.cells.map(cell => ({
        cell_index: cell.index,
        center_timestamp: cell.timestamp,
        stride: cell.stride,
        reach: cell.reach,
        coverage: {
          start: cell.timestamp - cell.reach,
          end: cell.timestamp + cell.reach
        }
      })),

      encoding_params: {
        stride_fixed: true,
        stride_value: reachMap.stride_seconds,
        reach_variable: true,
        reach_min: 1.0,
        reach_max: 6.5
      }
    };
  }

  /**
   * Extract source info from video file using ffprobe
   * @param {string} videoPath
   * @returns {Promise<object>}
   */
  async getSourceInfo(videoPath) {
    const { execSync } = require('child_process');

    try {
      const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
      const output = execSync(cmd, { windowsHide: true });
      const info = JSON.parse(output.toString());

      const videoStream = info.streams.find(s => s.codec_type === 'video');

      return {
        filename: path.basename(videoPath),
        duration_seconds: parseFloat(info.format.duration) || 0,
        fps: videoStream ? eval(videoStream.r_frame_rate) : 30,
        resolution: videoStream ? {
          width: videoStream.width,
          height: videoStream.height
        } : { width: 1920, height: 1080 }
      };
    } catch (error) {
      console.error('[PackageBuilder] Failed to get source info:', error.message);
      return {
        filename: path.basename(videoPath),
        duration_seconds: 0,
        fps: 30,
        resolution: { width: 1920, height: 1080 }
      };
    }
  }
}

module.exports = { PackageBuilder };
