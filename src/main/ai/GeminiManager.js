// GeminiManager.js - Google Gemini 1.5 Flash integration
// v7.24: Video analysis via Google File API + Context Caching
// v7.25: Added audio analysis for full transcription
// v7.30: Added grid processor prompt plugin support

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { getGridProcessorPrompt } = require('./prompts/grid-prompts');

class GeminiManager {
  constructor() {
    this.apiKey = null;
    // v7.29: Updated default model (1.5-pro/flash deprecated)
    this.model = 'gemini-2.0-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com';

    // File upload state
    this.activeFile = null;       // Google File API URI
    this.activeVideoPath = null;  // Local video path
    this.cacheId = null;          // Context Cache ID for fast follow-ups
    this.cacheTTL = 3600;         // Cache TTL: 1 hour (seconds)

    // Upload progress callback
    this.onProgressUpdate = null;
  }

  // Initialize with API key
  // v7.29: Auto-migrate deprecated models
  init(apiKey, model) {
    this.apiKey = apiKey;
    if (model) {
      // Migrate deprecated models
      if (model === 'gemini-1.5-pro' || model === 'gemini-1.5-flash') {
        console.log(`[GeminiManager] Migrating deprecated model "${model}" to "gemini-2.0-flash"`);
        this.model = 'gemini-2.0-flash';
      } else {
        this.model = model;
      }
    }
    console.log(`[GeminiManager] Initialized with model: ${this.model}`);
  }

  // Check if configured
  isConfigured() {
    return this.apiKey !== null;
  }

  // Get/Set model
  getModel() { return this.model; }
  setModel(model) { this.model = model; }

  // Set progress callback
  setProgressCallback(callback) {
    this.onProgressUpdate = callback;
  }

  // Report progress to UI
  reportProgress(stage, message, progress = null) {
    if (this.onProgressUpdate) {
      this.onProgressUpdate({ stage, message, progress });
    }
    console.log(`[GeminiManager] ${stage}: ${message}`);
  }

  // ============================================
  // Main entry point - process user query
  // ============================================
  async processQuery(videoPath, userPrompt, conversationHistory = []) {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    // Check if we need to upload the video (new video or first query)
    const needsUpload = !this.activeFile || this.activeVideoPath !== videoPath;

    if (needsUpload) {
      this.reportProgress('upload', 'Uploading video to Google...', 0);

      // Upload video via File API
      this.activeFile = await this.uploadVideo(videoPath);
      this.activeVideoPath = videoPath;

      this.reportProgress('processing', 'Google is processing video...', 30);

      // Wait for video to become ACTIVE
      await this.waitForVideoActive(this.activeFile.name);

      this.reportProgress('caching', 'Creating context cache...', 80);

      // Create context cache for fast follow-ups
      this.cacheId = await this.createContextCache(this.activeFile);

      this.reportProgress('ready', 'Ready for questions', 100);
    }

    // Generate response
    const response = await this.generateResponse(userPrompt, conversationHistory);

    return {
      message: response.text,
      usage: response.usage,
      provider: 'gemini',
      cached: !needsUpload
    };
  }

  // ============================================
  // File API: Upload video
  // ============================================
  async uploadVideo(videoPath) {
    const fileName = path.basename(videoPath);
    const fileSize = fs.statSync(videoPath).size;
    const mimeType = this.getMimeType(videoPath);

    console.log(`[GeminiManager] Uploading: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

    // Step 1: Initialize resumable upload
    const initUrl = `${this.baseUrl}/upload/v1beta/files?key=${this.apiKey}`;

    const initResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: { display_name: fileName }
      })
    });

    if (!initResponse.ok) {
      const error = await initResponse.text();
      throw new Error(`Upload init failed: ${error}`);
    }

    const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
      throw new Error('No upload URL returned');
    }

    // Step 2: Upload file content
    const fileBuffer = fs.readFileSync(videoPath);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': mimeType
      },
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`Upload failed: ${error}`);
    }

    const fileInfo = await uploadResponse.json();
    console.log(`[GeminiManager] Upload complete: ${fileInfo.file?.name || 'unknown'}`);

    return fileInfo.file;
  }

  // ============================================
  // File API: Wait for video to be ACTIVE
  // ============================================
  async waitForVideoActive(fileName, maxWaitMs = 120000) {
    const startTime = Date.now();
    const pollInterval = 3000; // 3 seconds

    // fileName is already in "files/xxx" format, so we don't add "files/" prefix
    while (Date.now() - startTime < maxWaitMs) {
      const fileUrl = `${this.baseUrl}/v1beta/${fileName}?key=${this.apiKey}`;

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to check file status: ${response.status}`);
      }

