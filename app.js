(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const BUCKET               = 'farmer-videos';
  const TABLE                = 'farmer_submissions';
  const MAX_DURATION_SEC     = 90;
  const VIDEO_BITRATE        = 2_000_000; // 2 Mbps — keeps 90s video under ~50 MB
  const QUESTIONS_URL        = '/questions/questions.json';
  const SUPPORTED_LANGS      = ['en', 'am', 'sw', 'fr', 'pt', 'es'];
  const DEFAULT_LANG         = 'en';
  const COUNTRY_OPTIONS      = ['Ethiopia', 'Kenya', 'India', 'Colombia', 'Other'];

  // ── State ────────────────────────────────────────────────────────────────
  let farmerId        = null;
  let farmerName      = null;
  let farmerCountry   = null;
  let farmerPhone     = null;
  let farmerLang      = DEFAULT_LANG;
  let consentGiven    = null;
  let consentTime     = null;
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
  let cameraFacingMode = 'user'; // 'user' = front/selfie, 'environment' = back
  let isReturningFarmer = false; // Track if farmer has existing submission

  // ── Startup ──────────────────────────────────────────────────────────────
  async function init() {
    console.log('[webcap] build marker: no-created-at-query-2026-05-28');

    const params = new URLSearchParams(window.location.search);
    // Support both ?id= and ?farmer_id= URL param names
    const urlFarmerId = params.get('id') || params.get('farmer_id') || null;
    farmerId      = urlFarmerId || 'test_001';
    farmerName    = params.get('name') || null;
    farmerCountry = params.get('country') || null;
    farmerPhone   = params.get('phone') || null;
    const urlLang = params.get('lang') || DEFAULT_LANG;
    farmerLang    = SUPPORTED_LANGS.includes(urlLang) ? urlLang : DEFAULT_LANG;

    // (a) Log what params were read from URL
    console.log('[webcap] URL params:', {
      urlFarmerId,
      farmerId,
      farmerName,
      farmerCountry,
      farmerPhone,
      farmerLang,
      rawSearch: window.location.search,
    });

    // Fetch Supabase config from API endpoint
    try {
      const configRes = await fetch('/api/config');
      if (!configRes.ok) throw new Error(`Config API returned ${configRes.status}`);
      const config = await configRes.json();

      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        throw new Error('Config missing: supabaseUrl=' + !!config.supabaseUrl + ' supabaseAnonKey=' + !!config.supabaseAnonKey);
      }

      console.log('[webcap] Config loaded OK from /api/config');
      window.SUPABASE_URL = config.supabaseUrl;
      window.SUPABASE_ANON_KEY = config.supabaseAnonKey;
    } catch (err) {
      console.error('[webcap] Failed to load config:', err);
      showError('App is not configured. Please contact your coordinator.');
      return;
    }

    supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    mimeType = detectMimeType();

    showLoading();

    const loaded = await loadQuestions();
    if (!loaded) return;

    // Check for returning farmer (existing submission).
    // Only run lookup if farmer_id or phone was explicitly in the URL.
    const shouldCheckSubmission = !!(urlFarmerId || farmerPhone);
    console.log('[webcap] shouldCheckSubmission:', shouldCheckSubmission,
      '— urlFarmerId:', urlFarmerId, '— farmerPhone:', farmerPhone);

    if (shouldCheckSubmission) {
      // 5-second timeout guards against Supabase hangs
      const existingSubmission = await Promise.race([
        checkExistingSubmission(farmerId, farmerPhone),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]);

      // (b) Log what Supabase returned
      console.log('[webcap] Supabase lookup result:', existingSubmission);

      if (existingSubmission) {
        // Pre-fill state from most-recent submission
        farmerName    = existingSubmission.farmer_name    || farmerName;
        farmerCountry = existingSubmission.farmer_country || farmerCountry;
        farmerPhone   = existingSubmission.farmer_phone   || farmerPhone;
        consentGiven  = existingSubmission.consent_given;
        consentTime   = existingSubmission.consent_timestamp;
        isReturningFarmer = true;

        if (consentGiven === true) {
          // Already consented — skip registry + consent, go straight to recording
          console.log('[webcap] Routing → camera → question (returning, consent=true)');
          const cameraReady = await initCamera();
          if (!cameraReady) return;
          showQuestion();
        } else {
          // consent_given is false or null — show pre-filled registry then consent
          console.log('[webcap] Routing → registry confirm (returning, consent=' + consentGiven + ')');
          showRegistryConfirm();
        }
        return;
      }

      console.log('[webcap] No existing submission found — treating as new farmer');
    }

    // New farmer: standard flow — registry → consent → question → record → upload
    if (farmerName && farmerCountry) {
      console.log('[webcap] Routing → registry confirm (URL pre-fill)');
      showRegistryConfirm();
    } else {
      console.log('[webcap] Routing → registry form (blank)');
      showRegistryForm();
    }
  }

  async function checkExistingSubmission(id, phone) {
    if (!supabaseClient) {
      console.warn('[webcap] checkExistingSubmission: supabaseClient not ready');
      return null;
    }
    try {
      const safeReturningFarmerFields =
        'farmer_id, farmer_name, farmer_country, farmer_phone, consent_given, consent_timestamp';

      // ── Query by farmer_id using only schema-safe fields ─────────────────
      if (id) {
        console.log('[webcap] Querying farmer_submissions WHERE farmer_id =', id);
        const { data, error } = await supabaseClient
          .from(TABLE)
          .select(safeReturningFarmerFields)
          .eq('farmer_id', id)
          .not('consent_given', 'is', null)
          .limit(1);

        console.log('[webcap] farmer_id query →', { data, error });
        if (error) throw error;
        if (data && data.length > 0) return data[0];
      }

      // ── Fallback: query by phone ──────────────────────────────────────────
      if (phone) {
        console.log('[webcap] Querying farmer_submissions WHERE farmer_phone =', phone);
        const { data, error } = await supabaseClient
          .from(TABLE)
          .select(safeReturningFarmerFields)
          .eq('farmer_phone', phone)
          .not('consent_given', 'is', null)
          .limit(1);

        console.log('[webcap] phone query →', { data, error });
        if (error) throw error;
        if (data && data.length > 0) return data[0];
      }

      console.log('[webcap] No rows found for farmer_id:', id, '/ phone:', phone);
      return null;
    } catch (err) {
      console.error('[webcap] checkExistingSubmission error:', err);
      return null;
    }
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

  // ── Language & Audio ──────────────────────────────────────────────────────
  function getAudioPath(type, id, lang) {
    // type: 'consent' or 'question'
    // id: null for consent, 'q1' etc for questions
    const filename = type === 'consent'
      ? `consent_${lang}.m4a`
      : `${id}_${lang}.m4a`;
    const folder = type === 'consent' ? 'consent' : 'questions';
    return `audio/${folder}/${filename}`;
  }

  function playAudio(path, onEnd) {
    const audio = new Audio(path);
    let isPlaying = false;

    audio.onerror = () => {
      // Fallback to English if language file missing
      if (!path.includes('_en.m4a')) {
        const fallback = path.replace(/_[a-z]+\.m4a$/, '_en.m4a');
        playAudio(fallback, onEnd);
      } else if (onEnd) {
        onEnd();
      }
    };

    audio.onended = () => {
      isPlaying = false;
      if (onEnd) onEnd();
    };

    audio.play().catch(() => {
      // Autoplay blocked — show manual play button
      showPlayButton(audio, () => {
        isPlaying = false;
        if (onEnd) onEnd();
      });
    });
    isPlaying = true;
  }

  function showPlayButton(audio, onEnd) {
    const btn = document.getElementById('playBtn');
    if (!btn) return;
    btn.style.display = 'block';
    btn.onclick = () => {
      btn.style.display = 'none';
      audio.play().catch(() => {});
    };
  }

  // ── Camera ───────────────────────────────────────────────────────────────
  async function initCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: cameraFacingMode }, // 'user' = front, 'environment' = back
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

  async function switchCamera() {
    // Toggle between front and back cameras
    cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';

    // Stop current stream
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
    }

    // Reinitialize with new camera
    const cameraReady = await initCamera();
    if (!cameraReady) {
      // If switch fails, toggle back
      cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
      return;
    }

    // Update preview
    const preview = document.getElementById('preview');
    if (preview) {
      preview.srcObject = mediaStream;
    }
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  function render(html) {
    document.getElementById('app').innerHTML = html;
  }

  function setupCameraToggle() {
    const btn = document.getElementById('cameraToggleBtn');
    if (btn) {
      btn.addEventListener('click', switchCamera);
    }
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

  // ── Registry Screen ────────────────────────────────────────────────────────
  function showRegistryForm() {
    const countryOpts = COUNTRY_OPTIONS
      .map(c => `<option value="${c}">${c}</option>`)
      .join('');

    render(`
      <div class="screen screen--registry">
        <div class="card">
          <h2>Welcome! Let's get started.</h2>
          <p>Please enter your details:</p>
          <div class="form-group">
            <label for="nameInput">Name *</label>
            <input type="text" id="nameInput" placeholder="Your name" required>
          </div>
          <div class="form-group">
            <label for="countrySelect">Country</label>
            <select id="countrySelect">
              <option value="">Select country...</option>
              ${countryOpts}
            </select>
          </div>
          <div class="form-group">
            <label for="phoneInput">Phone</label>
            <input type="tel" id="phoneInput" placeholder="Your phone number">
          </div>
          <button class="btn btn--primary" id="registrySubmitBtn">Continue</button>
        </div>
      </div>
    `);

    document.getElementById('registrySubmitBtn').addEventListener('click', () => {
      const name = document.getElementById('nameInput').value.trim();
      const country = document.getElementById('countrySelect').value;
      const phone = document.getElementById('phoneInput').value.trim();

      if (!name) {
        alert('Name is required');
        return;
      }

      farmerName = name;
      farmerCountry = country || null;
      farmerPhone = phone || null;
      proceedToConsent();
    });
  }

  function showRegistryConfirm() {
    render(`
      <div class="screen screen--registry">
        <div class="card">
          <h2>Hi ${farmerName}! 👋</h2>
          <p>Please confirm your details:</p>
          <div class="form-group">
            <label for="nameConfirm">Name</label>
            <input type="text" id="nameConfirm" value="${farmerName}">
          </div>
          <div class="form-group">
            <label for="countryConfirm">Country</label>
            <input type="text" id="countryConfirm" value="${farmerCountry || ''}">
          </div>
          <div class="form-group">
            <label for="phoneConfirm">Phone</label>
            <input type="text" id="phoneConfirm" value="${farmerPhone || ''}">
          </div>
          <button class="btn btn--primary" id="registryConfirmBtn">Confirm & Continue</button>
        </div>
      </div>
    `);

    document.getElementById('registryConfirmBtn').addEventListener('click', () => {
      farmerName = document.getElementById('nameConfirm').value.trim();
      farmerCountry = document.getElementById('countryConfirm').value.trim() || null;
      farmerPhone = document.getElementById('phoneConfirm').value.trim() || null;
      proceedToConsent();
    });
  }

  async function proceedToConsent() {
    showLoading();
    const cameraReady = await initCamera();
    if (!cameraReady) return;
    showConsent();
  }

  // ── Consent Screen ─────────────────────────────────────────────────────────
  function showConsent() {
    consentGiven = null;
    consentTime = null;

    render(`
      <div class="screen screen--consent">
        <div class="consent-body">
          <div class="audio-section">
            <div class="audio-status">🔊 Playing consent audio...</div>
            <button class="btn btn--small" id="playBtn" style="display:none">Tap to play audio</button>
          </div>
          <div class="consent-text">
            <p>This video will be used by Fortune Coffee to share your story with customers who buy your coffee.</p>
            <p><strong>Do you agree?</strong></p>
          </div>
          <div class="consent-actions">
            <button class="btn btn--consent btn--yes" id="consentYesBtn">✅ AGREE</button>
            <button class="btn btn--consent btn--no" id="consentNoBtn">❌ DISAGREE</button>
          </div>
        </div>
      </div>
    `);

    document.getElementById('consentYesBtn').addEventListener('click', () => {
      consentGiven = true;
      consentTime = new Date().toISOString();
      showQuestion();
    });

    document.getElementById('consentNoBtn').addEventListener('click', () => {
      consentGiven = false;
      consentTime = new Date().toISOString();
      showConsentDecline();
    });

    const audioPath = getAudioPath('consent', null, farmerLang);
    playAudio(audioPath, () => {
      // Audio finished, farmer can make choice
    });
  }

  function showConsentDecline() {
    render(`
      <div class="screen screen--consent-decline">
        <div class="card">
          <div style="font-size: 48px; margin-bottom: 16px;">👋</div>
          <h2>Thank you</h2>
          <p>Thank you for your time. Your decision has been recorded.</p>
        </div>
      </div>
    `);

    // Log the decline to Supabase and stop
    logConsentAndStop();
  }

  async function logConsentAndStop() {
    try {
      await supabaseClient
        .from(TABLE)
        .insert({
          farmer_id: farmerId,
          farmer_name: farmerName,
          farmer_country: farmerCountry,
          farmer_phone: farmerPhone,
          consent_given: consentGiven,
          consent_timestamp: consentTime,
          language: farmerLang,
          status: 'consent_declined',
        });
    } catch (err) {
      console.error('[webcap] consent logging error:', err);
    }
  }

  // ── Question Screen (with audio) ───────────────────────────────────────────
  function showQuestion() {
    const updateInfoLink = isReturningFarmer
      ? `<a href="#" id="updateInfoLink" style="font-size: 12px; color: #8892b0; text-decoration: underline; margin-top: 12px; display: inline-block;">Update info / Rescind consent</a>`
      : '';

    render(`
      <div class="screen screen--question">
        <div class="question-card">
          <p class="question-label">Your question</p>
          <p class="question-text">${currentQuestion.text_prompt}</p>
        </div>
        <div class="audio-section" style="display: flex; gap: 12px; width: 100%; margin-bottom: 16px;">
          <button class="btn btn--small" id="replayBtn" style="flex: 1;">🔊 Replay audio</button>
          <button class="btn btn--small" id="cameraToggleBtn" style="flex: 1;">🔄 Flip camera</button>
        </div>
        <div class="preview-wrap">
          <video id="preview" autoplay muted playsinline></video>
        </div>
        <button class="btn btn--record" id="startBtn" style="margin-top: 12px;">Tap to start recording</button>
        <p class="hint">Maximum ${MAX_DURATION_SEC} seconds</p>
        ${updateInfoLink}
      </div>
    `);

    document.getElementById('preview').srcObject = mediaStream;
    document.getElementById('startBtn').addEventListener('click', startRecording);
    document.getElementById('replayBtn').addEventListener('click', () => {
      const audioPath = getAudioPath('question', currentQuestion.id, farmerLang);
      playAudio(audioPath, () => {});
    });
    setupCameraToggle();

    // Add update info link listener if returning farmer
    if (isReturningFarmer) {
      const updateLink = document.getElementById('updateInfoLink');
      if (updateLink) {
        updateLink.addEventListener('click', (e) => {
          e.preventDefault();
          showRegistryConfirm();
        });
      }
    }

    // Auto-play question audio
    const audioPath = getAudioPath('question', currentQuestion.id, farmerLang);
    playAudio(audioPath, () => {});

    // Show framing guidance before user starts recording
    showRecordingGuidanceOverlay();
  }

  // ── Recording Guidance Overlay ────────────────────────────────────────────
  function showRecordingGuidanceOverlay() {
    // Unique suffix so clipPath IDs don't clash if overlay is shown more than once
    const uid = Math.random().toString(36).slice(2, 6);

    const overlay = document.createElement('div');
    overlay.id        = 'recordingGuidanceOverlay';
    overlay.className = 'recording-guidance-overlay';
    overlay.innerHTML = `
      <div class="guidance-content">

        <!-- Bad: dark screen, tilted phone, face cropped at edge -->
        <div class="guidance-panel">
          <svg class="guidance-svg" viewBox="0 0 90 138" xmlns="http://www.w3.org/2000/svg">
            <g transform="rotate(-11 45 69)">
              <rect x="9" y="4" width="72" height="130" rx="9" fill="#1e1e2e" stroke="#888" stroke-width="2"/>
              <rect x="34" y="7"  width="22" height="5"   rx="2.5" fill="#111"/>
              <clipPath id="sb${uid}">
                <rect x="14" y="17" width="62" height="100" rx="3"/>
              </clipPath>
              <rect x="14" y="17" width="62" height="100" rx="3" fill="#0d0d18"/>
              <g clip-path="url(#sb${uid})">
                <!-- face shifted far right — partially outside frame -->
                <ellipse cx="68" cy="70" rx="26" ry="32" fill="#b87a52"/>
                <!-- heavy shadow overlay -->
                <rect x="14" y="17" width="62" height="100" fill="rgba(0,0,0,0.58)"/>
                <!-- faint eye just visible through shadow -->
                <circle cx="59" cy="64" r="1.8" fill="rgba(0,0,0,0.75)"/>
              </g>
            </g>
          </svg>
          <span class="guidance-mark guidance-mark--bad">&#x2717;</span>
        </div>

        <div class="guidance-divider"></div>

        <!-- Good: bright screen, upright phone, face centered -->
        <div class="guidance-panel">
          <svg class="guidance-svg" viewBox="0 0 90 138" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="4" width="72" height="130" rx="9" fill="#1e1e2e" stroke="#ddd" stroke-width="2"/>
            <rect x="34" y="7"  width="22" height="5"   rx="2.5" fill="#111"/>
            <clipPath id="sg${uid}">
              <rect x="14" y="17" width="62" height="100" rx="3"/>
            </clipPath>
            <rect x="14" y="17" width="62" height="100" rx="3" fill="#f0e4d0"/>
            <g clip-path="url(#sg${uid})">
              <rect x="14" y="17" width="62" height="100" fill="#f2e6d5"/>
              <!-- neck -->
              <rect x="34" y="94" width="22" height="20" rx="4" fill="#b87a52"/>
              <!-- face centered and filling the frame -->
              <ellipse cx="45" cy="68" rx="22" ry="28" fill="#c8855c"/>
              <!-- eyes -->
              <circle cx="38" cy="62" r="2.5" fill="#2a1205"/>
              <circle cx="52" cy="62" r="2.5" fill="#2a1205"/>
              <!-- smile -->
              <path d="M38 76 Q45 84 52 76" stroke="#2a1205" stroke-width="2" fill="none" stroke-linecap="round"/>
            </g>
          </svg>
          <span class="guidance-mark guidance-mark--good">&#x2713;</span>
        </div>

      </div>
    `;

    document.getElementById('app').appendChild(overlay);

    let autoTimer;
    let dismissed = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      clearTimeout(autoTimer);
      overlay.classList.add('recording-guidance-overlay--fading');
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 320);
    }

    // Tap anywhere on the overlay dismisses it
    overlay.addEventListener('click', dismiss);

    // Elevate record button above overlay so it stays directly tappable.
    // Also hook dismiss so overlay clears the moment recording starts.
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
      startBtn.style.position = 'relative';
      startBtn.style.zIndex   = '200';
      startBtn.addEventListener('click', dismiss, { once: true });
    }

    // Auto-dismiss after 4 seconds
    autoTimer = setTimeout(dismiss, 4000);
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
    showQuestion();
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
          farmer_id:          farmerId,
          farmer_name:        farmerName,
          farmer_country:     farmerCountry,
          farmer_phone:       farmerPhone,
          consent_given:      consentGiven,
          consent_timestamp:  consentTime,
          language:           farmerLang,
          country:            null, // populated downstream via farmer-master.csv lookup
          question_id:        currentQuestion.id,
          video_path:         filePath,
          video_url:          publicUrl,
          status:             'received',
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
