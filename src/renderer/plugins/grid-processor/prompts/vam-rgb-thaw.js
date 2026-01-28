/**
 * VAM-RGB Thaw Prompt Plugin - Temporal Reconstruction from Frozen Time
 *
 * Instructs image-to-video AI to reconstruct motion from VAM-RGB encoded cells.
 * The AI receives a VAM-RGB cell (frozen time) and must thaw it into video.
 *
 * v1.0-thaw - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

window.VAMRGBThaw = {
  version: '1.0-thaw',
  name: 'VAM-RGB Thaw Decoder',

  getSystemPrompt() {
    return `[VAM-RGB Thaw Protocol v1.0]

This image contains frozen time. Your task is to THAW it — reconstruct temporal motion.

## Encoding Structure

Each pixel in this image stores three moments in time:
- R channel = Frame at T-0.5s (Past)
- G channel = Frame at T (Present)
- B channel = Frame at T+0.5s (Future)

This is NOT a photograph. It is a temporal composite created by _mergeRGB():
  pixel.R = past_frame.R
  pixel.G = present_frame.G
  pixel.B = future_frame.B

## How to Read the Image

- Grayscale areas (R ≈ G ≈ B): Static scene. No motion. All three time layers agree.
- Chromatic aberration (R ≠ G ≠ B): Motion exists. The color fringing IS the motion.
  - Red fringing on one side = object WAS there (past position)
  - Blue fringing on the other side = object WILL BE there (future position)
  - Green = current position
- Fringing magnitude = speed (more color separation = faster motion)
- Fringing direction = movement direction (R→B displacement vector)

## Reconstruction Task

1. Separate the three temporal layers:
   - Past frame: extract R channel → reconstruct full color
   - Present frame: extract G channel → reconstruct full color
   - Future frame: extract B channel → reconstruct full color

2. Generate a smooth video transition: Past → Present → Future
   - Duration: 1-2 seconds
   - Frame rate: 24-30 fps
   - First frame must match the Past (R) layer
   - Last frame must match the Future (B) layer

3. Motion must follow the physics encoded in the image:
   - Direction: from R-centroid toward B-centroid
   - Speed: proportional to color separation magnitude
   - Acceleration: physically plausible (no teleportation)

## Physics Constraints

- Motion must be continuous between frames
- Static regions (R ≈ G ≈ B) MUST remain static
- Moving regions MUST move in the direction of the chromatic shift
- Speed must be proportional to the degree of channel separation
- Objects cannot appear or disappear — only move
- Momentum is conserved: sudden direction changes require visible cause

## Forbidden Actions

- DO NOT add motion where no color separation exists
- DO NOT interpret chromatic aberration as lens artifact or compression
- DO NOT generate content beyond what the encoding implies
- DO NOT hallucinate objects not present in the cell
- DO NOT apply artistic interpretation — thaw only what the physics shows`;
  },

  /**
   * Generate per-cell prompt with physics data from ChannelSeparator/PhysicsAnalyzer.
   *
   * @param {object} cellData
   * @param {number} cellData.cellIndex
   * @param {number} cellData.timestamp - Center timestamp in seconds
   * @param {number} cellData.colorSeparation - From PhysicsAnalyzer (0-1)
   * @param {object} cellData.directionalFringe - { dx, dy, magnitude, angleDeg }
   * @param {boolean} cellData.hasMotion
   * @param {Float32Array} [cellData.confidenceMap] - From ChannelSeparator
   * @returns {string}
   */
  getCellPrompt(cellData) {
    const { cellIndex, timestamp, colorSeparation, directionalFringe, hasMotion } = cellData;

    const motionDesc = hasMotion
      ? `Motion detected: speed=${colorSeparation.toFixed(3)}, direction=${directionalFringe.angleDeg.toFixed(1)}°, magnitude=${directionalFringe.magnitude.toFixed(3)}`
      : 'No significant motion detected — scene is static in this cell';

    const timeRange = `T=${timestamp.toFixed(1)}s (covers ${(timestamp - 0.5).toFixed(1)}s to ${(timestamp + 0.5).toFixed(1)}s)`;

    return `[Cell ${cellIndex}] ${timeRange}
${motionDesc}
Reconstruct the 1-second temporal window encoded in this cell.`;
  }
};