      const fileInfo = await response.json();
      const state = fileInfo.state;

      console.log(`[GeminiManager] File state: ${state}`);

      if (state === 'ACTIVE') {
        return fileInfo;
      }

      if (state === 'FAILED') {
        throw new Error(`Video processing failed: ${fileInfo.error?.message || 'Unknown error'}`);
      }

      // Update progress
      const elapsed = Date.now() - startTime;
      const progress = Math.min(30 + (elapsed / maxWaitMs) * 50, 79);
      this.reportProgress('processing', `Processing video... (${Math.floor(elapsed / 1000)}s)`, progress);

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Timeout waiting for video processing');
  }

  // ============================================
  // Context Caching: Create cache for fast follow-ups
  // ============================================
  async createContextCache(fileInfo) {
    const cacheUrl = `${this.baseUrl}/v1beta/cachedContents?key=${this.apiKey}`;

    const systemPrompt = `あなたは動画分析の専門家です。
ユーザーの質問に対して、動画の内容を詳細に分析して回答してください。

【重要ルール】
1. タイムスタンプは必ず [MM:SS] 形式で出力（例: [01:23], [05:00]）
2. シーン変化を検出したら、そのタイムスタンプと内容を報告
3. 質問に関連する箇所のタイムスタンプを具体的に示す
4. 推測ではなく、実際に動画で確認できる内容のみ回答

【出力形式例】
[00:00] オープニング - タイトル表示
[01:30] 本編開始 - 説明シーン
[05:45] ハイライト - 重要な場面`;

    const requestBody = {
      model: `models/${this.model}`,
      displayName: `vamseek-${Date.now()}`,
      contents: [{
        role: 'user',
        parts: [{
          fileData: {
            fileUri: fileInfo.uri,
            mimeType: fileInfo.mimeType
          }
        }]
      }],
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      ttl: `${this.cacheTTL}s`
    };

    try {
      const response = await fetch(cacheUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        console.warn('[GeminiManager] Cache creation failed:', error);
        // Continue without cache - direct file reference will be used
        return null;
      }

      const cacheInfo = await response.json();
      console.log(`[GeminiManager] Cache created: ${cacheInfo.name}, TTL: ${this.cacheTTL}s`);

      return cacheInfo.name;
    } catch (err) {
      console.warn('[GeminiManager] Cache creation error:', err.message);
      return null;
    }
  }

  // ============================================
  // Generate response from Gemini
  // ============================================
  async generateResponse(userPrompt, conversationHistory = []) {
    let url, requestBody;

    if (this.cacheId) {
      // Use cached content (fast & cheap)
      url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      requestBody = {
        cachedContent: this.cacheId,
        contents: this.buildContents(userPrompt, conversationHistory),
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.2
        }
      };
    } else if (this.activeFile) {
      // Direct file reference (no cache)
      url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      requestBody = {
        contents: [{
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: this.activeFile.uri,
                mimeType: this.activeFile.mimeType
              }
            },
            { text: userPrompt }
          ]
        }],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.2
        }
      };
    } else {
      throw new Error('No video loaded');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = result.usageMetadata;

    console.log(`[GeminiManager] Response tokens - Input: ${usage?.promptTokenCount || 0}, Output: ${usage?.candidatesTokenCount || 0}`);

    return {
      text,
      usage: {
        input: usage?.promptTokenCount || 0,
        output: usage?.candidatesTokenCount || 0,
        cached: usage?.cachedContentTokenCount || 0
      }
    };
  }

  // Build conversation contents for Gemini
  buildContents(userPrompt, conversationHistory) {
    const contents = [];

    // Add history
    for (const msg of conversationHistory) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content?.find(c => c.type === 'text')?.text || '';

      if (text) {
        contents.push({ role, parts: [{ text }] });
      }
    }

    // Add current prompt
    contents.push({ role: 'user', parts: [{ text: userPrompt }] });

    return contents;
  }

  // ============================================
  // Utility functions
  // ============================================

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      '.m4v': 'video/x-m4v',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4'
    };
    return mimeTypes[ext] || 'video/mp4';
  }

  // Get ffmpeg binary path
  getFfmpegPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binName = 'ffmpeg' + ext;

    // Production: packaged app (resourcesPath)
    const prodPath = path.join(process.resourcesPath || '', 'bin', binName);
    // Development: project root
    const devPath = path.join(__dirname, '../../../bin', binName);

    if (fs.existsSync(prodPath)) return prodPath;
    if (fs.existsSync(devPath)) return devPath;
    return null;
  }

  // Clear cached state (call when switching videos)
  clearCache() {
    this.activeFile = null;
    this.activeVideoPath = null;
    this.cacheId = null;
    console.log('[GeminiManager] Cache cleared');
  }

  // ============================================
  // v7.25: Audio Analysis with Gemini
  // ============================================

  // Extract audio from video as mp3 (Gemini optimized: 16kHz, mono, 16kbps)
  async extractAudioForGemini(videoPath, startSec = null, endSec = null) {
    const ffmpeg = this.getFfmpegPath();
    if (!ffmpeg) {
      throw new Error('ffmpeg not found. Please install ffmpeg to bin/ directory.');
    }

    const tempDir = os.tmpdir();
    const mp3Path = path.join(tempDir, `vam_audio_${Date.now()}.mp3`);

    console.log(`[GeminiManager] Extracting audio: ${startSec !== null ? `${startSec}s - ${endSec}s` : 'full video'}`);

    return new Promise((resolve, reject) => {
      const args = [];

      // Add time range if specified
      if (startSec !== null && endSec !== null) {
        args.push('-ss', startSec.toString());
        args.push('-t', (endSec - startSec).toString());
      }

      args.push(
        '-i', videoPath,
        '-vn',              // No video
        '-ar', '16000',     // 16kHz sample rate (Gemini recommended)
        '-ac', '1',         // Mono
        '-b:a', '16k',      // 16kbps bitrate (Gemini recommended for speech)
        '-f', 'mp3',
        '-y',               // Overwrite
        mp3Path
      );

      const proc = spawn(ffmpeg, args, { windowsHide: true });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const fileSize = fs.statSync(mp3Path).size;
          console.log(`[GeminiManager] Audio extracted: ${mp3Path} (${(fileSize / 1024).toFixed(1)} KB)`);
          resolve(mp3Path);
        } else {
          reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`ffmpeg spawn error: ${err.message}`));
      });
    });
  }

  // Upload audio file to Google File API
  async uploadAudio(audioPath) {
    const fileName = path.basename(audioPath);
    const fileSize = fs.statSync(audioPath).size;
    const mimeType = 'audio/mpeg';

    console.log(`[GeminiManager] Uploading audio: ${fileName} (${(fileSize / 1024).toFixed(1)} KB)`);

    // Step 1: Initialize resumable upload
    const initUrl = `${this.baseUrl}/upload/v1beta/files?key=${this.apiKey}`;

    const initResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: { display_name: fileName }
      })
    });

    if (!initResponse.ok) {
      const error = await initResponse.text();
      throw new Error(`Audio upload init failed: ${error}`);
    }

    const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
      throw new Error('No upload URL returned');
    }

    // Step 2: Upload file content
    const fileBuffer = fs.readFileSync(audioPath);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': mimeType
      },
      body: fileBuffer
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`Audio upload failed: ${error}`);
    }

    const fileInfo = await uploadResponse.json();
    console.log(`[GeminiManager] Audio upload complete: ${fileInfo.file?.name || 'unknown'}`);

    // Clean up temp file
    try {
      fs.unlinkSync(audioPath);
    } catch (e) {
      console.warn('[GeminiManager] Failed to clean temp audio file:', e.message);
    }

    return fileInfo.file;
  }

  // Wait for audio file to be ACTIVE
  async waitForAudioActive(fileName, maxWaitMs = 60000) {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const fileUrl = `${this.baseUrl}/v1beta/${fileName}?key=${this.apiKey}`;

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to check audio file status: ${response.status}`);
      }

      const fileInfo = await response.json();
      const state = fileInfo.state;

      console.log(`[GeminiManager] Audio file state: ${state}`);

      if (state === 'ACTIVE') {
        return fileInfo;
      }

      if (state === 'FAILED') {
        throw new Error(`Audio processing failed: ${fileInfo.error?.message || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Timeout waiting for audio processing');
  }

  // Analyze audio with Gemini - full transcription with timestamps and keywords
  async analyzeAudio(videoPath, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    const { startSec = null, endSec = null } = options;

    this.reportProgress('upload', 'Extracting audio...', 0);

    // Step 1: Extract audio as mp3
    const mp3Path = await this.extractAudioForGemini(videoPath, startSec, endSec);

    this.reportProgress('upload', 'Uploading audio to Google...', 20);

    // Step 2: Upload to Google File API
    const audioFile = await this.uploadAudio(mp3Path);

    this.reportProgress('processing', 'Google is processing audio...', 50);

    // Step 3: Wait for audio to be ACTIVE
    await this.waitForAudioActive(audioFile.name);

    this.reportProgress('processing', 'Transcribing audio...', 70);

    // Step 4: Request transcription from Gemini
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // v7.29: Simplified prompt for readable summary with line breaks per timestamp
    const transcriptionPrompt = `この音声を要約形式で文字起こししてください。

【重要：出力形式】
各タイムスタンプごとに必ず改行を入れること！

[00:00] 内容の要約

[00:30] 次の内容

[01:15] さらに次

【ルール】
- 逐語訳ではなく内容を簡潔に要約
- 繰り返しは [MM:SS-MM:SS] でまとめる
- 重要な発言を優先、不要な部分は省略
- BGM・ノイズのみの区間は省略可

## キーワード
- 重要語: [MM:SS]`;

    const requestBody = {
      systemInstruction: {
        parts: [{
          text: `音声要約の専門家。読みやすさ最優先。

【絶対ルール】
1. 各タイムスタンプ後に改行を入れる
2. 逐語訳禁止、内容を1行要約
3. 繰り返しは時間範囲 [05:00-05:30] でまとめる`
        }]
      },
      contents: [{
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri: audioFile.uri,
              mimeType: audioFile.mimeType
            }
          },
          { text: transcriptionPrompt }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = result.usageMetadata;

    this.reportProgress('ready', 'Transcription complete', 100);

    console.log(`[GeminiManager] Audio analysis - Input: ${usage?.promptTokenCount || 0}, Output: ${usage?.candidatesTokenCount || 0}`);

    // Parse transcript to extract timestamps and keywords
    const transcript = this.parseTranscript(text, startSec || 0);

    return {
      text: text,
      transcript: transcript,
      usage: {
        input: usage?.promptTokenCount || 0,
        output: usage?.candidatesTokenCount || 0
      },
      provider: 'gemini'
    };
  }

  // v7.26: Analyze pre-extracted audio file directly (no ffmpeg needed)
  // Used with Python fast extraction (-c:a copy)
  async analyzeAudioDirect(audioPath, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    this.reportProgress('upload', 'Uploading audio to Google...', 10);

    // Step 1: Upload pre-extracted audio file
    const audioFile = await this.uploadAudio(audioPath);

    this.reportProgress('processing', 'Google is processing audio...', 40);

    // Step 2: Wait for audio to be ACTIVE
    await this.waitForAudioActive(audioFile.name);

    this.reportProgress('processing', 'Transcribing audio...', 70);

    // Step 3: Request transcription from Gemini
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // v7.29: Simplified prompt for readable summary with line breaks per timestamp
    const transcriptionPrompt = `この音声を要約形式で文字起こししてください。

【重要：出力形式】
各タイムスタンプごとに必ず改行を入れること！

[00:00] 内容の要約

[00:30] 次の内容

[01:15] さらに次

【ルール】
- 逐語訳ではなく内容を簡潔に要約
- 繰り返しは [MM:SS-MM:SS] でまとめる
- 重要な発言を優先、不要な部分は省略
- BGM・ノイズのみの区間は省略可

## キーワード
- 重要語: [MM:SS]`;

    const requestBody = {
      systemInstruction: {
        parts: [{
          text: `音声要約の専門家。読みやすさ最優先。

【絶対ルール】
1. 各タイムスタンプ後に改行を入れる
2. 逐語訳禁止、内容を1行要約
3. 繰り返しは時間範囲 [05:00-05:30] でまとめる`
        }]
      },
      contents: [{
        role: 'user',
        parts: [
          {
            fileData: {
              fileUri: audioFile.uri,
              mimeType: audioFile.mimeType
            }
          },
          { text: transcriptionPrompt }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = result.usageMetadata;

    this.reportProgress('ready', 'Transcription complete', 100);

    console.log(`[GeminiManager] Audio analysis (direct) - Input: ${usage?.promptTokenCount || 0}, Output: ${usage?.candidatesTokenCount || 0}`);

    // Parse transcript to extract timestamps and keywords
    const transcript = this.parseTranscript(text, 0);

    return {
      text: text,
      transcript: transcript,
      usage: {
        input: usage?.promptTokenCount || 0,
        output: usage?.candidatesTokenCount || 0
      },
      provider: 'gemini'
    };
  }

  // Parse transcript text to extract structured data
  parseTranscript(text, offsetSec = 0) {
    const lines = [];
    const keywords = [];

    // Parse transcript lines: [MM:SS] Speaker: Content
    const linePattern = /\[(\d{1,2}):(\d{2})\]\s*([^:：]+)?[:：]?\s*(.+)/g;
    let match;

    while ((match = linePattern.exec(text)) !== null) {
      const min = parseInt(match[1]);
      const sec = parseInt(match[2]);
      const totalSeconds = min * 60 + sec + offsetSec;
      const speaker = match[3]?.trim() || '';
      const content = match[4]?.trim() || '';

      lines.push({
        timestamp: `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`,
        seconds: totalSeconds,
        speaker: speaker,
        content: content
      });
    }

    // Parse keywords section
    const keywordSection = text.match(/##\s*重要キーワード([\s\S]*?)(?=##|$)/);
    if (keywordSection) {
      const keywordPattern = /-\s*([^:：]+)[:：]\s*(?:登場時間\s*)?\[?(\d{1,2}):(\d{2})\]?/g;
      while ((match = keywordPattern.exec(keywordSection[1])) !== null) {
        const min = parseInt(match[2]);
        const sec = parseInt(match[3]);
        const totalSeconds = min * 60 + sec + offsetSec;

        keywords.push({
          keyword: match[1].trim(),
          timestamp: `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`,
          seconds: totalSeconds
        });
      }
    }

    return { lines, keywords };
  }

  // ============================================
  // v7.33: Zoom Grid Analysis for Gemini
  // ============================================
  async analyzeZoomGrid(userMessage, zoomGridData, conversationHistory = []) {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const zoomStart = zoomGridData.zoomRange?.start || 0;
    const zoomEnd = zoomGridData.zoomRange?.end || 0;
    const totalCells = zoomGridData.totalCells || 0;
    const columns = zoomGridData.columns || 8;
    const timestampList = zoomGridData.timestampList || [];

    // Format time for display
    const formatTime = (sec) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const zoomStartStr = formatTime(zoomStart);
    const zoomEndStr = formatTime(zoomEnd);

    // Build timestamp info
    const tsInfo = timestampList.length > 0
      ? `\nセル配置(${columns}列):\n${timestampList.map((ts, i) => `[${i}]${ts}`).join(' ')}`
      : '';

    // v7.50: Fixed - must describe WHAT happens, not just WHEN
    const systemPrompt = `これは${zoomStartStr}～${zoomEndStr}の拡大画像（${totalCells}セル）です。
各セル左下のタイムスタンプを読み取り、この区間で「何が」「いつ」起きているかを報告せよ。
単なるタイムスタンプ列挙ではなく、動きの変化や重要なイベントを記述せよ。`;

    // Build contents with conversation history
    const contents = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      if (typeof msg.content === 'string') {
        contents.push({ role, parts: [{ text: msg.content }] });
      } else if (Array.isArray(msg.content)) {
        const parts = [];
        for (const item of msg.content) {
          if (item.type === 'image') {
            parts.push({
              inlineData: {
                mimeType: item.source.media_type,
                data: item.source.data
              }
            });
          } else if (item.type === 'text') {
            parts.push({ text: item.text });
          }
        }
        if (parts.length > 0) {
          contents.push({ role, parts });
        }
      }
    }

    // Build zoom message with image
    const userParts = [];

    if (zoomGridData.gridImage) {
      userParts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: zoomGridData.gridImage
        }
      });
    }

    userParts.push({
      text: `${zoomStartStr}-${zoomEndStr}/${totalCells}フレーム\n\n${userMessage}`
    });

    contents.push({ role: 'user', parts: userParts });

    const requestBody = {
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.2
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = result.usageMetadata;

    console.log(`[GeminiManager] Zoom analysis - Input: ${usage?.promptTokenCount || 0}, Output: ${usage?.candidatesTokenCount || 0}`);

    return {
      text,
      usage: {
        input: usage?.promptTokenCount || 0,
        output: usage?.candidatesTokenCount || 0,
        cached: 0
      }
    };
  }

  // ============================================
  // Grid Image Analysis (same as Claude mode)
  // v7.29: Added learnedRulesPrompt parameter for self-update feature
  // v7.30: Check if transcript already exists in conversation history
  // ============================================
  async analyzeGrid(userMessage, gridData, conversationHistory = [], learnedRulesPrompt = '') {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Get grid images
    const gridImages = gridData?.gridImages || (gridData?.gridImage ? [gridData.gridImage] : null);
    const isFirstMessage = conversationHistory.length === 0;

    // v7.30: Check if transcript exists in conversation history
    const hasTranscript = conversationHistory.some(
      msg => msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('[AUDIO_TRANSCRIPT_REQUEST]')
    );

    // Build system prompt for grid analysis (with learned rules + transcript status)
    const systemPrompt = this.buildGridSystemPrompt(gridData, learnedRulesPrompt, hasTranscript);

    // Build contents
    const contents = [];

    // Add conversation history
    for (const msg of conversationHistory) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      if (typeof msg.content === 'string') {
        contents.push({ role, parts: [{ text: msg.content }] });
      } else if (Array.isArray(msg.content)) {
        // Convert Claude format to Gemini format
        const parts = [];
        for (const item of msg.content) {
          if (item.type === 'image') {
            parts.push({
              inlineData: {
                mimeType: item.source.media_type,
                data: item.source.data
              }
            });
          } else if (item.type === 'text') {
            parts.push({ text: item.text });
          }
        }
        if (parts.length > 0) {
          contents.push({ role, parts });
        }
      }
    }

    // Build new user message
    let userParts = [];

    if (isFirstMessage && gridImages && gridImages.length > 0) {
      // First message: include grid images
      const durationMin = Math.ceil(gridData.duration / 60);
      const totalCells = gridData.totalCells || 0;
      const imageCount = gridImages.length;
      const imageNote = imageCount > 1 ? `（${imageCount}枚）` : '';
      const jabText = `${durationMin}分/${totalCells}フレーム${imageNote}\n\n${userMessage}`;

      // Add images
      for (const img of gridImages) {
        userParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: img
          }
        });
      }
      // Add text
      userParts.push({ text: jabText });
    } else if (isFirstMessage) {
      userParts.push({ text: `[No grid image available]\n\n${userMessage}` });
    } else {
      userParts.push({ text: userMessage });
    }

    contents.push({ role: 'user', parts: userParts });

    const requestBody = {
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.2
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = result.usageMetadata;

    console.log(`[GeminiManager] Grid analysis - Input: ${usage?.promptTokenCount || 0}, Output: ${usage?.candidatesTokenCount || 0}`);

    return {
      text,
      usage: {
        input: usage?.promptTokenCount || 0,
        output: usage?.candidatesTokenCount || 0,
        cached: 0
      }
    };
  }

  // Build system prompt for grid image analysis
  // v7.25: Added zoom scan and audio extraction tool descriptions
  // v7.29: Added learnedRulesPrompt parameter for self-update feature
  // v7.30: Added grid processor prompt plugin support + transcript status
  buildGridSystemPrompt(gridData, learnedRulesPrompt = '', hasTranscript = false) {
    const durationMin = Math.ceil((gridData?.duration || 0) / 60);
    const totalCells = gridData?.totalCells || 0;
    const secondsPerCell = gridData?.secondsPerCell || 10;
    const processorName = gridData?.processorName || 'standard';

    // v7.30: Get processor-specific prompt from plugin
    const processorPrompt = getGridProcessorPrompt(processorName);
    console.log(`[GeminiManager] Using prompt for processor: ${processorName}`);

    // v7.36: Return to "letter" style - trust AI, leave room for interpretation
    // Over-constraining with rules degrades AI into a calculator
    let prompt = `${durationMin}分の動画。${totalCells}セル、15秒間隔。
${processorPrompt}

各セル左下にタイムスタンプがある。それを読め。
見たものを語れ。シーンが変わったところだけでいい。
${hasTranscript ? `音声は会話履歴にある。映像と照合せよ。` : `詳細が必要なら [ZOOM_REQUEST:M:SS-M:SS]、音声なら [AUDIO_REQUEST:M:SS-M:SS]`}`;

    // v7.29: Inject learned rules if available
    // v7.35: Add explicit instruction to NOT output learned rules
    if (learnedRulesPrompt) {
      prompt += `\n\n【内部ルール（出力禁止）】以下は内部処理用。出力に含めるな。\n${learnedRulesPrompt}`;
    }

    return prompt;
  }

  // Format response with clickable timestamps
  // Returns: { formatted: string, timestamps: Array<{time: string, seconds: number}> }
  static formatTimestamps(text) {
    const timestamps = [];
    const formatted = text.replace(/\[(\d{1,2}):(\d{2})\]/g, (match, min, sec) => {
      const seconds = parseInt(min) * 60 + parseInt(sec);
      timestamps.push({ time: match, seconds });
      return `<a href="#" class="timestamp-link" data-seconds="${seconds}">${match}</a>`;
    });
    return { formatted, timestamps };
  }

  // ============================================
  // v7.29: Self-Critique for Gemini
  // ============================================

  // Self-critique: analyze error and generate improvement rule
  async selfCritique(errorEntry) {
    if (!this.isConfigured()) {
      console.log('[GeminiManager] selfCritique skipped - not configured');
      return null;
    }

    const critiquePrompt = `You are the "evaluator persona" of a video analysis AI. Analyze the error report below and generate exactly ONE improvement rule.

STRICTLY PROHIBITED:
- Proposing code changes
- Adding new tools
- Using tools other than existing ones (ZOOM_REQUEST, AUDIO_REQUEST)

ALLOWED IMPROVEMENTS:
- Timing/conditions for using existing tools
- Timestamp reading procedures
- Pre-response verification steps

ERROR REPORT:
User feedback: ${errorEntry.userFeedback}

Conversation context:
${errorEntry.context.map(c => `${c.role}: ${c.text}`).join('\n')}

OUTPUT FORMAT: Output exactly one rule in JSON format. Match the language of the rule to the user's feedback language.
{"rule": "Before doing X, always verify Y first", "category": "timestamp|zoom|audio|general"}`;

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [{
        role: 'user',
        parts: [{ text: critiquePrompt }]
      }],
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.1
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
      }

      const result = await response.json();
      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const newRule = JSON.parse(jsonMatch[0]);
        console.log('[GeminiManager] New rule generated:', newRule.rule);
        return newRule;
      }
    } catch (err) {
      console.error('[GeminiManager] selfCritique failed:', err.message);
    }

    return null;
  }
}

module.exports = GeminiManager;
