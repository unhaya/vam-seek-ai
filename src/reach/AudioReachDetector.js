/**
 * AudioReachDetector - VAM-RGB v3.0
 *
 * Analyzes audio waveform to determine reach levels for each grid cell.
 * Stride is FIXED at 0.5s for physics precision.
 * Only reach varies based on audio activity.
 */

const { execSync } = require('child_process');
const path = require('path');

class AudioReachDetector {

  constructor(config = {}) {
    this.strideSeconds = 0.5;  // FIXED - never changes
    this.gridInterval = config.gridInterval || 15;
    this.minGap = config.minGap || 2.0;
    this.sampleRate = config.sampleRate || 16000;

    // 8-level graduated reach system
    this.reachLevels = [
      { level: 1, activityMax: 0.05,  reach: 1.0,  type: 'silence' },
      { level: 2, activityMax: 0.15,  reach: 2.0,  type: 'very_low' },
      { level: 3, activityMax: 0.25,  reach: 3.0,  type: 'low' },
      { level: 4, activityMax: 0.40,  reach: 4.0,  type: 'medium_low' },
      { level: 5, activityMax: 0.55,  reach: 5.0,  type: 'medium' },
      { level: 6, activityMax: 0.70,  reach: 5.5,  type: 'medium_high' },
      { level: 7, activityMax: 0.85,  reach: 6.0,  type: 'high' },
      { level: 8, activityMax: 1.00,  reach: 6.5,  type: 'intense' }
    ];
  }

  /**
   * Main entry point
   * @param {string} inputPath - Path to video or audio file
   * @returns {Promise<ReachMap>}
   */
  async analyze(inputPath) {
    console.log(`[AudioReachDetector] Analyzing: ${inputPath}`);

    const samples = await this.loadAudio(inputPath);
    const duration = samples.length / this.sampleRate;
    console.log(`[AudioReachDetector] Duration: ${duration.toFixed(1)}s`);

    const peaks = this.detectPeaks(samples);
    const reachMap = this.peaksToReach(peaks, duration);

    console.log(`[AudioReachDetector] Generated ${reachMap.cells.length} cells`);
    return reachMap;
  }

  /**
   * Load audio from video/audio file using ffmpeg
   * @param {string} inputPath
   * @returns {Float32Array}
   */
  async loadAudio(inputPath) {
    // Use shell: true for Windows compatibility
    const cmd = `ffmpeg -i "${inputPath}" -f f32le -acodec pcm_f32le -ac 1 -ar ${this.sampleRate} -`;

    try {
      const buffer = execSync(cmd, {
        maxBuffer: 500 * 1024 * 1024,  // 500MB max
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });
      return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
    } catch (error) {
      console.error('[AudioReachDetector] FFmpeg error:', error.message);
      throw new Error(`Failed to extract audio from ${inputPath}`);
    }
  }

  /**
   * Detect RMS peaks in 100ms windows
   * @param {Float32Array} samples
   * @returns {Array<{time: number, rms: number}>}
   */
  detectPeaks(samples) {
    const windowSize = Math.floor(this.sampleRate * 0.1); // 100ms
    const peaks = [];

    for (let i = 0; i < samples.length; i += windowSize) {
      const end = Math.min(i + windowSize, samples.length);
      const window = samples.slice(i, end);

      // RMS calculation
      let sumSquares = 0;
      for (let j = 0; j < window.length; j++) {
        sumSquares += window[j] * window[j];
      }
      const rms = Math.sqrt(sumSquares / window.length);

      const time = i / this.sampleRate;
      peaks.push({ time, rms });
    }

    return peaks;
  }

  /**
   * Convert activity score to reach level
   * @param {number} normalizedActivity - 0 to 1
   * @returns {{level: number, reach: number, type: string}}
   */
  activityToReach(normalizedActivity) {
    for (const level of this.reachLevels) {
      if (normalizedActivity <= level.activityMax) {
        return {
          level: level.level,
          reach: level.reach,
          type: level.type
        };
      }
    }
    // Fallback to max level
    const max = this.reachLevels[this.reachLevels.length - 1];
    return { level: max.level, reach: max.reach, type: max.type };
  }

  /**
   * Convert peaks to reach map
   * @param {Array} peaks
   * @param {number} duration
   * @returns {ReachMap}
   */
  peaksToReach(peaks, duration) {
    const cellCount = Math.floor(duration / this.gridInterval);
    const cells = [];

    // Find max RMS for normalization
    let maxRms = 0;
    for (const peak of peaks) {
      if (peak.rms > maxRms) maxRms = peak.rms;
    }
    // Use 0.3 as reference max if actual max is lower
    const normalizationFactor = Math.max(maxRms, 0.3);

    for (let i = 0; i < cellCount; i++) {
      const cellCenter = i * this.gridInterval + (this.gridInterval / 2);
      const cellStart = i * this.gridInterval;
      const cellEnd = (i + 1) * this.gridInterval;

      // Get peaks within this cell's interval
      const cellPeaks = peaks.filter(p => p.time >= cellStart && p.time < cellEnd);

      if (cellPeaks.length === 0) {
        // No audio data, assume silence
        const { level, reach, type } = this.activityToReach(0);
        cells.push({
          index: i,
          timestamp: cellCenter,
          stride: this.strideSeconds,
          reach: reach,
          gap: this.calculateGap(reach, reach),  // Assume neighbor has same reach
          level: level,
          activity_score: 0,
          activity_type: type
        });
        continue;
      }

      // Calculate average RMS for this cell
      const avgRms = cellPeaks.reduce((sum, p) => sum + p.rms, 0) / cellPeaks.length;

      // Normalize to 0-1
      const normalizedActivity = Math.min(1, avgRms / normalizationFactor);

      // Get reach from activity level
      const { level, reach, type } = this.activityToReach(normalizedActivity);

      cells.push({
        index: i,
        timestamp: Math.round(cellCenter * 100) / 100,
        stride: this.strideSeconds,
        reach: reach,
        gap: null,  // Will be calculated in post-processing
        level: level,
        activity_score: Math.round(normalizedActivity * 100) / 100,
        activity_type: type
      });
    }

    // Post-process: calculate gaps between adjacent cells
    for (let i = 0; i < cells.length; i++) {
      const current = cells[i];
      const next = cells[i + 1];

      if (next) {
        // Gap = distance between cells - (current reach + next reach)
        const gap = this.gridInterval - current.reach - next.reach;
        current.gap = Math.max(gap, this.minGap);
      } else {
        // Last cell: use own reach for both sides
        const gap = this.gridInterval - current.reach * 2;
        current.gap = Math.max(gap, this.minGap);
      }
    }

    return {
      stride_seconds: this.strideSeconds,
      grid_interval_seconds: this.gridInterval,
      min_gap_seconds: this.minGap,
      duration_seconds: duration,
      cell_count: cellCount,
      cells: cells
    };
  }

  /**
   * Calculate gap between two cells
   * @param {number} leftReach
   * @param {number} rightReach
   * @returns {number}
   */
  calculateGap(leftReach, rightReach) {
    const gap = this.gridInterval - leftReach - rightReach;
    return Math.max(gap, this.minGap);
  }
}

module.exports = { AudioReachDetector };
