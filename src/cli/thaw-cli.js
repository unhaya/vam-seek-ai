#!/usr/bin/env node

/**
 * thaw-cli.js - VAM-RGB Thaw Decoder CLI
 *
 * Reads a VAM-RGB cell (or grid) PNG and outputs separated temporal frames.
 *
 * Usage:
 *   node src/cli/thaw-cli.js <input.png> [options]
 *
 * Examples:
 *   # Single cell
 *   node src/cli/thaw-cli.js cell_001.png --output-dir ./frames
 *
 *   # Grid image (split into cells, then thaw each)
 *   node src/cli/thaw-cli.js grid.png --output-dir ./frames --columns 5 --cell-size 256
 *
 * Output per cell:
 *   cell_NNN_past.png      - R channel as grayscale (Level 1)
 *   cell_NNN_present.png   - G channel as grayscale (Level 1)
 *   cell_NNN_future.png    - B channel as grayscale (Level 1)
 *   cell_NNN_confidence.png - Confidence map (Level 1)
 *   cell_NNN_past_color.png    - Estimated full-color past (Level 2)
 *   cell_NNN_present_color.png - Estimated full-color present (Level 2)
 *   cell_NNN_future_color.png  - Estimated full-color future (Level 2)
 *   cell_NNN_quality.png       - Quality map (Level 2)
 *   thaw-report.json       - Validation report for all cells
 *
 * v1.0 - 2026-01-28
 * Copyright (c) 2026 Susumu Takahashi (haasiy/unhaya)
 * License: CC BY-NC 4.0
 */

const { program } = require('commander');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ChannelSeparator = require('../thaw/ChannelSeparator');
const ColorEstimator = require('../thaw/ColorEstimator');
const ReconstructionValidator = require('../thaw/ReconstructionValidator');
const PhysicsAnalyzer = require('../validation/PhysicsAnalyzer');

