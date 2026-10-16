(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const BUCKET               = 'farmer-videos';
  const FARMERS_TABLE        = 'farmers';
  const SUBMISSIONS_TABLE    = 'farmer_submissions';
  const MAX_DURATION_SEC     = 90;
  const VIDEO_BITRATE        = 2_000_000; // 2 Mbps — keeps 90s video under ~50 MB
  const QUESTIONS_URL        = '/questions/questions.json';
  const SUPPORTED_LANGS      = ['en', 'sw', 'am', 'si', 'ta', 'vi', 'hi', 'es', 'fr', 'pt', 'fil'];
  const DEFAULT_LANG         = 'en';
  const DEBUG_SELFIE_CHECK   = false;
  const SOUND_LEVEL_THRESHOLD = 0.01;
  const COUNTRY_OPTIONS = [
    'Brazil', 'Colombia', 'Ethiopia', 'Guatemala', 'Honduras',
    'India', 'Indonesia', 'Kenya', 'Mexico', 'Peru', 'Philippines',
    'Rwanda', 'Tanzania', 'Uganda', 'Vietnam', 'Yemen', 'Other',
  ];
  const DIAL_CODES = {
    'Brazil': '+55',    'Colombia': '+57',  'Ethiopia': '+251',
    'Guatemala': '+502','Honduras': '+504', 'India': '+91',
    'Indonesia': '+62', 'Kenya': '+254',    'Mexico': '+52',
    'Peru': '+51',      'Philippines': '+63','Rwanda': '+250',   'Tanzania': '+255',
    'Uganda': '+256',   'Vietnam': '+84',   'Yemen': '+967',
    'Other': '',
  };
  const ISO3_COUNTRY_NAMES = {
    'bra': 'Brazil',       'col': 'Colombia',      'eth': 'Ethiopia',
    'gtm': 'Guatemala',    'hnd': 'Honduras',       'ind': 'India',
    'idn': 'Indonesia',    'ken': 'Kenya',          'mex': 'Mexico',
    'per': 'Peru',         'phl': 'Philippines',    'rwa': 'Rwanda',
    'tza': 'Tanzania',
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
    'Mexico': 'mx',    'Peru': 'pe',      'Philippines': 'ph','Rwanda': 'rw',
    'Tanzania': 'tz',
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
  let recorderStopSafetyTimer = null;
  let recordingStopHandled = false;
  let recordingStopRequested = false;
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
  let soundCheckHeard = false;
  let soundCheckTimedOut = false;
  let soundCheckTimer = null;
  let faceDetector    = null;
  let isFaceDetectionSupported = false;
  let hasMultipleVideoInputs = false;
  let deliveredCameraSettings = null;
  let uploadInProgress = false;
  let previewViewportCleanup = null;
  let hasShownCameraPermissionNote = false;

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

    if (document.getElementById('soundStatus') && currentMicLevel >= SOUND_LEVEL_THRESHOLD) {
      soundCheckHeard = true;
      clearSoundCheckTimer();
    }
    updateSoundCheckUi();

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

  function clearSoundCheckTimer() {
    if (soundCheckTimer) {
      window.clearTimeout(soundCheckTimer);
      soundCheckTimer = null;
    }
  }

  function updateSoundCheckUi() {
    const indicator = document.getElementById('soundIndicator');
    const status = document.getElementById('soundStatus');
    const statusDetail = document.getElementById('soundStatusDetail');
    const primary = document.getElementById('soundCheckPrimaryBtn');
    const continueAnyway = document.getElementById('continueAnywayBtn');
    if (!indicator || !status || !statusDetail || !primary || !continueAnyway) return;

    if (soundCheckHeard) {
      indicator.classList.add('sound-indicator--detected');
      status.textContent = 'We can hear you';
      status.className = 'sound-status sound-status--good';
      statusDetail.textContent = 'Your microphone is picking up your voice.';
      primary.textContent = 'Next';
      continueAnyway.style.display = 'none';
    } else if (soundCheckTimedOut) {
      indicator.classList.remove('sound-indicator--detected');
      status.textContent = 'No sound detected';
      status.className = 'sound-status sound-status--warn';
      statusDetail.textContent = 'Try speaking closer to the phone or check your mic.';
      primary.textContent = 'Try again';
      continueAnyway.style.display = 'inline-block';
    } else {
      indicator.classList.remove('sound-indicator--detected');
      status.textContent = '';
      status.className = 'sound-status';
      statusDetail.textContent = '';
      primary.textContent = 'Next';
      continueAnyway.style.display = 'none';
    }
  }

  function resetSoundCheckWindow() {
    clearSoundCheckTimer();
    soundCheckHeard = false;
    soundCheckTimedOut = false;
    updateSoundCheckUi();
    soundCheckTimer = window.setTimeout(() => {
      soundCheckTimedOut = true;
      updateSoundCheckUi();
    }, 3000);
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
  }

  function handleUploadAttempt() {
    clearReviewObjectUrl();
    uploadVideo();
  }

  function setUploadInProgress(value) {
    uploadInProgress = value;
  }

  window.addEventListener('beforeunload', event => {
    if (!uploadInProgress) return;
    event.preventDefault();
    event.returnValue = '';
  });

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
      const rotationQuestions = questions.filter(question => question.in_rotation === true);
      if (rotationQuestions.length !== 1) {
        throw new Error(`Expected exactly one rotation question, found ${rotationQuestions.length}`);
      }
      currentQuestion = rotationQuestions[0];
      if (!currentQuestionIdentity() || !currentQuestion.audio_key || !currentQuestion.file_slot_key || !currentQuestionText()) {
        throw new Error('Invalid current question');
      }
      return true;
    } catch (err) {
      showError('Could not load questions. Please try again later.');
      return false;
    }
  }

  function questionTextForLanguage(question, lang) {
    if (!question || !question.text) return null;
    const requestedText = question.text[lang];
    const englishText = question.text[DEFAULT_LANG];
    return (requestedText && requestedText.trim()) || (englishText && englishText.trim()) || null;
  }

  function questionTextLanguage(question, lang) {
    if (question && question.text && question.text[lang] && question.text[lang].trim()) {
      return lang;
    }
    if (question && question.text && question.text[DEFAULT_LANG] && question.text[DEFAULT_LANG].trim()) {
      return DEFAULT_LANG;
    }
    return null;
  }

  function currentQuestionText() {
    return questionTextForLanguage(currentQuestion, farmerLang);
  }

  function currentQuestionTextLanguage() {
    return questionTextLanguage(currentQuestion, farmerLang);
  }

  function currentQuestionIdentity() {
    return currentQuestion && currentQuestion.question_id
      ? currentQuestion.question_id
      : null;
  }

  function currentQuestionAudioKey() {
    return currentQuestion && currentQuestion.audio_key
      ? currentQuestion.audio_key
      : 'question';
  }

  function currentQuestionFileSlotKey() {
    // Filenames stay on the qN slot key; immutable question_id is DB-only.
    return currentQuestion && currentQuestion.file_slot_key
      ? currentQuestion.file_slot_key
      : currentQuestionAudioKey();
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
          aspectRatio: { ideal: 9 / 16 },
        },
        audio: true,
      });
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities = typeof videoTrack.getCapabilities === 'function'
          ? videoTrack.getCapabilities()
          : null;
        if (capabilities && capabilities.zoom && Number.isFinite(capabilities.zoom.min)) {
          try {
            await videoTrack.applyConstraints({ advanced: [{ zoom: capabilities.zoom.min }] });
          } catch (err) {
            console.warn('[webcap] camera zoom minimum unavailable:', err);
          }
        }
        deliveredCameraSettings = videoTrack.getSettings();
        console.log('[webcap] camera delivered settings:', deliveredCameraSettings);
      }
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

  function isUsingFrontCamera() {
    return (deliveredCameraSettings && deliveredCameraSettings.facingMode || cameraFacingMode) === 'user';
  }

  function sizePreviewViewport(video, settings = deliveredCameraSettings) {
    const wrap = video.closest('.preview-wrap');
    if (!wrap) return;

    const applySize = () => {
      const metadataWidth = video.videoWidth || video.naturalWidth;
      const metadataHeight = video.videoHeight || video.naturalHeight;
      const hasMetadata = metadataWidth && metadataHeight;
      const width = hasMetadata ? metadataWidth : settings && settings.width;
      const height = hasMetadata ? metadataHeight : settings && settings.height;
      const aspect = width && height
        ? width / height
        : settings && Number.isFinite(settings.aspectRatio) && settings.aspectRatio > 0
          ? settings.aspectRatio
          : null;
      if (!aspect) return;

      const isLandscape = aspect > 1;
      const viewportAspect = isLandscape ? 3 / 4 : aspect;
      const screen = wrap.closest('.screen');
      const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const isSelfieScreen = screen && screen.classList.contains('screen--selfie')
        && !screen.classList.contains('screen--camera-permission');
      const maxHeight = isSelfieScreen && wrap.parentElement
        ? wrap.parentElement.clientHeight
        : (screen && screen.classList.contains('screen--sound-check') ? 0.38 : 0.62) * viewportHeight;
      const availableWidth = wrap.parentElement ? wrap.parentElement.clientWidth : window.innerWidth;
      const viewportWidth = Math.min(availableWidth, maxHeight * viewportAspect);
      wrap.classList.toggle('preview-wrap--landscape-crop', isLandscape);
      wrap.style.setProperty('--camera-aspect-ratio', String(viewportAspect));
      wrap.style.setProperty('--preview-width', `${Math.floor(viewportWidth)}px`);

      if (hasMetadata) {
        console.log('[webcap] preview orientation:', {
          width: metadataWidth,
          height: metadataHeight,
          orientation: isLandscape ? 'landscape' : 'portrait',
          cropRule: isLandscape ? 'center 3:4, sides only' : 'contain full frame',
        });
      }
    };

    if (previewViewportCleanup) previewViewportCleanup();
    applySize();
    video.addEventListener('loadedmetadata', applySize);
    video.addEventListener('resize', applySize);
    video.addEventListener('load', applySize);
    window.addEventListener('resize', applySize);
    window.addEventListener('orientationchange', applySize);
    previewViewportCleanup = () => {
      video.removeEventListener('loadedmetadata', applySize);
      video.removeEventListener('resize', applySize);
      video.removeEventListener('load', applySize);
      window.removeEventListener('resize', applySize);
      window.removeEventListener('orientationchange', applySize);
    };
  }

  function renderSelfieOutlineGuide() {
    return `
      <svg class="selfie-outline-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <ellipse class="selfie-outline-guide__head" cx="50" cy="37" rx="27.5" ry="25" />
        <path class="selfie-outline-guide__shoulders" d="M9 104C12 78 27 62 38 59M62 59C73 62 88 78 91 104" />
      </svg>
    `;
  }

  function renderCameraPreview({ id = '', mirrored = isUsingFrontCamera(), recording = false, selfieGuide = false } = {}) {
    return `
      <div class="preview-wrap preview-wrap--camera${mirrored ? ' preview-wrap--mirrored' : ''}${recording ? ' preview-wrap--recording' : ''}"${id ? ` id="${id}"` : ''}>
        ${recording ? '<div class="recording-progress" id="recordingProgressTrack" aria-hidden="true" hidden><div class="recording-progress__bar" id="recordingProgress"></div></div>' : ''}
        <div class="camera-preview-content">
          <video id="preview" autoplay muted playsinline></video>
        </div>
        ${selfieGuide ? renderSelfieOutlineGuide() : ''}
        ${recording ? '<div class="recording-countdown" id="recordingCountdown" aria-live="assertive"></div>' : ''}
      </div>
    `;
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
      selfieWrap.classList.toggle('preview-wrap--mirrored', isUsingFrontCamera());
    }
    if (preview) sizePreviewViewport(preview);
  }

  // ── Screens ──────────────────────────────────────────────────────────────
  function render(html) {
    stopCurrentAudio();
    if (previewViewportCleanup) {
      previewViewportCleanup();
      previewViewportCleanup = null;
    }
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
            <p>This video will be used by Buna Baraka to share your story with customers who buy your coffee.</p>
            <p><strong>Do you agree?</strong></p>
          </div>
          <div class="consent-actions">
            <button class="btn btn--consent btn--yes" id="consentYesBtn">✓ Agree</button>
            <button class="btn btn--consent btn--no" id="consentNoBtn">✕ Disagree</button>
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
    if (await shouldShowCameraPermissionNote()) {
      showCameraPermissionNote();
      return;
    }
    startSelfieCamera();
  }

  async function shouldShowCameraPermissionNote() {
    if (hasShownCameraPermissionNote) return false;
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return true;
    try {
      const permissions = await Promise.all([
        navigator.permissions.query({ name: 'camera' }),
        navigator.permissions.query({ name: 'microphone' }),
      ]);
      return permissions.some(permission => permission.state !== 'granted');
    } catch {
      return true;
    }
  }

  function showCameraPermissionNote() {
    hasShownCameraPermissionNote = true;
    const permissionCopy = {
      en: 'Please tap "Allow" on the next screen.',
      es: 'Por favor, toque "Permitir" en la siguiente pantalla.',
      fr: 'Veuillez appuyer sur « Autoriser » sur l\'écran suivant.',
      pt: 'Por favor, toque em "Permitir" na próxima tela.',
      sw: 'Tafadhali bonyeza "Ruhusu" kwenye skrini inayofuata.',
      vi: 'Xin quý vị bấm "Cho phép" ở màn hình tiếp theo.',
      hi: 'कृपया अगली स्क्रीन पर "अनुमति दें" दबाएँ।',
      ta: 'தயவுசெய்து அடுத்த திரையில் "அனுமதி" என்பதை அழுத்துங்கள்.',
      si: 'කරුණාකර ඊළඟ තිරයේ "ඉඩ දෙන්න" ඔබන්න.',
      am: 'እባክዎ በሚቀጥለው ገጽ ላይ "ፍቀድ" የሚለውን ይጫኑ።',
      fil: 'Pakipindot po ang "Payagan" sa susunod na screen.',
    };
    const permissionAudio = createAudioController({
      clips: [{ screen: 'permission', lang: farmerLang }],
    });
    render(`
      <div class="screen screen--selfie screen--camera-permission">
        ${renderMuteToggle()}
        <div class="camera-permission-icons" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /></svg>
          <svg viewBox="0 0 24 24" focusable="false"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-5 8a5 5 0 0 0 10 0M12 16v4m-4 0h8" /></svg>
        </div>
        <p class="camera-permission-copy">${escapeHtml(permissionCopy[farmerLang] || permissionCopy.en)}</p>
        <button class="audio-replay-icon" id="permissionReplayBtn" type="button" aria-label="Replay audio">↻</button>
        <button class="btn btn--record" id="cameraPermissionContinueBtn">Continue</button>
      </div>
    `);
    setupMuteToggle();
    document.getElementById('permissionReplayBtn').addEventListener('click', () => permissionAudio.replay());
    document.getElementById('cameraPermissionContinueBtn').addEventListener('click', startSelfieCamera);
    permissionAudio.play();
  }

  async function startSelfieCamera() {
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
            <button class="btn selfie-retake-button" id="retakeSelfieBtn">Retake</button>
            <button class="btn selfie-use-button" id="useSelfieBtn">✓ Use this photo</button>
          </div>
        `
      : `
          <div class="selfie-camera-controls">
            ${showFlipButton ? '<button class="selfie-flip-button" id="selfieFlipBtn" type="button" aria-label="Flip camera">↻</button>' : ''}
            <button class="btn selfie-take-button" id="takeSelfieBtn" type="button">Take photo</button>
          </div>
        `;

    render(`
      <div class="screen screen--selfie">
        ${renderMuteToggle()}
        <div class="selfie-preview-slot">
        ${hasCapturedSelfie
          ? `<div class="preview-wrap" id="selfiePreviewWrap">
              <img id="selfiePreviewImage" src="${selfieObjectUrl}" alt="Selfie preview">
            </div>`
          : renderCameraPreview({ id: 'selfiePreviewWrap', selfieGuide: true })}
        </div>
        ${actionHtml}
      </div>
    `);
    setupMuteToggle();

    if (hasCapturedSelfie) {
      const selfieImage = document.getElementById('selfiePreviewImage');
      if (selfieImage) sizePreviewViewport(selfieImage);
      document.getElementById('useSelfieBtn').addEventListener('click', () => {
        console.log('[webcap] selfie: "Use Photo" tapped', { selfieFeedbackTone, selfieBlob: !!selfieBlob });
        showSoundCheck();
      });
      document.getElementById('retakeSelfieBtn').addEventListener('click', () => {
        resetSelfieCaptureState();
        showSelfieCapture();
      });
    } else {
      const preview = document.getElementById('preview');
      if (preview) {
        preview.srcObject = mediaStream;
        sizePreviewViewport(preview);
      }
      const flipButton = document.getElementById('selfieFlipBtn');
      if (flipButton) {
        flipButton.addEventListener('click', switchCamera);
      }
      document.getElementById('takeSelfieBtn').addEventListener('click', startSelfieCountdown);
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
    const isLandscape = width > height;
    const cropWidth = isLandscape ? Math.floor(height * (3 / 4)) : width;
    const cropX = isLandscape ? Math.floor((width - cropWidth) / 2) : 0;
    canvas.width = cropWidth;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(preview, cropX, 0, cropWidth, height, 0, 0, cropWidth, height);

    const centralLum = measureCentralLuminance(context, cropWidth, height);
    const isTooDark = centralLum < 52;
    const subjectMissing = !hasSubjectInCenter(context, cropWidth, height);

    console.log('[webcap] selfie crop rule:', {
      orientation: isLandscape ? 'landscape' : 'portrait',
      cropRule: isLandscape ? 'center 3:4, sides only' : 'full frame',
    });

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
      const roiX = Math.floor(cropWidth * 0.25);
      const roiY = Math.floor(height * 0.10);
      const roiW = Math.floor(cropWidth * 0.50);
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
      selfieFeedbackMessage = "We couldn't see you clearly - center your head and shoulders in the outline and retake";
    } else {
      selfieFeedbackTone = 'good';
      selfieFeedbackMessage = 'Looks good ✓';
    }

    showSelfieCapture();
  }

  async function startSelfieCountdown() {
    const previewWrap = document.getElementById('selfiePreviewWrap');
    const takeButton = document.getElementById('takeSelfieBtn');
    const flipButton = document.getElementById('selfieFlipBtn');
    if (!previewWrap || !takeButton || takeButton.disabled) return;

    takeButton.disabled = true;
    if (flipButton) flipButton.disabled = true;
    const countdown = document.createElement('div');
    countdown.className = 'selfie-countdown';
    previewWrap.appendChild(countdown);

    for (const number of [3, 2, 1]) {
      countdown.textContent = String(number);
      await new Promise(resolve => window.setTimeout(resolve, 400));
    }

    if (countdown.parentNode) countdown.remove();
    await captureSelfie();
  }

  // ── Question Screen (with audio) ───────────────────────────────────────────
  function showQuestion({ attemptAutoplay = true } = {}) {
    stopAudioMonitor();
    const questionAudioKey = currentQuestionAudioKey();
    const questionText = currentQuestionText();
    const questionLanguage = currentQuestionTextLanguage() || DEFAULT_LANG;
    const updateInfoLink = isReturningFarmer
      ? `<a href="#" id="updateInfoLink" class="question-update-link">Update info / Rescind consent</a>`
      : '';

    render(`
      <div class="screen screen--question">
        ${renderMuteToggle()}
        <div class="question-listen-card">
          <p class="question-listen-text">${escapeHtml(questionText || '')}</p>
        </div>
        <button class="btn btn--small" id="playBtn" type="button">Replay audio</button>
        <button class="btn btn--record" id="readyToRecordBtn">Start recording</button>
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
          lang: questionLanguage,
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
        ${renderCameraPreview()}
        <div class="sound-check-card">
          <div class="sound-indicator" id="soundIndicator" aria-hidden="true">
            <svg class="sound-microphone" viewBox="0 0 24 24" focusable="false"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-5 8a5 5 0 0 0 10 0M12 16v4m-4 0h8" /></svg>
            <span class="sound-checkmark">✓</span>
          </div>
          <p class="sound-status" id="soundStatus"></p>
          <p class="sound-status-detail" id="soundStatusDetail"></p>
        </div>
        <button class="btn btn--record" id="soundCheckPrimaryBtn">Next</button>
        <button class="btn btn--link" id="continueAnywayBtn" style="display:none">Continue anyway</button>
      </div>
    `);

    const preview = document.getElementById('preview');
    if (preview) {
      preview.srcObject = mediaStream;
      sizePreviewViewport(preview);
    }

    await startAudioMonitor();
    resetSoundCheckWindow();

    const continueToQuestion = () => {
      clearSoundCheckTimer();
      stopCurrentAudio();
      stopAudioMonitor();
      showQuestion({ attemptAutoplay: true });
    };

    document.getElementById('soundCheckPrimaryBtn').addEventListener('click', () => {
      if (!soundCheckHeard && soundCheckTimedOut) {
        resetSoundCheckWindow();
        return;
      }
      continueToQuestion();
    });
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
    const questionText = currentQuestionText();
    render(`
      <div class="screen screen--recording">
        <div class="recording-header">
          <span class="rec-dot"></span>
          <span class="rec-label">Recording</span>
        </div>
        <p class="recording-question-band">${escapeHtml(questionText || '')}</p>
        ${renderCameraPreview({ id: 'recordingPreviewWrap', recording: true })}
        <button class="btn btn--stop" id="stopBtn" hidden>■ Stop</button>
      </div>
    `);
    const preview = document.getElementById('preview');
    preview.srcObject = mediaStream;
    sizePreviewViewport(preview);
    document.getElementById('stopBtn').addEventListener('click', () => stopRecording({ userInitiated: true }));
  }

  function showReview() {
    const questionText = currentQuestionText();
    clearReviewObjectUrl();
    reviewObjectUrl = URL.createObjectURL(recordedBlob);

    render(`
      <div class="screen screen--review">
        <div class="question-card">
          <p class="question-label">Review your response</p>
          <p class="question-text">${escapeHtml(questionText || '')}</p>
        </div>
        <div class="preview-wrap${isUsingFrontCamera() ? ' preview-wrap--mirrored' : ''}">
          <div class="camera-preview-content">
            <video id="playback" controls playsinline></video>
          </div>
        </div>
        <div class="review-actions">
          <button class="btn btn--secondary" id="rerecordBtn">Re-record</button>
          <button class="btn btn--upload" id="uploadBtn">Upload</button>
        </div>
      </div>
    `);

    // Set src after render so the element exists
    const playback = document.getElementById('playback');
    playback.src = reviewObjectUrl;
    sizePreviewViewport(playback);
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
          <p class="success-copy">Thank you! Your video has been sent.</p>
          <p class="success-footer">Buna Baraka</p>
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
  function clearRecorderStopSafetyTimer() {
    if (recorderStopSafetyTimer) {
      window.clearTimeout(recorderStopSafetyTimer);
      recorderStopSafetyTimer = null;
    }
  }

  function createRecordedBlob() {
    recordedBlob = new Blob(recordedChunks, { type: mimeType });
    return recordedBlob;
  }

  function finishRecordingToReview() {
    if (recordingStopHandled) return;
    recordingStopHandled = true;
    clearInterval(countdownTimer);
    clearRecorderStopSafetyTimer();
    stopAudioMonitor();
    createRecordedBlob();
    showReview();
  }

  function failRecording(msg) {
    if (recordingStopHandled) return;
    recordingStopHandled = true;
    clearInterval(countdownTimer);
    clearRecorderStopSafetyTimer();
    stopAudioMonitor();
    showError(msg);
  }

  function createMediaRecorder() {
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

    mediaRecorder.onstop = finishRecordingToReview;

    mediaRecorder.onerror = () => {
      if (recordedChunks.length > 0) {
        finishRecordingToReview();
      } else {
        failRecording('Recording stopped unexpectedly. Please try again.');
      }
    };
  }

  function waitFor(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function runRecordingCountdown() {
    const countdown = document.getElementById('recordingCountdown');
    for (const number of [3, 2, 1]) {
      if (countdown) countdown.textContent = number;
      await waitFor(1000);
    }
    if (countdown) countdown.remove();
  }

  function beginMediaRecording() {
    createMediaRecorder();
    mediaRecorder.start(1000); // collect a chunk every second
    void startAudioMonitor();
    const progressTrack = document.getElementById('recordingProgressTrack');
    if (progressTrack) progressTrack.hidden = false;
    const stopButton = document.getElementById('stopBtn');
    if (stopButton) stopButton.hidden = false;

    countdownTimer = setInterval(() => {
      elapsedSeconds++;
      const remaining = MAX_DURATION_SEC - elapsedSeconds;
      const progress = document.getElementById('recordingProgress');
      if (progress) progress.style.width = `${Math.max(0, (remaining / MAX_DURATION_SEC) * 100)}%`;
      if (remaining <= 0) stopRecording();
    }, 1000);
  }

  async function startRecording() {
    recordedChunks = [];
    recordedBlob = null;
    recordingStopHandled = false;
    recordingStopRequested = false;
    clearRecorderStopSafetyTimer();
    elapsedSeconds = 0;

    await showRecording();
    await runRecordingCountdown();
    beginMediaRecording();
  }

  function stopRecording({ userInitiated = false } = {}) {
    if (recordingStopRequested) return;
    recordingStopRequested = true;
    clearInterval(countdownTimer);
    if (userInitiated) {
      const stopButton = document.getElementById('stopBtn');
      if (stopButton) {
        stopButton.disabled = true;
        stopButton.textContent = 'Saving…';
      }
      window.setTimeout(stopActiveRecorder, 1000);
      return;
    }
    stopActiveRecorder();
  }

  function stopActiveRecorder() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      clearRecorderStopSafetyTimer();
      recorderStopSafetyTimer = window.setTimeout(() => {
        finishRecordingToReview();
      }, 3000);
    } else if (mediaRecorder && !recordingStopHandled) {
      finishRecordingToReview();
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

    setUploadInProgress(true);

    const ext       = fileExtension();
    const timestamp = Date.now();
    const questionId = currentQuestionIdentity();
    const askedLanguage = currentQuestionTextLanguage();
    const questionTextAsAsked = currentQuestionText();
    const fileSlotKey = currentQuestionFileSlotKey();
    const filePath  = `${farmerId}/${fileSlotKey}_${timestamp}.${ext}`;
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
          question_id: questionId,
          asked_language: askedLanguage,
          question_text_as_asked: questionTextAsAsked,
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

      setUploadInProgress(false);
      setTimeout(showSuccess, 400);

    } catch (err) {
      clearInterval(ticker);
      setUploadInProgress(false);
      console.error('[webcap] upload error:', err);
      showUploadError(err.message || 'Unknown error. Please try again.');
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
