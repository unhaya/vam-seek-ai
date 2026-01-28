#!/usr/bin/env node

/**
 * interpolate-cli.js - 7-Frame Loop from Thaw Output
 *
 * Takes the 3 thaw frames (past, present, future) and generates
 * a 7-frame temporal loop via linear pixel blending.
 *
 * Sequence: Past → [blend] → Present → [blend] → Future → [blend] → Present → [blend] → (loop)
 *
 * This is NOT optical-flow interpolation (RIFE/FILM).
 * It's a linear crossfade — sufficient for proof-of-concept.
 * Replace with RIFE for production quality.
 *
 * Usage:
 *   node src/cli/interpolate-cli.js <thaw-output-dir> [options]
 *
 * Example:
 *   node src/cli/thaw-cli.js cell.png --output-dir ./thaw_out
 *   node src/cli/interpolate-cli.js ./thaw_out --gif
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

const { program } = require('commander');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

program
  .name('interpolate-cli')
  .version('1.0.0')
  .description('Generate 7-frame temporal loop from thaw output')
  .argument('<thaw-dir>', 'Directory containing thaw output (past/present/future PNGs)')
  .option('-o, --output-dir <dir>', 'Output directory for sequence frames')
  .option('-c, --cell <n>', 'Cell index to process', '000')
  .option('--color', 'Use color-estimated frames instead of grayscale (Level 2)')
  .option('--steps <n>', 'Intermediate blend steps between keyframes', '1')
  .option('--gif', 'Assemble into animated GIF (requires ffmpeg)')
  .option('--mp4', 'Assemble into MP4 (requires ffmpeg)')
  .option('--fps <n>', 'Frame rate for GIF/MP4', '8')
  .option('--loop', 'Create a ping-pong loop (P→Pr→F→Pr→P...)', true)
  .action(async (thawDir, options) => {
    try {
      await run(thawDir, options);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();


async function run(thawDir, options) {
  const inputDir = path.resolve(thawDir);
  const cell = options.cell;
  const useColor = options.color || false;
  const steps = Math.max(1, parseInt(options.steps));
  const fps = parseInt(options.fps);
  const suffix = useColor ? '_color' : '';

  // Resolve frame paths
  const pastPath = path.join(inputDir, `cell_${cell}_past${suffix}.png`);
  const presentPath = path.join(inputDir, `cell_${cell}_present${suffix}.png`);
  const futurePath = path.join(inputDir, `cell_${cell}_future${suffix}.png`);

  for (const p of [pastPath, presentPath, futurePath]) {
    if (!fs.existsSync(p)) {
      throw new Error(`Frame not found: ${p}`);
    }
  }

  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(inputDir, 'sequence');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('');
  console.log('  VAM-RGB Temporal Interpolation v1.0');
  console.log('');
  console.log(`  Input:   ${inputDir}`);
  console.log(`  Cell:    ${cell}`);
  console.log(`  Mode:    ${useColor ? 'color (Level 2)' : 'grayscale (Level 1)'}`);
  console.log(`  Steps:   ${steps} blend(s) between keyframes`);
  console.log(`  Output:  ${outputDir}`);
  console.log('');

  // Load frames as raw RGBA buffers
  const past = await loadFrame(pastPath);
  const present = await loadFrame(presentPath);
  const future = await loadFrame(futurePath);

  // Generate sequence: Past → Present → Future → Present (ping-pong loop)
  const sequence = [];
  let frameIdx = 0;

  // Segment 1: Past → Present
  sequence.push({ buf: past.buf, label: 'past' });
  frameIdx++;
  for (let s = 1; s <= steps; s++) {
    const t = s / (steps + 1);
    const blended = blendFrames(past, present, t);
    sequence.push({ buf: blended, label: `past-present_${s}` });
    frameIdx++;
  }

  // Segment 2: Present → Future
  sequence.push({ buf: present.buf, label: 'present' });
  frameIdx++;
  for (let s = 1; s <= steps; s++) {
    const t = s / (steps + 1);
    const blended = blendFrames(present, future, t);
    sequence.push({ buf: blended, label: `present-future_${s}` });
    frameIdx++;
  }

  // Segment 3: Future → Present (return)
  sequence.push({ buf: future.buf, label: 'future' });
  frameIdx++;
  for (let s = 1; s <= steps; s++) {
    const t = s / (steps + 1);
    const blended = blendFrames(future, present, t);
    sequence.push({ buf: blended, label: `future-present_${s}` });
    frameIdx++;
  }

  // Segment 4: Present → Past (return to start, for seamless loop)
  if (options.loop) {
    sequence.push({ buf: present.buf, label: 'present_return' });
    frameIdx++;
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const blended = blendFrames(present, past, t);
      sequence.push({ buf: blended, label: `present-past_${s}` });
      frameIdx++;
    }
  }

  console.log(`  Frames:  ${sequence.length}`);

  // Write individual frames
  const framePaths = [];
  for (let i = 0; i < sequence.length; i++) {
    const frameName = `frame_${String(i).padStart(3, '0')}.png`;
    const framePath = path.join(outputDir, frameName);
    framePaths.push(framePath);

    await sharp(sequence[i].buf, {
      raw: { width: past.width, height: past.height, channels: 4 }
    })
      .png()
      .toFile(framePath);
  }

  console.log(`  Written: ${framePaths.length} PNGs`);

  // Assemble GIF or MP4 if requested
  if (options.gif || options.mp4) {
    await assemble(outputDir, framePaths, past.width, past.height, fps, options);
  }

  console.log('');
}


/**
 * Load a PNG into raw RGBA buffer.
 */
