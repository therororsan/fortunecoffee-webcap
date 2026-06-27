(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const BUCKET               = 'farmer-videos';
  const FARMERS_TABLE        = 'farmers';
  const SUBMISSIONS_TABLE    = 'farmer_submissions';
  const MAX_DURATION_SEC     = 90;
  const VIDEO_BITRATE        = 2_000_000; // 2 Mbps — keeps 90s video under ~50 MB
  const QUESTIONS_URL        = '/questions/questions.json';
  const SUPPORTED_LANGS      = ['en', 'sw', 'am', 'si', 'ta', 'vi', 'hi', 'es', 'fr', 'pt'];
  const DEFAULT_LANG         = 'en';
  const DEBUG_SELFIE_CHECK   = false;
  const SOUND_LEVEL_THRESHOLD = 0.01;
  const SOUND_CHECK_BAR_COUNT = 6;
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
  const ISO3_COUNTRY_NAMES = {
    'bra': 'Brazil',       'col': 'Colombia',      'eth': 'Ethiopia',
    'gtm': 'Guatemala',    'hnd': 'Honduras',       'ind': 'India',
    'idn': 'Indonesia',    'ken': 'Kenya',          'mex': 'Mexico',
    'per': 'Peru',         'rwa': 'Rwanda',         'tza': 'Tanzania',
    'uga': 'Uganda',       'vnm': 'Vietnam',        'yem': 'Yemen',
    'lka': 'Sri Lanka',    'chn': 'China',          'hkg': 'Hong Kong',
    'gbr': 'United Kingdom',
  };

  function countryDisplayName(code) {
    if (!code) return '';
    return ISO3_COUNTRY_NAMES[code.toLowerCase()] || code;
  }

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
  let currentAudioSettle = null;
  let currentAudioDelayTimer = null;
  let currentAudioDelayResolve = null;
  let isMuted         = false;
  let reviewObjectUrl = null;
  let selfieBlob      = null;
  let selfieObjectUrl = null;
  let selfieFeedbackTone = null;
  let selfieFeedbackMessage = '';
  let audioContext    = null;
  let audioSourceNode = null;
  let audioStreamForMonitor = null;
  let analyserNode    = null;
  let analyserData    = null;
  let audioMonitorFrame = null;
  let currentMicLevel = 0;
  let faceDetector    = null;
  let isFaceDetectionSupported = false;
  let hasMultipleVideoInputs = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  async function ensureAudioMonitor() {
    if (!mediaStream) return false;
    try {
      if (!audioContext) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return false;
        audioContext = new AudioCtor();
      }
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      if (audioStreamForMonitor !== mediaStream) {
        if (audioSourceNode) {
          audioSourceNode.disconnect();
        }
        audioSourceNode = null;
        analyserNode = null;
        analyserData = null;
      }
      if (!audioSourceNode || !analyserNode) {
        audioSourceNode = audioContext.createMediaStreamSource(mediaStream);
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.75;
        audioSourceNode.connect(analyserNode);
        analyserData = new Uint8Array(analyserNode.fftSize);
        audioStreamForMonitor = mediaStream;
      }
      return true;
    } catch (err) {
      console.error('[webcap] audio monitor init error:', err);
      return false;
    }
  }

  function sampleMicLevel() {
    if (!analyserNode || !analyserData) return 0;
    analyserNode.getByteTimeDomainData(analyserData);
    let total = 0;
    for (let i = 0; i < analyserData.length; i++) {
      total += Math.abs((analyserData[i] - 128) / 128);
    }
    return total / analyserData.length;
  }

  function renderAudioMonitorFrame() {
    currentMicLevel = sampleMicLevel();

    const bars = Array.from(document.querySelectorAll('.sound-bars .sound-bar'));
    if (bars.length) {
      const normalized = Math.max(0.08, Math.min(1, currentMicLevel / 0.08));
      bars.forEach((bar, index) => {
        const offset = 0.18 + (index % 3) * 0.1;
        const scale = Math.min(1, normalized + offset);
        bar.style.transform = `scaleY(${scale.toFixed(3)})`;
      });
    }

    const status = document.getElementById('soundStatus');
    const statusDetail = document.getElementById('soundStatusDetail');
    const continueAnyway = document.getElementById('continueAnywayBtn');
    if (status) {
      const canHear = currentMicLevel >= SOUND_LEVEL_THRESHOLD;
      status.textContent = canHear ? 'We can hear you ✓' : 'No sound detected';
      status.className = `sound-status ${canHear ? 'sound-status--good' : 'sound-status--warn'}`;
      if (statusDetail) {
        statusDetail.textContent = canHear
          ? 'Your microphone is picking up your voice.'
          : 'Try speaking closer to the phone or check your mic.';
      }
      if (continueAnyway) {
        continueAnyway.style.display = canHear ? 'none' : 'inline-block';
      }
    }

    audioMonitorFrame = window.requestAnimationFrame(renderAudioMonitorFrame);
  }

  async function startAudioMonitor() {
    const ready = await ensureAudioMonitor();
    if (!ready) return false;
    stopAudioMonitor();
    renderAudioMonitorFrame();
    return true;
  }

  function stopAudioMonitor() {
    if (audioMonitorFrame) {
      window.cancelAnimationFrame(audioMonitorFrame);
      audioMonitorFrame = null;
    }
  }

  async function ensureFaceDetector() {
    if (faceDetector || isFaceDetectionSupported) return true;
    if (!('FaceDetector' in window)) return false;
    try {
      faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      isFaceDetectionSupported = true;
      return true;
    } catch (err) {
      console.warn('[webcap] FaceDetector unavailable:', err);
      faceDetector = null;
      isFaceDetectionSupported = false;
      return false;
    }
  }

  function clearReviewObjectUrl() {
    if (reviewObjectUrl) {
      URL.revokeObjectURL(reviewObjectUrl);
      reviewObjectUrl = null;
    }
  }

  function clearSelfieObjectUrl() {
    if (selfieObjectUrl) {
      URL.revokeObjectURL(selfieObjectUrl);
      selfieObjectUrl = null;
    }
  }

  function resetSelfieCaptureState() {
    selfieBlob = null;
    clearSelfieObjectUrl();
    selfieFeedbackTone = null;
    selfieFeedbackMessage = '';
    const wrap = document.getElementById('selfiePreviewWrap');
    if (wrap) {
      wrap.classList.remove('selfie-with-face-guide');
    }
  }

  function handleUploadAttempt() {
    clearReviewObjectUrl();
    uploadVideo();
  }

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
        // URL param is authoritative for country — only fall back to Supabase value
        // if no country was passed in the link (prevents stale DB value overriding operator-set country)
        farmerName    = existingSubmission.farmer_name || farmerName;
        farmerCountry = farmerCountry || existingSubmission.country;
        farmerPhone   = existingSubmission.phone || farmerPhone;
        consentGiven  = existingSubmission.consent_given;
        consentTime   = existingSubmission.consent_timestamp;
        farmerLang    = existingSubmission.language || farmerLang;
        isReturningFarmer = true;

        if (consentGiven === true) {
          // Already consented — skip registry + consent, go straight to selfie step
          console.log('[webcap] Routing → selfie step (returning, consent=true)');
          await startSelfieStep();
        } else {
          // consent_given is false or null — show pre-filled registry then consent
          console.log('[webcap] Routing → registry confirm (returning, consent=' + consentGiven + ')');
          showRegistryConfirm();
        }
        return;
      }

      console.log('[webcap] No existing submission found — treating as new farmer');
    }

    // New farmer: standard flow — registry → consent → selfie → sound check → question → record → upload
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
  function resolveAudioPath(screen, lang, options = {}) {
    const folder = options.folder || screen;
    const baseName = options.baseName || screen;
    return `/audio/${folder}/${baseName}_${lang}.mp3`;
  }

  function renderMuteToggle() {
    return `
      <div style="width:100%; display:flex; justify-content:flex-end;">
        <button
          class="btn btn--small"
          id="muteToggleBtn"
          data-mute-toggle
          type="button"
          style="width:auto; min-width:56px; padding:10px 14px;"
        >${isMuted ? '🔇' : '🔊'}</button>
      </div>
    `;
  }

  function syncMuteToggleButton(button) {
    if (!button) return;
    button.textContent = isMuted ? '🔇' : '🔊';
    button.setAttribute('aria-label', isMuted ? 'Unmute audio' : 'Mute audio');
    button.setAttribute('title', isMuted ? 'Unmute audio' : 'Mute audio');
  }

  function syncMuteToggleButtons() {
    document.querySelectorAll('[data-mute-toggle]').forEach(syncMuteToggleButton);
  }

  function clearPendingAudioDelay() {
    if (currentAudioDelayTimer) {
      window.clearTimeout(currentAudioDelayTimer);
      currentAudioDelayTimer = null;
    }
    if (currentAudioDelayResolve) {
      const resolve = currentAudioDelayResolve;
      currentAudioDelayResolve = null;
      resolve('stopped');
    }
  }

  function stopCurrentAudio() {
    clearPendingAudioDelay();
    if (!currentAudio) return;

    const audio = currentAudio;
    const settle = currentAudioSettle;
    currentAudio = null;
    currentAudioSettle = null;
    audio.onended = null;
    audio.onerror = null;

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}

    if (typeof settle === 'function') {
      settle('stopped');
    }
  }

  function setMuted(nextMuted) {
    isMuted = !!nextMuted;
    if (isMuted) {
      stopCurrentAudio();
    }
    syncMuteToggleButtons();
  }

  function setupMuteToggle() {
    const button = document.getElementById('muteToggleBtn');
    if (!button) return;
    syncMuteToggleButton(button);
    button.addEventListener('click', () => {
      setMuted(!isMuted);
    });
  }

  function playAudioPath(path, options = {}) {
    if (isMuted) {
      return Promise.resolve('muted');
    }

    stopCurrentAudio();

    return new Promise(resolve => {
      const audio = new Audio(path);
      let settled = false;

      const finish = status => {
        if (settled) return;
        settled = true;
        if (currentAudio === audio) {
          currentAudio = null;
          currentAudioSettle = null;
        }
        audio.onended = null;
        audio.onerror = null;
        resolve(status);
      };

      currentAudio = audio;
      currentAudioSettle = finish;
      audio.onended = () => finish('ended');
      audio.onerror = () => finish('error');

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (typeof options.onPlayStart === 'function') {
              options.onPlayStart();
            }
          })
          .catch(() => finish('play-error'));
      } else if (typeof options.onPlayStart === 'function') {
        options.onPlayStart();
      }
    });
  }

  async function playAudioClip(screen, lang, options = {}) {
    const primaryPath = resolveAudioPath(screen, lang, options);
    const primaryResult = await playAudioPath(primaryPath, options);

    if (
      primaryResult === 'ended' ||
      primaryResult === 'stopped' ||
      primaryResult === 'muted'
    ) {
      return primaryResult;
    }

    if (options.skipEnglishFallback || lang === 'en') {
      return options.optional ? 'skipped' : primaryResult;
    }

    const fallbackPath = resolveAudioPath(screen, 'en', options);
    const fallbackResult = await playAudioPath(fallbackPath, options);
    if (fallbackResult === 'ended' || fallbackResult === 'stopped' || fallbackResult === 'muted') {
      return fallbackResult;
    }

    return options.optional ? 'skipped' : fallbackResult;
  }

  function waitForAudioPause(ms) {
    if (ms <= 0 || isMuted) {
      return Promise.resolve('ended');
    }

    clearPendingAudioDelay();

    return new Promise(resolve => {
      currentAudioDelayResolve = result => {
        currentAudioDelayResolve = null;
        resolve(result);
      };
      currentAudioDelayTimer = window.setTimeout(() => {
        currentAudioDelayTimer = null;
        if (currentAudioDelayResolve) {
          const finish = currentAudioDelayResolve;
          currentAudioDelayResolve = null;
          finish('ended');
        }
      }, ms);
    });
  }

  function createAudioController({ clips, onComplete, onPlayStart, completeOnStop = false } = {}) {
    const sequence = Array.isArray(clips) ? clips : [];

    const runSequence = async () => {
      stopCurrentAudio();
      if (isMuted) {
        if (completeOnStop && typeof onComplete === 'function') {
          onComplete();
        }
        return;
      }

      let playStartHandled = false;

      for (const clip of sequence) {
        if (isMuted) {
          if (completeOnStop && typeof onComplete === 'function') {
            onComplete();
          }
          return;
        }

        if (clip.pauseMs) {
          const pauseResult = await waitForAudioPause(clip.pauseMs);
          if (pauseResult === 'stopped') {
            if (completeOnStop && typeof onComplete === 'function') {
              onComplete();
            }
            return;
          }
          continue;
        }

        const result = await playAudioClip(clip.screen, clip.lang, {
          ...clip,
          onPlayStart: () => {
            if (playStartHandled) {
              return;
            }
            playStartHandled = true;
            if (typeof onPlayStart === 'function') {
              onPlayStart();
            }
          },
        });
        if (result === 'stopped' || result === 'muted') {
          if (completeOnStop && typeof onComplete === 'function') {
            onComplete();
          }
          return;
        }
      }

      if (!isMuted && typeof onComplete === 'function') {
        onComplete();
      }
    };

    return {
      play: runSequence,
      replay: runSequence,
    };
  }

  // ── Camera ───────────────────────────────────────────────────────────────
  async function initCamera() {
    try {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: cameraFacingMode }, // 'user' = front, 'environment' = back
          width:  { ideal: 720  },
          height: { ideal: 1280 },
        },
        audio: true,
      });
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          hasMultipleVideoInputs = devices.filter(device => device.kind === 'videoinput').length > 1;
        } catch {
          hasMultipleVideoInputs = false;
        }
      } else {
        hasMultipleVideoInputs = false;
      }
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

  function stopMediaStream() {
    if (!mediaStream) return;
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  async function switchCamera() {
    // Toggle between front and back cameras
    cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';

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
    const selfieWrap = document.getElementById('selfiePreviewWrap');
    if (selfieWrap) {
      selfieWrap.classList.toggle('preview-wrap--mirrored', cameraFacingMode === 'user');
    }
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  function render(html) {
    stopCurrentAudio();
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
            <label>Country/Region</label>
            <p class="registry-field-readonly">${escapeHtml(countryDisplayName(farmerCountry) || '—')}</p>
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
      farmerPhone = document.getElementById('phoneConfirm').value.trim() || null;
      proceedToConsent();
    });
  }

  async function proceedToConsent() {
    showConsent({ attemptAutoplay: true });
  }

  // ── Consent Screen ─────────────────────────────────────────────────────────
  function showConsent({ attemptAutoplay = false } = {}) {
    consentGiven = null;
    consentTime = null;
    let consentAudioAutoplaySucceeded = false;
    let isConsentAutoplayAttempt = false;
    const consentAudio = createAudioController({
      clips: [{ screen: 'consent', lang: farmerLang }],
      onPlayStart: () => {
        if (isConsentAutoplayAttempt) {
          consentAudioAutoplaySucceeded = true;
        }
      },
    });

    render(`
      <div class="screen screen--consent">
        ${renderMuteToggle()}
        <div class="consent-body">
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
    setupMuteToggle();

    document.getElementById('consentYesBtn').addEventListener('click', async () => {
      if (!isMuted && !currentAudio && !consentAudioAutoplaySucceeded) {
        consentAudio.play();
      }
      consentGiven = true;
      consentTime = new Date().toISOString();
      try {
        await syncFarmerConsent(true);
      } catch (err) {
        console.error('[webcap] consent update error:', err);
        showError('Could not save your consent. Please try again.');
        return;
      }
      await startSelfieStep();
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

    if (attemptAutoplay) {
      isConsentAutoplayAttempt = true;
      consentAudio.play().finally(() => {
        isConsentAutoplayAttempt = false;
      });
    }
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

  // ── Selfie Step ────────────────────────────────────────────────────────────
  async function startSelfieStep() {
    stopCurrentAudio();
    stopAudioMonitor();
    resetSelfieCaptureState();
    cameraFacingMode = 'user';
    showLoading();
    const cameraReady = await initCamera();
    if (!cameraReady) return;
    showSelfieCapture({ showGuide: true, attemptAutoplay: true });
  }

  function showSelfieCapture({ showGuide = false, attemptAutoplay = false } = {}) {
    const hasCapturedSelfie = !!(selfieBlob && selfieObjectUrl);
    const showFlipButton = !hasCapturedSelfie && hasMultipleVideoInputs;
    const selfieAudio = createAudioController({
      clips: [{ screen: 'selfie', lang: farmerLang }],
    });
    const actionHtml = hasCapturedSelfie
      ? `
          <div class="selfie-actions">
            <button class="btn btn--record" id="retakeSelfieBtn">${selfieFeedbackTone === 'warn' ? 'Retake' : 'Use this photo'}</button>
            <button class="btn btn--secondary" id="useSelfieBtn">${selfieFeedbackTone === 'warn' ? 'Use this photo' : 'Retake'}</button>
          </div>
        `
      : `
          <div class="selfie-camera-controls">
            ${showFlipButton ? '<button class="btn btn--small" id="selfieFlipBtn" type="button">Flip</button>' : ''}
            <button class="btn btn--record" id="takeSelfieBtn" type="button">Take photo</button>
          </div>
        `;

    render(`
      <div class="screen screen--selfie">
        ${renderMuteToggle()}
        <div class="question-card">
          <p class="question-label">Selfie check</p>
          <p class="question-text">Center your face inside the oval, then take one clear photo.</p>
        </div>
        <div class="preview-wrap preview-wrap--frame-guide ${!hasCapturedSelfie && cameraFacingMode === 'user' ? 'preview-wrap--mirrored' : ''}" id="selfiePreviewWrap">
          ${hasCapturedSelfie
            ? `<img id="selfiePreviewImage" src="${selfieObjectUrl}" alt="Selfie preview">`
            : '<video id="preview" autoplay muted playsinline></video><div class="frame-guide-overlay" aria-hidden="true"></div>'}
        </div>
        ${actionHtml}
      </div>
    `);
    setupMuteToggle();

    if (hasCapturedSelfie) {
      const primaryAction = document.getElementById('retakeSelfieBtn');
      const secondaryAction = document.getElementById('useSelfieBtn');
      if (selfieFeedbackTone === 'warn') {
        primaryAction.addEventListener('click', () => {
          resetSelfieCaptureState();
          showSelfieCapture();
        });
        secondaryAction.addEventListener('click', () => {
          console.log('[webcap] selfie: "Use Photo" tapped', { selfieFeedbackTone, selfieBlob: !!selfieBlob });
          showSoundCheck();
        });
      } else {
        primaryAction.addEventListener('click', () => {
          console.log('[webcap] selfie: "Use Photo" tapped', { selfieFeedbackTone, selfieBlob: !!selfieBlob });
          showSoundCheck();
        });
        secondaryAction.addEventListener('click', () => {
          resetSelfieCaptureState();
          showSelfieCapture();
        });
      }
    } else {
      const preview = document.getElementById('preview');
      if (preview) {
        preview.srcObject = mediaStream;
      }
      const wrap = document.getElementById('selfiePreviewWrap');
      if (wrap) wrap.classList.add('selfie-with-face-guide');
      const flipButton = document.getElementById('selfieFlipBtn');
      if (flipButton) {
        flipButton.addEventListener('click', switchCamera);
      }
      document.getElementById('takeSelfieBtn').addEventListener('click', captureSelfie);
    }

    if (showGuide) {
      showPhotoGuidanceOverlay();
    }

    if (attemptAutoplay && !hasCapturedSelfie) {
      selfieAudio.play();
    }
  }

  function measureCentralLuminance(context, fullWidth, fullHeight) {
    const roiX = Math.floor(fullWidth * 0.22);
    const roiY = Math.floor(fullHeight * 0.08);
    const roiW = Math.floor(fullWidth * 0.56);
    const roiH = Math.floor(fullHeight * 0.68);
    const { data } = context.getImageData(roiX, roiY, roiW, roiH);
    let luminanceTotal = 0;
    let samples = 0;

    for (let index = 0; index < data.length; index += 16) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      luminanceTotal += (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
      samples++;
    }

    return samples ? (luminanceTotal / samples) : 0;
  }

  function hasSubjectInCenter(context, fullWidth, fullHeight) {
    const roiX = Math.floor(fullWidth * 0.25);
    const roiY = Math.floor(fullHeight * 0.10);
    const roiW = Math.floor(fullWidth * 0.50);
    const roiH = Math.floor(fullHeight * 0.65);
    const { data } = context.getImageData(roiX, roiY, roiW, roiH);
    const luminances = [];

    // Variance heuristic only; this is not face detection.
    for (let index = 0; index < data.length; index += 20) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      luminances.push((0.2126 * red) + (0.7152 * green) + (0.0722 * blue));
    }

    if (!luminances.length) return false;

    const mean = luminances.reduce((sum, value) => sum + value, 0) / luminances.length;
    const variance = luminances.reduce((sum, value) => {
      const delta = value - mean;
      return sum + (delta * delta);
    }, 0) / luminances.length;
    const stdDev = Math.sqrt(variance);

    if (DEBUG_SELFIE_CHECK) {
      console.log('[webcap] selfie subject check', { stdDev });
    }

    return stdDev > 14;
  }

  function canvasToJpegBlob(canvas) {
    return new Promise(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
  }

  async function captureSelfie() {
    const preview = document.getElementById('preview');
    if (!preview || preview.readyState < 2) {
      alert('Camera is still starting. Please try again.');
      return;
    }

    const canvas = document.createElement('canvas');
    const width = preview.videoWidth || 720;
    const height = preview.videoHeight || 1280;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(preview, 0, 0, width, height);

    const centralLum = measureCentralLuminance(context, width, height);
    const isTooDark = centralLum < 52;
    const subjectMissing = !hasSubjectInCenter(context, width, height);

    const blob = await canvasToJpegBlob(canvas);
    console.log('[webcap] selfie: blob created', { size: blob ? blob.size : null, type: blob ? blob.type : null });
    if (!blob) {
      showError('Could not capture your photo. Please try again.');
      return;
    }

    clearSelfieObjectUrl();
    selfieBlob = blob;
    selfieObjectUrl = URL.createObjectURL(blob);

    if (DEBUG_SELFIE_CHECK) {
      const roiX = Math.floor(width * 0.25);
      const roiY = Math.floor(height * 0.10);
      const roiW = Math.floor(width * 0.50);
      const roiH = Math.floor(height * 0.65);
      const { data } = context.getImageData(roiX, roiY, roiW, roiH);
      const luminances = [];
      for (let index = 0; index < data.length; index += 20) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        luminances.push((0.2126 * red) + (0.7152 * green) + (0.0722 * blue));
      }
      const mean = luminances.length
        ? luminances.reduce((sum, value) => sum + value, 0) / luminances.length
        : 0;
      const variance = luminances.length
        ? luminances.reduce((sum, value) => {
            const delta = value - mean;
            return sum + (delta * delta);
          }, 0) / luminances.length
        : 0;
      const stdDev = Math.sqrt(variance);
      console.log('[webcap] selfie checks', { centralLum, stdDev, isTooDark, subjectMissing });
    }

    if (isTooDark) {
      selfieFeedbackTone = 'warn';
      selfieFeedbackMessage = 'Photo looks dark - try again in better light';
    } else if (subjectMissing) {
      selfieFeedbackTone = 'warn';
      selfieFeedbackMessage = "We couldn't see you clearly - center your face in the oval and retake";
    } else {
      selfieFeedbackTone = 'good';
      selfieFeedbackMessage = 'Looks good ✓';
    }

    showSelfieCapture();
  }

  // ── Question Screen (with audio) ───────────────────────────────────────────
  function showQuestion({ attemptAutoplay = true } = {}) {
    stopAudioMonitor();
    const questionAudioKey = currentQuestion && (currentQuestion.audio_file || currentQuestion.id)
      ? (currentQuestion.audio_file || currentQuestion.id)
      : 'question';
    const updateInfoLink = isReturningFarmer
      ? `<a href="#" id="updateInfoLink" class="question-update-link">Update info / Rescind consent</a>`
      : '';

    render(`
      <div class="screen screen--question">
        ${renderMuteToggle()}
        <div class="question-listen-card">
          <p class="question-listen-text">${currentQuestion.text_prompt}</p>
        </div>
        <button class="btn btn--small" id="playBtn" type="button">Replay audio</button>
        <button class="btn btn--record" id="readyToRecordBtn" style="display:none">Ready to record</button>
        ${updateInfoLink}
      </div>
    `);
    setupMuteToggle();

    const revealReadyButton = () => {
      const readyButton = document.getElementById('readyToRecordBtn');
      if (readyButton) {
        readyButton.style.display = 'block';
      }
    };
    const questionAudio = createAudioController({
      clips: [
        {
          screen: 'question_intro',
          lang: farmerLang,
          optional: true,
          skipEnglishFallback: true,
        },
        { pauseMs: 500 },
        {
          screen: 'question',
          lang: farmerLang,
          folder: 'questions',
          baseName: questionAudioKey,
        },
      ],
      completeOnStop: true,
      onComplete: revealReadyButton,
    });

    document.getElementById('readyToRecordBtn').addEventListener('click', () => {
      stopCurrentAudio();
      startRecording();
    });
    document.getElementById('playBtn').addEventListener('click', () => {
      questionAudio.replay();
    });

    if (isReturningFarmer) {
      const updateLink = document.getElementById('updateInfoLink');
      if (updateLink) {
        updateLink.addEventListener('click', (e) => {
          e.preventDefault();
          showRegistryConfirm();
        });
      }
    }

    if (attemptAutoplay) {
      questionAudio.play();
    } else {
      revealReadyButton();
    }
  }

  async function showSoundCheck() {
    render(`
      <div class="screen screen--sound-check">
        <div class="question-card">
          <p class="question-label">Sound check</p>
          <p class="question-text">Say a few words so we can check your microphone.</p>
        </div>
        <div class="preview-wrap preview-wrap--frame-guide">
          <video id="preview" autoplay muted playsinline></video>
          <div class="frame-guide-overlay" aria-hidden="true"></div>
        </div>
        <div class="sound-check-card">
          <div class="sound-bars" aria-hidden="true">
            ${Array.from({ length: SOUND_CHECK_BAR_COUNT }, () => '<span class="sound-bar"></span>').join('')}
          </div>
          <p class="sound-status sound-status--warn" id="soundStatus">No sound detected</p>
          <p class="sound-status-detail" id="soundStatusDetail">Try speaking closer to the phone or check your mic.</p>
        </div>
        <button class="btn btn--record" id="soundCheckContinueBtn">Start Recording</button>
        <button class="btn btn--link" id="continueAnywayBtn" style="display:none">Continue anyway</button>
      </div>
    `);

    const preview = document.getElementById('preview');
    if (preview) {
      preview.srcObject = mediaStream;
    }

    await startAudioMonitor();

    const continueToQuestion = () => {
      stopCurrentAudio();
      stopAudioMonitor();
      showQuestion({ attemptAutoplay: true });
    };

    document.getElementById('soundCheckContinueBtn').addEventListener('click', continueToQuestion);
    document.getElementById('continueAnywayBtn').addEventListener('click', continueToQuestion);
  }

  // ── Photo Guidance Overlay ────────────────────────────────────────────────
  function showPhotoGuidanceOverlay() {
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
      setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 650);
    }

    overlay.addEventListener('click', dismiss);

    autoTimer = setTimeout(dismiss, 4000);
  }

  async function showRecording() {
    render(`
      <div class="screen screen--recording">
        <div class="recording-header">
          <span class="rec-dot"></span>
          <span class="rec-label">REC</span>
          <span class="countdown" id="countdown">${MAX_DURATION_SEC}s</span>
        </div>
        <div class="preview-wrap preview-wrap--frame-guide" id="recordingPreviewWrap">
          <video id="preview" autoplay muted playsinline></video>
          <div class="frame-guide-overlay" aria-hidden="true"></div>
        </div>
        <button class="btn btn--stop" id="stopBtn">Stop</button>
      </div>
    `);
    const preview = document.getElementById('preview');
    preview.srcObject = mediaStream;
    document.getElementById('stopBtn').addEventListener('click', stopRecording);
  }

  function showReview() {
    const sizeMB    = (recordedBlob.size / 1024 / 1024).toFixed(1);
    clearReviewObjectUrl();
    reviewObjectUrl = URL.createObjectURL(recordedBlob);

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
    document.getElementById('playback').src = reviewObjectUrl;
    document.getElementById('rerecordBtn').addEventListener('click', () => {
      clearReviewObjectUrl();
      reRecord();
    });
    document.getElementById('uploadBtn').addEventListener('click', handleUploadAttempt);
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
    stopMediaStream();
    stopAudioMonitor();
    clearSelfieObjectUrl();
    const successAudio = createAudioController({
      clips: [{ screen: 'success', lang: farmerLang }],
    });

    const displayName = farmerName ? `, ${farmerName}` : '';

    render(`
      <div class="screen screen--success">
        ${renderMuteToggle()}
        <div class="success-card success-animate" id="successCard">
          <div class="success-icon" aria-hidden="true">
            <svg viewBox="0 0 80 80" role="img" focusable="false">
              <circle cx="40" cy="40" r="36"></circle>
              <path d="M24 41.5 35 52.5 57 29.5"></path>
            </svg>
          </div>
          <p class="success-eyebrow">Submission complete</p>
          <h1>Thank you${displayName}!</h1>
          <p class="success-copy">Your video has been received successfully.</p>
          <p class="success-next">We will be in touch when your farmer card is ready.</p>
          <p class="success-footer">FORTUNE COFFEE</p>
        </div>
      </div>
    `);
    setupMuteToggle();

    requestAnimationFrame(() => {
      const card = document.getElementById('successCard');
      if (card) card.classList.add('is-visible');
    });

    successAudio.play();
  }

  // ── Recording ────────────────────────────────────────────────────────────
  async function startRecording() {
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
      stopAudioMonitor();
      recordedBlob = new Blob(recordedChunks, { type: mimeType });
      showReview();
    };

    await showRecording();
    await startAudioMonitor();
    mediaRecorder.start(1000); // collect a chunk every second

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
    clearReviewObjectUrl();
    recordedChunks = [];
    recordedBlob   = null;
    stopAudioMonitor();
    showQuestion({ attemptAutoplay: true });
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  async function uploadVideo() {
    showUploading();

    if (!selfieBlob) {
      showUploadError('Missing selfie photo. Please retake your photo and try again.');
      return;
    }

    const ext       = fileExtension();
    const timestamp = Date.now();
    const filePath  = `${farmerId}/${currentQuestion.id}_${timestamp}.${ext}`;
    const selfiePath = `farmers/${farmerId}/selfie.jpg`;

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

      console.log('[webcap] selfie upload: starting', { selfiePath, blobSize: selfieBlob.size });
      const { data: selfieUpData, error: selfieUploadError } = await supabaseClient.storage
        .from(BUCKET)
        .upload(selfiePath, selfieBlob, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      console.log('[webcap] selfie upload: done', { data: selfieUpData, error: selfieUploadError });

      let selfiePublicUrl = null;
      if (selfieUploadError) {
        console.error('[webcap] selfie upload failed (non-fatal, continuing):', selfieUploadError);
      } else {
        const { data: selfieUrlData } = supabaseClient.storage
          .from(BUCKET)
          .getPublicUrl(selfiePath);
        selfiePublicUrl = selfieUrlData.publicUrl;
      }

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

      if (selfiePublicUrl) {
        console.log('[webcap] selfie_url upsert: starting', { farmerId, selfiePublicUrl });
        const { data: farmerUpdateData, error: farmerUpdateError } = await supabaseClient
          .from(FARMERS_TABLE)
          .upsert({
            farmer_id: farmerId,
            selfie_url: selfiePublicUrl,
          }, { onConflict: 'farmer_id' });
        console.log('[webcap] selfie_url upsert: done', { data: farmerUpdateData, error: farmerUpdateError });
        if (farmerUpdateError) {
          console.error('[webcap] selfie_url upsert failed (non-fatal):', farmerUpdateError);
        }
      }

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
