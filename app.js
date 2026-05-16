(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const BUCKET           = 'farmer-videos';
  const TABLE            = 'farmer_submissions';
  const MAX_DURATION_SEC = 90;
  const VIDEO_BITRATE    = 2_000_000; // 2 Mbps — keeps 90s video under ~50 MB
  const QUESTIONS_URL    = '../questions/questions.json';

  // ── State ────────────────────────────────────────────────────────────────
  let farmerId        = null;
  let questions       = [];
  let currentQuestion = null;
  let mediaStream     = null;
  let mediaRecorder   = null;
  let recordedChunks  = [];
  let recordedBlob    = null;
  let mimeType        = 'video/webm';
  let countdownTimer  = null;
  let elapsedSeconds  = 0;
  let supabaseClient  = null;

  // ── Startup ──────────────────────────────────────────────────────────────
  async function init() {
    const params = new URLSearchParams(window.location.search);
    const rawId  = params.get('id');

    // In production: no id = hard stop
    // During dev: fall back to test_001 so you can run without a real link
    if (!rawId) {
      // ── Toggle this block for production ──────────────────────────────
      // showError('This link is not valid. Please contact your coordinator.');
      // return;
      // ─────────────────────────────────────────────────────────────────
      farmerId = 'test_001';
    } else {
      farmerId = rawId;
    }

    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      showError('App is not configured. Please contact your coordinator.');
      return;
    }

    supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    mimeType = detectMimeType();

    showLoading();

    const loaded = await loadQuestions();
    if (!loaded) return;

    const cameraReady = await initCamera();
    if (!cameraReady) return;

    showReady();
  }

  // ── Mime type detection ──────────────────────────────────────────────────
  // Prefer MP4 (iOS Safari), fall back to WebM variants
  function detectMimeType() {
    const candidates = [
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
  }

  function fileExtension() {
    return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  // ── Questions ────────────────────────────────────────────────────────────
  async function loadQuestions() {
    try {
      const res = await fetch(QUESTIONS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      questions = await res.json();
      if (!questions.length) throw new Error('Empty question list');
      currentQuestion = questions[0]; // Phase 1: always q1
      return true;
    } catch (err) {
      showError('Could not load questions. Please try again later.');
      return false;
    }
  }

  // ── Camera ───────────────────────────────────────────────────────────────
  async function initCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // rear camera preferred
          width:  { ideal: 720  },
          height: { ideal: 1280 },
        },
        audio: true,
      });
      // Best-effort portrait lock — not supported on all browsers
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
      }
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showError('Camera access was denied. Please allow camera access and reload the page.');
      } else {
        showError('Could not access your camera. Please check that it is not in use by another app.');
      }
      return false;
    }
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  function render(html) {
    document.getElementById('app').innerHTML = html;
  }

  function showLoading() {
    render(`
      <div class="screen screen--loading">
        <div class="spinner"></div>
        <p>Loading…</p>
      </div>
    `);
  }

  function showError(msg) {
    render(`
      <div class="screen screen--error">
        <div class="error-icon">⚠</div>
        <p class="error-msg">${msg}</p>
      </div>
    `);
  }

  function showReady() {
    render(`
      <div class="screen screen--ready">
        <div class="question-card">
          <p class="question-label">Your question</p>
          <p class="question-text">${currentQuestion.text_prompt}</p>
        </div>
        <div class="preview-wrap">
          <video id="preview" autoplay muted playsinline></video>
        </div>
        <button class="btn btn--record" id="startBtn">Tap to start recording</button>
        <p class="hint">Maximum ${MAX_DURATION_SEC} seconds</p>
      </div>
    `);
    document.getElementById('preview').srcObject = mediaStream;
    document.getElementById('startBtn').addEventListener('click', startRecording);
  }

  function showRecording() {
    render(`
      <div class="screen screen--recording">
        <div class="recording-header">
          <span class="rec-dot"></span>
          <span class="rec-label">REC</span>
          <span class="countdown" id="countdown">${MAX_DURATION_SEC}s</span>
        </div>
        <div class="preview-wrap">
          <video id="preview" autoplay muted playsinline></video>
        </div>
        <button class="btn btn--stop" id="stopBtn">Stop</button>
      </div>
    `);
    document.getElementById('preview').srcObject = mediaStream;
    document.getElementById('stopBtn').addEventListener('click', stopRecording);
  }

  function showReview() {
    const sizeMB    = (recordedBlob.size / 1024 / 1024).toFixed(1);
    const objectUrl = URL.createObjectURL(recordedBlob);

    render(`
      <div class="screen screen--review">
        <div class="question-card">
          <p class="question-label">Review your response</p>
          <p class="question-text">${currentQuestion.text_prompt}</p>
        </div>
        <div class="preview-wrap">
          <video id="playback" controls playsinline></video>
        </div>
        <p class="file-size">File size: ~${sizeMB} MB</p>
        <div class="review-actions">
          <button class="btn btn--secondary" id="rerecordBtn">Re-record</button>
          <button class="btn btn--upload" id="uploadBtn">Upload</button>
        </div>
      </div>
    `);

    // Set src after render so the element exists
    document.getElementById('playback').src = objectUrl;
    document.getElementById('rerecordBtn').addEventListener('click', () => {
      URL.revokeObjectURL(objectUrl);
      reRecord();
    });
    document.getElementById('uploadBtn').addEventListener('click', () => {
      URL.revokeObjectURL(objectUrl);
      uploadVideo();
    });
  }

  function showUploading() {
    render(`
      <div class="screen screen--uploading">
        <p class="upload-label">Uploading your response…</p>
        <div class="progress-bar-wrap">
          <div class="progress-bar" id="progressBar"></div>
        </div>
        <p class="upload-hint">Please stay on this page until the upload is complete.</p>
      </div>
    `);
  }

  function showUploadError(msg) {
    render(`
      <div class="screen screen--error">
        <div class="error-icon">⚠</div>
        <p class="error-msg">Upload failed: ${msg}</p>
        <button class="btn btn--secondary" id="retryBtn" style="margin-top:16px">Try again</button>
      </div>
    `);
    document.getElementById('retryBtn').addEventListener('click', showReview);
  }

  function showSuccess() {
    // Release camera tracks once we're done
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());

    render(`
      <div class="screen screen--success">
        <div class="success-icon">✓</div>
        <h1>Thank you!</h1>
        <p>Your response has been recorded successfully.</p>
      </div>
    `);
  }

  // ── Recording ────────────────────────────────────────────────────────────
  function startRecording() {
    recordedChunks = [];
    elapsedSeconds = 0;

    try {
      mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITRATE,
      });
    } catch {
      // Fallback: let browser choose mimeType but still cap bitrate
      mediaRecorder = new MediaRecorder(mediaStream, { videoBitsPerSecond: VIDEO_BITRATE });
    }

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      clearInterval(countdownTimer);
      recordedBlob = new Blob(recordedChunks, { type: mimeType });
      showReview();
    };

    mediaRecorder.start(1000); // collect a chunk every second
    showRecording();

    countdownTimer = setInterval(() => {
      elapsedSeconds++;
      const remaining = MAX_DURATION_SEC - elapsedSeconds;
      const el = document.getElementById('countdown');
      if (el) el.textContent = `${remaining}s`;
      if (remaining <= 0) stopRecording();
    }, 1000);
  }

  function stopRecording() {
    clearInterval(countdownTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  function reRecord() {
    recordedChunks = [];
    recordedBlob   = null;
    showReady();
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  async function uploadVideo() {
    showUploading();

    const ext       = fileExtension();
    const timestamp = Date.now();
    const filePath  = `${farmerId}/${currentQuestion.id}_${timestamp}.${ext}`;

    // Supabase JS v2 doesn't expose upload progress events, so we animate
    // a simulated bar up to 90% and snap to 100% on success.
    let fakeProgress  = 0;
    const progressBar = () => document.getElementById('progressBar');
    const ticker = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + 4, 90);
      const bar = progressBar();
      if (bar) bar.style.width = fakeProgress + '%';
    }, 300);

    try {
      const { error: uploadError } = await supabaseClient.storage
        .from(BUCKET)
        .upload(filePath, recordedBlob, {
          contentType: mimeType,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabaseClient.storage
        .from(BUCKET)
        .getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;

      const { error: dbError } = await supabaseClient
        .from(TABLE)
        .insert({
          farmer_id:   farmerId,
          country:     null, // populated downstream via farmer-master.csv lookup
          question_id: currentQuestion.id,
          video_path:  filePath,
          video_url:   publicUrl,
          status:      'received',
        });
      if (dbError) throw dbError;

      clearInterval(ticker);
      const bar = progressBar();
      if (bar) bar.style.width = '100%';

      setTimeout(showSuccess, 400);

    } catch (err) {
      clearInterval(ticker);
      console.error('[webcap] upload error:', err);
      showUploadError(err.message || 'Unknown error. Please try again.');
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
