// Whisper Service - Audio transcription using whisper.cpp
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Binary paths (switch between dev and packaged)
function getBinPath(name) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binName = name + ext;

  // Production: packaged app (resourcesPath)
  const prodPath = path.join(process.resourcesPath || '', 'bin', binName);
  // Development: project root
  const devPath = path.join(__dirname, '../../bin', binName);

  if (fs.existsSync(prodPath)) return prodPath;
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

function getModelPath() {
  // Production
  const prodPath = path.join(process.resourcesPath || '', 'models', 'ggml-base.bin');
  // Development
  const devPath = path.join(__dirname, '../../models', 'ggml-base.bin');

  if (fs.existsSync(prodPath)) return prodPath;
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

// Get whisper CLI path (try multiple names)
function getWhisperCliPath() {
  // whisper.cppの新しいCLI名を優先
  const names = ['whisper-cli', 'whisper-whisper', 'main', 'whisper'];
  for (const name of names) {
    const binPath = getBinPath(name);
    if (binPath) return binPath;
  }
  return null;
}

// Check if whisper is available
function isAvailable() {
  const ffmpeg = getBinPath('ffmpeg');
  const whisper = getWhisperCliPath();
  const model = getModelPath();

  const available = !!(ffmpeg && whisper && model);
  if (!available) {
    console.log('[Whisper] Not available:');
    console.log(`  ffmpeg: ${ffmpeg || 'NOT FOUND'}`);
    console.log(`  whisper: ${whisper || 'NOT FOUND'}`);
    console.log(`  model: ${model || 'NOT FOUND'}`);
  }
  return available;
}

// Get status info for settings UI
function getStatus() {
  const ffmpeg = getBinPath('ffmpeg');
  const whisper = getBinPath('whisper');
  const model = getModelPath();

  return {
    available: !!(ffmpeg && whisper && model),
    ffmpeg: ffmpeg ? 'OK' : 'Missing',
    whisper: whisper ? 'OK' : 'Missing',
    model: model ? 'OK' : 'Missing'
  };
}

// Extract audio segment using ffmpeg
async function extractAudio(videoPath, startSec, endSec) {
  const ffmpeg = getBinPath('ffmpeg');
  if (!ffmpeg) {
    throw new Error('ffmpeg not found');
  }

  const tempDir = os.tmpdir();
  const wavPath = path.join(tempDir, `vam_audio_${Date.now()}.wav`);
  const duration = endSec - startSec;

  console.log(`[Whisper] Extracting audio: ${startSec}s - ${endSec}s (${duration}s)`);

  return new Promise((resolve, reject) => {
    const args = [
      '-ss', startSec.toString(),
      '-i', videoPath,
      '-t', duration.toString(),
      '-ar', '16000',         // 16kHz (Whisper requirement)
      '-ac', '1',             // Mono
      '-acodec', 'pcm_s16le', // 16bit PCM (whisper.cpp requirement)
      '-f', 'wav',
      '-y',                   // Overwrite
      wavPath
    ];

    const proc = spawn(ffmpeg, args, { windowsHide: true });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Whisper] Audio extracted: ${wavPath}`);
        resolve(wavPath);
      } else {
        reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });
  });
}

// Transcribe audio using whisper.cpp
async function transcribeAudio(wavPath, language = 'auto') {
  const whisper = getWhisperCliPath();
  const model = getModelPath();

  if (!whisper) throw new Error('whisper CLI not found (tried: whisper-cli, whisper-whisper, main, whisper)');
  if (!model) throw new Error('whisper model not found');

  console.log(`[Whisper] Transcribing: ${wavPath}`);

  return new Promise((resolve, reject) => {
    // whisper.cpp CLI arguments (main.exe style)
    const args = [
      '-m', model,
      '-f', wavPath,
      '-nt'                // No timestamps
    ];
    // 言語指定（autoの場合は日本語をデフォルトに - baseモデルの自動検出精度が低いため）
    if (language === 'auto') {
      args.push('-l', 'ja');  // Default to Japanese
    } else {
      args.push('-l', language);
    }

    console.log(`[Whisper] Running: ${whisper} ${args.join(' ')}`);
    const proc = spawn(whisper, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Timeout: 60 seconds max (prevent freeze)
    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
      console.error('[Whisper] Process killed due to timeout (60s)');
    }, 60000);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      // Clean up temp file
      try {
        if (fs.existsSync(wavPath)) {
          fs.unlinkSync(wavPath);
        }
      } catch (e) {
        console.warn('[Whisper] Failed to clean temp file:', e.message);
      }

      // デバッグ出力
      console.log(`[Whisper] Exit code: ${code}`);
      console.log(`[Whisper] stdout: ${stdout.slice(0, 500)}`);
      console.log(`[Whisper] stderr: ${stderr.slice(0, 500)}`);

      if (killed) {
        reject(new Error('Whisper transcription timed out (60s)'));
      } else if (code === 0) {
        // whisper.cpp outputs to stdout
        const transcript = stdout.trim();
        console.log(`[Whisper] Transcription complete: ${transcript.length} chars`);
        resolve(transcript);
      } else {
        // stderrが空の場合はstdoutも確認
        const errorInfo = stderr || stdout || 'Unknown error';
        console.error('[Whisper] Error:', errorInfo);
        reject(new Error(`whisper failed (code ${code}): ${errorInfo.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`whisper spawn error: ${err.message}`));
    });
  });
}

// Main function: transcribe a video segment
async function transcribeSegment(videoPath, startSec, endSec, options = {}) {
  const { language = 'auto' } = options;

  if (!isAvailable()) {
    throw new Error('Whisper is not available. Please install ffmpeg and whisper.cpp binaries.');
  }

  // Validate time range
  if (startSec >= endSec) {
    throw new Error(`Invalid time range: ${startSec} - ${endSec}`);
  }

  // Limit segment length (max 5 minutes for performance)
  const maxDuration = 300;
  if (endSec - startSec > maxDuration) {
    console.warn(`[Whisper] Segment too long, limiting to ${maxDuration}s`);
    endSec = startSec + maxDuration;
  }

  try {
    // Step 1: Extract audio
    const wavPath = await extractAudio(videoPath, startSec, endSec);

    // Step 2: Transcribe
    const transcript = await transcribeAudio(wavPath, language);

    return {
      success: true,
      transcript: transcript,
      startTime: startSec,
      endTime: endSec,
      duration: endSec - startSec
    };
  } catch (err) {
    console.error('[Whisper] Transcription failed:', err.message);
    return {
      success: false,
      error: err.message,
      startTime: startSec,
      endTime: endSec
    };
  }
}

// Format time for display
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

module.exports = {
  isAvailable,
  getStatus,
  transcribeSegment,
  formatTime
};
