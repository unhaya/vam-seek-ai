/**
 * html-to-pdf.js - Convert HTML to PDF using Electron's built-in Chromium
 *
 * Usage: npx electron scripts/html-to-pdf.js <input.html> [output.pdf]
 *
 * Uses Electron's BrowserWindow.webContents.printToPDF() for high-quality
 * PDF generation with MathJax support.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
// When run via `npx electron`, the script path is in argv
const inputHtml = args.find(a => a.endsWith('.html')) || args[0];
const outputPdf = args.find(a => a.endsWith('.pdf')) || (inputHtml ? inputHtml.replace('.html', '.pdf') : null);

if (!inputHtml) {
  console.error('Usage: npx electron scripts/html-to-pdf.js <input.html> [output.pdf]');
  app.exit(1);
}

const inputPath = path.resolve(inputHtml);
const outputPath = path.resolve(outputPdf);

if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  console.log(`[html-to-pdf] Input:  ${inputPath}`);
  console.log(`[html-to-pdf] Output: ${outputPath}`);

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await win.loadFile(inputPath);

  // Wait for MathJax to finish rendering
  console.log('[html-to-pdf] Waiting for MathJax rendering...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      marginsType: 0,       // Default margins
      pageSize: 'A4',
      landscape: false
    });

    fs.writeFileSync(outputPath, pdfData);
    console.log(`[html-to-pdf] PDF created: ${outputPath} (${pdfData.length} bytes)`);
  } catch (err) {
    console.error('[html-to-pdf] Failed:', err.message);
  }

  app.exit(0);
});
