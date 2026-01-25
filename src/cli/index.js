#!/usr/bin/env node

/**
 * VAM-RGB v3.0 CLI
 *
 * Commands:
 *   encode <input>   - Encode video to .vamrgb.zip package
 *   reach <input>    - Extract reach map only (debug)
 *   analyze <pkg>    - Analyze existing package
 *   validate <pkg>   - Validate package integrity
 */

const { program } = require('commander');
const path = require('path');
const fs = require('fs');

const { AudioReachDetector } = require('../reach/AudioReachDetector');
const { VamRgbEncoder } = require('../encoder/VamRgbEncoder');
const { PackageBuilder } = require('../package/PackageBuilder');

program
  .name('vamrgb')
  .version('3.0.0')
  .description('VAM-RGB v3.0 Temporal Codec - "Connect, don\'t fill"');

/**
 * encode command
 */
program
  .command('encode <input>')
  .description('Encode video to VAM-RGB v3.0 package')
  .option('-o, --output <path>', 'Output package path (.vamrgb.zip)')
  .option('--interval <seconds>', 'Grid interval in seconds', '15')
  .option('--min-gap <seconds>', 'Minimum gap between cells', '2')
  .action(async (input, options) => {
    try {
      const inputPath = path.resolve(input);

      if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exit(1);
      }

      // Default output path
      const outputPath = options.output
        ? path.resolve(options.output)
        : inputPath.replace(/\.[^.]+$/, '.vamrgb.zip');

      console.log('');
      console.log('╔═══════════════════════════════════════════════════╗');
      console.log('║           VAM-RGB v3.0 Encoder                    ║');
      console.log('║     "Connect, don\'t fill. Gaps are meaningful."    ║');
      console.log('╚═══════════════════════════════════════════════════╝');
      console.log('');
      console.log(`Input:    ${inputPath}`);
      console.log(`Output:   ${outputPath}`);
      console.log(`Interval: ${options.interval}s`);
      console.log(`Min Gap:  ${options.minGap}s`);
      console.log(`Stride:   0.5s (fixed)`);
      console.log('');

      // 1. Analyze audio to detect reach levels
      console.log('[1/3] Analyzing audio...');
      const detector = new AudioReachDetector({
        gridInterval: parseInt(options.interval),
        minGap: parseFloat(options.minGap)
      });
      const reachMap = await detector.analyze(inputPath);

      console.log(`      → ${reachMap.cells.length} cells detected`);
      console.log(`      → Duration: ${reachMap.duration_seconds.toFixed(1)}s`);
      console.log('');

      // Show reach distribution
      const levelCounts = {};
      for (const cell of reachMap.cells) {
        levelCounts[cell.level] = (levelCounts[cell.level] || 0) + 1;
      }
      console.log('      Reach distribution:');
      for (let i = 1; i <= 8; i++) {
        const count = levelCounts[i] || 0;
        const bar = '█'.repeat(Math.ceil(count / reachMap.cells.length * 20));
        console.log(`        Level ${i}: ${bar} (${count})`);
      }
      console.log('');

      // 2. Encode VAM-RGB cells
      console.log('[2/3] Encoding VAM-RGB cells...');
      const encoder = new VamRgbEncoder();
      const cells = await encoder.encodeVideo(inputPath, reachMap, (current, total) => {
        process.stdout.write(`\r      → Progress: ${current}/${total}`);
      });
      console.log('\n');

      // 3. Build package
      console.log('[3/3] Building package...');
      const builder = new PackageBuilder();
      const sourceInfo = await builder.getSourceInfo(inputPath);
      await builder.build(cells, reachMap, outputPath, sourceInfo);

      // Cleanup
      encoder.cleanup();

      console.log('');
      console.log('╔═══════════════════════════════════════════════════╗');
      console.log('║                    Complete!                      ║');
      console.log('╚═══════════════════════════════════════════════════╝');
      console.log(`Package: ${outputPath}`);
      console.log('');

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * reach command (debug)
 */
program
  .command('reach <input>')
  .description('Extract reach map from video (debug)')
  .option('-o, --output <path>', 'Output JSON path')
  .option('--interval <seconds>', 'Grid interval in seconds', '15')
  .action(async (input, options) => {
    try {
      const inputPath = path.resolve(input);

      if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exit(1);
      }

      const outputPath = options.output
        ? path.resolve(options.output)
        : inputPath.replace(/\.[^.]+$/, '.reach-map.json');

      console.log(`Analyzing: ${inputPath}`);

      const detector = new AudioReachDetector({
        gridInterval: parseInt(options.interval)
      });
      const reachMap = await detector.analyze(inputPath);

      fs.writeFileSync(outputPath, JSON.stringify(reachMap, null, 2));
      console.log(`Reach map saved: ${outputPath}`);

      // Summary
      console.log('');
      console.log('Summary:');
      console.log(`  Cells:    ${reachMap.cells.length}`);
      console.log(`  Duration: ${reachMap.duration_seconds.toFixed(1)}s`);
      console.log(`  Stride:   ${reachMap.stride_seconds}s (fixed)`);
      console.log('');

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * analyze command
 */
program
  .command('analyze <package>')
  .description('Analyze existing VAM-RGB package')
  .action(async (pkg) => {
    try {
      const pkgPath = path.resolve(pkg);

      if (!fs.existsSync(pkgPath)) {
        console.error(`Error: Package not found: ${pkgPath}`);
        process.exit(1);
      }

      const AdmZip = require('adm-zip');
      const zip = new AdmZip(pkgPath);
      const entries = zip.getEntries();

      console.log(`Package: ${pkgPath}`);
      console.log('');
      console.log('Contents:');

      for (const entry of entries) {
        if (!entry.isDirectory) {
          console.log(`  ${entry.entryName} (${entry.header.size} bytes)`);
        }
      }

      // Read manifest
      const manifestEntry = zip.getEntry('manifest.json');
      if (manifestEntry) {
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        console.log('');
        console.log('Manifest:');
        console.log(`  Version:  ${manifest.vam_rgb_version}`);
        console.log(`  Created:  ${manifest.created_at}`);
        console.log(`  Source:   ${manifest.source.filename}`);
        console.log(`  Duration: ${manifest.source.duration_seconds}s`);
        console.log(`  Cells:    ${manifest.grid.cell_count}`);
        console.log(`  Stride:   ${manifest.encoding.stride_seconds}s (${manifest.encoding.stride_mode})`);
      }

      // Read reach-map
      const reachEntry = zip.getEntry('reach-map.json');
      if (reachEntry) {
        const reachMap = JSON.parse(reachEntry.getData().toString('utf8'));
        console.log('');
        console.log('Reach Distribution:');

        const levelCounts = {};
        for (const cell of reachMap.cells) {
          levelCounts[cell.level] = (levelCounts[cell.level] || 0) + 1;
        }
        for (let i = 1; i <= 8; i++) {
          const count = levelCounts[i] || 0;
          console.log(`  Level ${i}: ${count} cells`);
        }
      }

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * validate command
 */
program
  .command('validate <package>')
  .description('Validate VAM-RGB package integrity')
  .action(async (pkg) => {
    try {
      const pkgPath = path.resolve(pkg);

      if (!fs.existsSync(pkgPath)) {
        console.error(`Error: Package not found: ${pkgPath}`);
        process.exit(1);
      }

      const AdmZip = require('adm-zip');
      const zip = new AdmZip(pkgPath);

      const errors = [];
      const warnings = [];

      // Check required files
      const requiredFiles = ['manifest.json', 'reach-map.json', 'anchor.json'];
      for (const file of requiredFiles) {
        if (!zip.getEntry(file)) {
          errors.push(`Missing required file: ${file}`);
        }
      }

      // Check manifest
      const manifestEntry = zip.getEntry('manifest.json');
      if (manifestEntry) {
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));

        if (manifest.vam_rgb_version !== '3.0') {
          warnings.push(`Version mismatch: expected 3.0, got ${manifest.vam_rgb_version}`);
        }

        if (manifest.encoding.stride_seconds !== 0.5) {
          errors.push(`Invalid stride: expected 0.5, got ${manifest.encoding.stride_seconds}`);
        }

        if (manifest.encoding.stride_mode !== 'fixed') {
          errors.push(`Invalid stride mode: expected 'fixed', got ${manifest.encoding.stride_mode}`);
        }

        // Check cell count matches
        const cellEntries = zip.getEntries().filter(e => e.entryName.startsWith('vam-rgb/cell_'));
        if (cellEntries.length !== manifest.grid.cell_count) {
          errors.push(`Cell count mismatch: manifest says ${manifest.grid.cell_count}, found ${cellEntries.length}`);
        }
      }

      // Check reach-map
      const reachEntry = zip.getEntry('reach-map.json');
      if (reachEntry) {
        const reachMap = JSON.parse(reachEntry.getData().toString('utf8'));

        // Verify all cells have minimum gap
        for (const cell of reachMap.cells) {
          if (cell.gap < reachMap.min_gap_seconds) {
            errors.push(`Cell ${cell.index} has gap ${cell.gap}s, minimum is ${reachMap.min_gap_seconds}s`);
          }

          if (cell.stride !== 0.5) {
            errors.push(`Cell ${cell.index} has stride ${cell.stride}s, should be 0.5s`);
          }
        }
      }

      // Report results
      console.log(`Validating: ${pkgPath}`);
      console.log('');

      if (errors.length === 0 && warnings.length === 0) {
        console.log('✓ Package is valid');
      } else {
        if (errors.length > 0) {
          console.log('Errors:');
          for (const err of errors) {
            console.log(`  ✗ ${err}`);
          }
        }
        if (warnings.length > 0) {
          console.log('Warnings:');
          for (const warn of warnings) {
            console.log(`  ⚠ ${warn}`);
          }
        }
      }

      process.exit(errors.length > 0 ? 1 : 0);

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

/**
 * grid command
 */
program
  .command('grid <package>')
  .description('Generate grid image from VAM-RGB package')
  .option('-o, --output <path>', 'Output PNG path')
  .option('--columns <n>', 'Number of columns', '5')
  .action(async (pkg, options) => {
    try {
      const pkgPath = path.resolve(pkg);

      if (!fs.existsSync(pkgPath)) {
        console.error(`Error: Package not found: ${pkgPath}`);
        process.exit(1);
      }

      const outputPath = options.output
        ? path.resolve(options.output)
        : pkgPath.replace('.vamrgb.zip', '-grid.png');

      const { GridBuilder } = require('../grid/GridBuilder');
      const builder = new GridBuilder({ columns: parseInt(options.columns) });

      console.log(`Building grid from: ${pkgPath}`);
      const gridBuffer = await builder.buildFromPackage(pkgPath);

      fs.writeFileSync(outputPath, gridBuffer);
      console.log(`Grid saved: ${outputPath}`);

    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