async function loadFrame(framePath) {
  const image = sharp(framePath).ensureAlpha();
  const metadata = await image.metadata();
  const buf = await image.raw().toBuffer();

  return {
    buf,
    width: metadata.width,
    height: metadata.height
  };
}


/**
 * Linear pixel blend between two frames.
 * t=0.0 → frameA, t=1.0 → frameB
 */
function blendFrames(frameA, frameB, t) {
  const len = frameA.buf.length;
  const result = Buffer.alloc(len);
  const invT = 1 - t;

  for (let i = 0; i < len; i++) {
    result[i] = Math.round(frameA.buf[i] * invT + frameB.buf[i] * t);
  }

  return result;
}


/**
 * Assemble frames into GIF or MP4 using ffmpeg.
 */
async function assemble(outputDir, framePaths, width, height, fps, options) {
  const { execSync } = require('child_process');

  // Check ffmpeg
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', windowsHide: true });
  } catch {
    console.log('  Warning: ffmpeg not found, skipping assembly');
    return;
  }

  const inputPattern = path.join(outputDir, 'frame_%03d.png');

  if (options.gif) {
    const gifPath = path.join(outputDir, '..', `cell_${options.cell}_thaw.gif`);
    const cmd = `ffmpeg -y -framerate ${fps} -i "${inputPattern}" -vf "split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 "${gifPath}"`;

    try {
      execSync(cmd, { stdio: 'pipe', windowsHide: true });
      const size = fs.statSync(gifPath).size;
      console.log(`  GIF:     ${gifPath} (${(size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.log(`  GIF failed: ${err.message}`);
    }
  }

  if (options.mp4) {
    const mp4Path = path.join(outputDir, '..', `cell_${options.cell}_thaw.mp4`);
    const cmd = `ffmpeg -y -framerate ${fps} -i "${inputPattern}" -c:v libx264 -pix_fmt yuv420p -crf 18 "${mp4Path}"`;

    try {
      execSync(cmd, { stdio: 'pipe', windowsHide: true });
      const size = fs.statSync(mp4Path).size;
      console.log(`  MP4:     ${mp4Path} (${(size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.log(`  MP4 failed: ${err.message}`);
    }
  }
}
