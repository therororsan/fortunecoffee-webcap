(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const BUCKET               = 'farmer-videos';
  const FARMERS_TABLE        = 'farmers';
  const SUBMISSIONS_TABLE    = 'farmer_submissions';
  const MAX_DURATION_SEC     = 90;
  const VIDEO_BITRATE        = 2_000_000; // 2 Mbps — keeps 90s video under ~50 MB
  const QUESTIONS_URL        = '/questions/questions.json';
  const SUPPORTED_LANGS      = ['en', 'am', 'sw', 'fr', 'pt', 'es'];
  const DEFAULT_LANG         = 'en';
  const COUNTRY_OPTIONS = [
    'Brazil', 'Colombia', 'Ethiopia', 'Guatemala', 'Honduras',
    'India', 'Indonesia', 'Kenya', 'Mexico', 'Peru',
    'Rwanda', 'Tanzania', 'Uganda', 'Vietnam', 'Yemen', 'Other',
  ];
  const DIAL_CODES = {
    'Brazil': '+55',    'Colombia': '+57',  'Ethiopia': '+251',
    'Guatemala': '+502','Honduras': '+504', 'India': '+91',
    'Indonesia': '+62', 'Kenya': '+254',    'Mexico': '+52',
    'Peru': '+51',      'Rwanda': '+250',   'Tanzania': '+255',
    'Uganda': '+256',   'Vietnam': '+84',   'Yemen': '+967',
    'Other': '',
  };
  const FLAG_CODES = {
    'Brazil': 'br',    'Colombia': 'co',  'Ethiopia': 'et', 'Guatemala': 'gt',
    'Honduras': 'hn',  'India': 'in',     'Indonesia': 'id','Kenya': 'ke',
    'Mexico': 'mx',    'Peru': 'pe',      'Rwanda': 'rw',   'Tanzania': 'tz',
    'Uganda': 'ug',    'Vietnam': 'vn',   'Yemen': 'ye',
  };

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
  let currentAudio    = null;

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
        checkExistingFarmer(farmerId, farmerPhone),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]);

      // (b) Log what Supabase returned
      console.log('[webcap] Supabase lookup result:', existingSubmission);

      if (existingSubmission) {
        // Pre-fill state from the farmer record
        farmerName    = existingSubmission.farmer_name || farmerName;
        farmerCountry = existingSubmission.country || farmerCountry;
        farmerPhone   = existingSubmission.phone || farmerPhone;
        consentGiven  = existingSubmission.consent_given;
        consentTime   = existingSubmission.consent_timestamp;
        farmerLang    = existingSubmission.language || farmerLang;
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

  async function checkExistingFarmer(id, phone) {
    if (!supabaseClient) {
      console.warn('[webcap] checkExistingFarmer: supabaseClient not ready');
      return null;
    }
    try {
      const safeReturningFarmerFields =
        'farmer_id, farmer_name, country, phone, consent_given, consent_timestamp, language, contact_verified';

      // ── Query by farmer_id in farmers ────────────────────────────────────
      if (id) {
        console.log('[webcap] Querying farmers WHERE farmer_id =', id);
        const { data, error } = await supabaseClient
          .from(FARMERS_TABLE)
          .select(safeReturningFarmerFields)
          .eq('farmer_id', id)
          .limit(1);

        console.log('[webcap] farmer_id query →', { data, error });
        if (error) throw error;
        if (data && data.length > 0) return data[0];
      }

      // ── Fallback: query by phone in farmers ──────────────────────────────
      if (phone) {
        console.log('[webcap] Querying farmers WHERE phone =', phone);
        const { data, error } = await supabaseClient
          .from(FARMERS_TABLE)
          .select(safeReturningFarmerFields)
          .eq('phone', phone)
          .limit(1);

        console.log('[webcap] phone query →', { data, error });
        if (error) throw error;
        if (data && data.length > 0) return data[0];
      }

      console.log('[webcap] No rows found for farmer_id:', id, '/ phone:', phone);
      return null;
    } catch (err) {
      console.error('[webcap] checkExistingFarmer error:', err);
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
    currentAudio = audio;
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

  function stopCurrentAudio() {
    if (!currentAudio) return;
    currentAudio.pause();
    currentAudio.currentTime = 0;
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
    // Build custom dropdown options with flag images
    const csOpts = COUNTRY_OPTIONS.map(name => {
      const code = FLAG_CODES[name];
      const flag = code
        ? `<img src="https://flagcdn.com/24x18/${code}.png" style="vertical-align:middle;margin-right:6px;" alt="">`
        : '';
      return `<li class="cs-opt" data-value="${name}">${flag}${name}</li>`;
    }).join('');

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
            <label>Country/Region</label>
            <div class="cs-wrap" id="csWrap">
              <div class="cs-trigger" id="csTrigger">
                <span id="csDisplay" class="cs-placeholder">Select country…</span>
                <span class="cs-arrow">▾</span>
              </div>
              <ul class="cs-list" id="csList">
                <li class="cs-opt cs-opt--empty" data-value="">Select country…</li>
                ${csOpts}
              </ul>
              <input type="hidden" id="countrySelect">
            </div>
          </div>
          <div class="form-group">
            <label for="phoneInput">Phone 📞</label>
            <div class="phone-input-wrap">
              <span id="phonePrefix" class="phone-prefix"></span>
              <input type="tel" id="phoneInput" placeholder="Your phone number">
            </div>
          </div>
          <button class="btn btn--primary" id="registrySubmitBtn">Continue</button>
        </div>
      </div>
    `);

    // ── Custom dropdown wiring ───────────────────────────────────────────────
    const csWrap    = document.getElementById('csWrap');
    const csList    = document.getElementById('csList');
    const csHidden  = document.getElementById('countrySelect');
    const csDisplay = document.getElementById('csDisplay');

    document.getElementById('csTrigger').addEventListener('click', () => {
      csWrap.classList.toggle('cs-open');
    });

    csList.addEventListener('click', e => {
      const opt = e.target.closest('.cs-opt');
      if (!opt) return;
      const val = opt.dataset.value;
      csHidden.value = val;
      csWrap.classList.remove('cs-open');
      if (val) {
        csDisplay.innerHTML = opt.innerHTML;
        csDisplay.classList.remove('cs-placeholder');
      } else {
        csDisplay.textContent = 'Select country…';
        csDisplay.classList.add('cs-placeholder');
      }
      csHidden.dispatchEvent(new Event('change'));
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (csWrap && !csWrap.contains(e.target)) csWrap.classList.remove('cs-open');
    });

    // Update dial-code prefix when country changes
    document.getElementById('countrySelect').addEventListener('change', () => {
      const country = document.getElementById('countrySelect').value;
      const prefix  = DIAL_CODES[country] || '';
      const el = document.getElementById('phonePrefix');
      el.textContent    = prefix;
      el.style.display  = prefix ? 'inline-flex' : 'none';
    });

    document.getElementById('registrySubmitBtn').addEventListener('click', () => {
      const name     = document.getElementById('nameInput').value.trim();
      const country  = document.getElementById('countrySelect').value;
      const prefix   = document.getElementById('phonePrefix').textContent.trim();
      const phoneRaw = document.getElementById('phoneInput').value.trim();
      // Prepend dial code; if no number entered, store null
      const phone    = phoneRaw ? (prefix + phoneRaw) : null;

      if (!name) {
        alert('Name is required');
        return;
      }

      farmerName    = name;
      farmerCountry = country || null;
      farmerPhone   = phone;
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
            <label for="countryConfirm">Country/Region</label>
            <input type="text" id="countryConfirm" value="${farmerCountry || ''}">
          </div>
          <div class="form-group">
            <label for="phoneConfirm">Phone 📞</label>
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

    document.getElementById('consentYesBtn').addEventListener('click', async () => {
      stopCurrentAudio();
      consentGiven = true;
      consentTime = new Date().toISOString();
      try {
        await syncFarmerConsent(true);
      } catch (err) {
        console.error('[webcap] consent update error:', err);
        showError('Could not save your consent. Please try again.');
        return;
      }
      showQuestion();
    });

    document.getElementById('consentNoBtn').addEventListener('click', async () => {
      stopCurrentAudio();
      consentGiven = false;
      consentTime = new Date().toISOString();
      try {
        await syncFarmerConsent(false);
      } catch (err) {
        console.error('[webcap] consent update error:', err);
        showError('Could not save your decision. Please try again.');
        return;
      }
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

    // Consent has already been saved to farmers; stop here.
  }

  async function syncFarmerConsent(consentValue) {
    if (!supabaseClient || !farmerId) return;

    const updatePayload = {
      farmer_id: farmerId,
      consent_given: consentValue,
      consent_timestamp: new Date().toISOString(),
    };

    if (consentValue === true) {
      updatePayload.contact_verified = true;
    }

    if (farmerName) updatePayload.farmer_name = farmerName;
    if (farmerCountry) updatePayload.country = farmerCountry;
    if (farmerPhone) updatePayload.phone = farmerPhone;
    if (farmerLang) updatePayload.language = farmerLang;

    const { error } = await supabaseClient
      .from(FARMERS_TABLE)
      .upsert(updatePayload, { onConflict: 'farmer_id' });

    if (error) throw error;
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

    // Audio starts 1.5s after the overlay begins dismissing — not before
    const audioPath = getAudioPath('question', currentQuestion.id, farmerLang);

    // Show framing guidance; audio starts 1.5s after overlay begins dismissing
    showRecordingGuidanceOverlay(audioPath);
  }

  // ── Recording Guidance Overlay ────────────────────────────────────────────
  function showRecordingGuidanceOverlay(audioPath) {
    const overlay = document.createElement('div');
    overlay.id        = 'recordingGuidanceOverlay';
    overlay.className = 'recording-guidance-overlay';
    overlay.innerHTML = `
      <div class="guidance-content">

        <div class="guidance-panel">
          <img class="guidance-img" src="images/guidance_bad.jpg" alt="">
        </div>

        <div class="guidance-divider"></div>

        <div class="guidance-panel">
          <img class="guidance-img" src="images/guidance_good.jpg" alt="">
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
      // Remove overlay after fade completes (matches 0.6s CSS transition)
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 650);
      // Start question audio 1.5s after dismiss begins (after overlay is mostly gone)
      setTimeout(() => playAudio(audioPath, () => {}), 1500);
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

    // Auto-dismiss after 7 seconds
    autoTimer = setTimeout(dismiss, 7000);
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
        .from(SUBMISSIONS_TABLE)
        .insert({
          farmer_id:   farmerId,
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