program
  .name('thaw-cli')
  .version('1.0.0')
  .description('VAM-RGB Thaw Decoder - Reconstruct temporal frames from frozen time')
  .argument('<input>', 'Input VAM-RGB PNG (single cell or grid)')
  .option('-o, --output-dir <dir>', 'Output directory', './thaw_output')
  .option('-c, --columns <n>', 'Grid columns (for grid images)', '0')
  .option('-s, --cell-size <px>', 'Cell size in pixels (for grid images)', '256')
  .option('-p, --padding <px>', 'Padding between grid cells', '0')
  .option('--level <n>', 'Max processing level: 1=separate, 2=estimate', '2')
  .option('--no-grayscale', 'Skip Level 1 grayscale output')
  .option('--json-only', 'Output report JSON only, no images')
  .action(async (input, options) => {
    try {
      await run(input, options);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();


async function run(input, options) {
  const inputPath = path.resolve(input);
  const outputDir = path.resolve(options.outputDir);
  const columns = parseInt(options.columns);
  const cellSize = parseInt(options.cellSize);
  const padding = parseInt(options.padding);
  const maxLevel = parseInt(options.level);
  const jsonOnly = options.jsonOnly || false;
  const skipGrayscale = options.grayscale === false;

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('');
  console.log('  VAM-RGB Thaw Decoder v1.0');
  console.log('  "Thawing frozen time"');
  console.log('');
  console.log(`  Input:   ${inputPath}`);
  console.log(`  Output:  ${outputDir}`);
  console.log(`  Level:   ${maxLevel}`);
  console.log('');

  // Read input image
  const imageInfo = await sharp(inputPath).metadata();
  console.log(`  Image:   ${imageInfo.width}x${imageInfo.height} (${imageInfo.channels}ch)`);

  // Extract cells from image
  const cells = await extractCells(inputPath, imageInfo, columns, cellSize, padding);
  console.log(`  Cells:   ${cells.length}`);
  console.log('');

  // Process each cell
  const separator = new ChannelSeparator();
  const estimator = new ColorEstimator();
  const physicsAnalyzer = new PhysicsAnalyzer();
  const validator = new ReconstructionValidator({ physicsAnalyzer });

  const report = {
    version: '1.0',
    input: path.basename(inputPath),
    timestamp: new Date().toISOString(),
    imageSize: { width: imageInfo.width, height: imageInfo.height },
    gridLayout: columns > 0 ? { columns, cellSize, padding } : null,
    cellCount: cells.length,
    level: maxLevel,
    cells: []
  };

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const cellLabel = String(i).padStart(3, '0');
    process.stdout.write(`  [${i + 1}/${cells.length}] Cell ${cellLabel} ...`);

    // Level 1: Separate
    const separated = separator.separate(cell);
    const staticColor = separator.extractStaticColor(cell);
    const temporalDelta = separator.computeTemporalDelta(cell);

    // Physics profile
    const physics = physicsAnalyzer.analyze(cell, i, i * 15);

    const cellReport = {
      index: i,
      width: cell.width,
      height: cell.height,
      physics: {
        colorSeparation: physics.colorSeparation,
        physicsIntensity: physics.physicsIntensity,
        hasMotion: physics.hasMotion,
        direction: physics.directionalFringe.angleDeg,
        magnitude: physics.directionalFringe.magnitude
      },
      staticPixelRatio: countMask(staticColor.mask) / (cell.width * cell.height),
      meanConfidence: meanFloat32(separated.confidenceMap)
    };

    if (!jsonOnly) {
      // Write Level 1 outputs
      if (!skipGrayscale) {
        await writeImageData(separated.past, path.join(outputDir, `cell_${cellLabel}_past.png`));
        await writeImageData(separated.present, path.join(outputDir, `cell_${cellLabel}_present.png`));
        await writeImageData(separated.future, path.join(outputDir, `cell_${cellLabel}_future.png`));
        await writeConfidenceMap(separated.confidenceMap, cell.width, cell.height,
          path.join(outputDir, `cell_${cellLabel}_confidence.png`));
      }
    }

    // Level 2: Estimate color
    if (maxLevel >= 2) {
      const estimated = estimator.estimateAll(separated, cell);

      // Validate round-trip
      const validation = validator.validate(
        cell,
        estimated.past.frame,
        estimated.present.frame,
        estimated.future.frame
      );

      cellReport.validation = {
        roundTripCoherence: validation.roundTripCoherence,
        channelErrors: validation.channelErrors,
        pixelError: validation.pixelError
      };

      if (validation.physicsMatch) {
        cellReport.validation.physicsMatch = {
          colorSepError: validation.physicsMatch.colorSepError,
          fringeMagError: validation.physicsMatch.fringeMagError,
          fringeAngleError: validation.physicsMatch.fringeAngleError,
          intensityError: validation.physicsMatch.intensityError
        };
      }

      cellReport.meanQuality = {
        past: meanFloat32(estimated.past.quality),
        present: meanFloat32(estimated.present.quality),
        future: meanFloat32(estimated.future.quality)
      };

      if (!jsonOnly) {
        await writeImageData(estimated.past.frame, path.join(outputDir, `cell_${cellLabel}_past_color.png`));
        await writeImageData(estimated.present.frame, path.join(outputDir, `cell_${cellLabel}_present_color.png`));
        await writeImageData(estimated.future.frame, path.join(outputDir, `cell_${cellLabel}_future_color.png`));
        await writeQualityMap(estimated.past.quality, cell.width, cell.height,
          path.join(outputDir, `cell_${cellLabel}_quality.png`));
      }
    }

    report.cells.push(cellReport);
    console.log(` ${physics.hasMotion ? 'motion' : 'static'} | sep=${physics.colorSeparation} | conf=${cellReport.meanConfidence.toFixed(3)}`);
  }

  // Write report
  const reportPath = path.join(outputDir, 'thaw-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Summary
  console.log('');
  console.log('  Summary:');
  const motionCells = report.cells.filter(c => c.physics.hasMotion).length;
  const staticCells = report.cells.length - motionCells;
  console.log(`    Motion cells: ${motionCells}`);
  console.log(`    Static cells: ${staticCells}`);

  if (maxLevel >= 2) {
    const avgCoherence = report.cells
      .filter(c => c.validation)
      .reduce((s, c) => s + c.validation.roundTripCoherence, 0) / report.cells.length;
    console.log(`    Avg coherence: ${avgCoherence.toFixed(3)}`);
  }

  console.log('');
  console.log(`  Report: ${reportPath}`);

  if (!jsonOnly) {
    const fileCount = fs.readdirSync(outputDir).filter(f => f.endsWith('.png')).length;
    console.log(`  Images: ${fileCount} PNGs in ${outputDir}`);
  }

  console.log('');
}


// ─── Cell Extraction ───

/**
 * Extract individual cells from input image.
 * If columns=0, treat entire image as a single cell.
 * If columns>0, split into grid.
 */
async function extractCells(inputPath, imageInfo, columns, cellSize, padding) {
  const { width, height } = imageInfo;

  if (columns <= 0) {
    // Single cell mode
    const rawBuffer = await sharp(inputPath)
      .ensureAlpha()
      .raw()
      .toBuffer();

    return [{
      data: new Uint8ClampedArray(rawBuffer),
      width,
      height
    }];
  }

  // Grid mode: extract each cell
  const cells = [];
  const step = cellSize + padding;
  const rows = Math.ceil(height / step);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const left = col * step;
      const top = row * step;

      // Check bounds
      if (left + cellSize > width || top + cellSize > height) {
        continue;
      }

      const rawBuffer = await sharp(inputPath)
        .extract({ left, top, width: cellSize, height: cellSize })
        .ensureAlpha()
        .raw()
        .toBuffer();

      cells.push({
        data: new Uint8ClampedArray(rawBuffer),
        width: cellSize,
        height: cellSize
      });
    }
  }

  return cells;
}


// ─── Image Output ───

/**
 * Write ImageData-like object to PNG via sharp.
 */
async function writeImageData(imageData, outputPath) {
  const { data, width, height } = imageData;

  await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width, height, channels: 4 }
  })
    .png()
    .toFile(outputPath);
}

/**
 * Write Float32Array confidence/quality map as grayscale PNG.
 * 0.0 = black, 1.0 = white.
 */
async function writeConfidenceMap(map, width, height, outputPath) {
  const buf = Buffer.alloc(width * height);
  for (let i = 0; i < map.length; i++) {
    buf[i] = Math.round(map[i] * 255);
  }

  await sharp(buf, {
    raw: { width, height, channels: 1 }
  })
    .png()
    .toFile(outputPath);
}

/**
 * Write Float32Array quality map as grayscale PNG.
 */
async function writeQualityMap(map, width, height, outputPath) {
  return writeConfidenceMap(map, width, height, outputPath);
}


// ─── Utilities ───

function countMask(mask) {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) count++;
  }
  return count;
}

function meanFloat32(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return Math.round((sum / arr.length) * 1000) / 1000;
}
