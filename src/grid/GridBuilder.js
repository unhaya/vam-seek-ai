/**
 * GridBuilder - VAM-RGB v3.0
 *
 * Combines individual cell PNGs into a single grid image.
 */

const sharp = require('sharp');

class GridBuilder {

  constructor(config = {}) {
    this.cellSize = config.cellSize || 256;
    this.columns = config.columns || 5;
  }

  /**
   * Build grid image from encoded cells
   * @param {Array} cells - Array of {pngBuffer, index, ...}
   * @returns {Promise<Buffer>} - PNG buffer of grid
   */
  async build(cells) {
    if (cells.length === 0) {
      throw new Error('No cells to build grid');
    }

    const cols = this.columns;
    const rows = Math.ceil(cells.length / cols);
    const width = cols * this.cellSize;
    const height = rows * this.cellSize;

    console.log(`[GridBuilder] Building ${cols}x${rows} grid (${width}x${height}px)`);

    // Create composite operations
    const composites = [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const col = i % cols;
      const row = Math.floor(i / cols);

      composites.push({
        input: cell.pngBuffer,
        left: col * this.cellSize,
        top: row * this.cellSize
      });
    }

    // Create blank canvas and composite all cells
    const gridBuffer = await sharp({
      create: {
        width: width,
        height: height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .composite(composites)
      .png()
      .toBuffer();

    console.log(`[GridBuilder] Grid created: ${(gridBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    return gridBuffer;
  }

  /**
   * Build grid from .vamrgb.zip package
   * @param {string} packagePath
   * @returns {Promise<Buffer>}
   */
  async buildFromPackage(packagePath) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(packagePath);

    // Get all cell PNGs sorted by index
    const cellEntries = zip.getEntries()
      .filter(e => e.entryName.startsWith('vam-rgb/cell_') && e.entryName.endsWith('.png'))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    const cells = cellEntries.map((entry, index) => ({
      pngBuffer: entry.getData(),
      index: index
    }));

    return this.build(cells);
  }
}

module.exports = { GridBuilder };
