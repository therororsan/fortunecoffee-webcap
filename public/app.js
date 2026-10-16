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
    'Rwanda', 'Tanzania', 'Uganda', 'Vietnam', 'Yemen', 'Sri Lanka',
    'China', 'Hong Kong', 'Other',
  ];
  const DIAL_CODES = {
    'Brazil': '+55',    'Colombia': '+57',  'Ethiopia': '+251',
    'Guatemala': '+502','Honduras': '+504', 'India': '+91',
    'Indonesia': '+62', 'Kenya': '+254',    'Mexico': '+52',
    'Peru': '+51',      'Philippines': '+63','Rwanda': '+250',   'Tanzania': '+255',
    'Uganda': '+256',   'Vietnam': '+84',   'Yemen': '+967',
    'Sri Lanka': '+94', 'China': '+86',     'Hong Kong': '+852',
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

  function countryOptionFromValue(value) {
    if (!value) return '';
    const raw = String(value).trim();
    const fromCode = ISO3_COUNTRY_NAMES[raw.toLowerCase()];
    if (fromCode && COUNTRY_OPTIONS.includes(fromCode)) return fromCode;
    return COUNTRY_OPTIONS.find(country => country.toLowerCase() === raw.toLowerCase()) || '';
  }

  function suggestedCountryFromTimeZone() {
    const suggestions = {
      'Africa/Addis_Ababa': 'Ethiopia', 'Africa/Nairobi': 'Kenya',
      'Africa/Dar_es_Salaam': 'Tanzania', 'Africa/Kampala': 'Uganda',
      'Asia/Colombo': 'Sri Lanka', 'Asia/Kolkata': 'India',
      'Asia/Ho_Chi_Minh': 'Vietnam', 'Asia/Manila': 'Philippines',
      'America/Bogota': 'Colombia', 'America/Guatemala': 'Guatemala',
      'America/Tegucigalpa': 'Honduras', 'Asia/Hong_Kong': 'Hong Kong',
      'Asia/Shanghai': 'China',
    };
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (suggestions[timeZone]) return suggestions[timeZone];
      return /^America\/(Araguaina|Bahia|Belem|Boa_Vista|Campo_Grande|Cuiaba|Eirunepe|Fortaleza|Maceio|Manaus|Noronha|Porto_Velho|Recife|Rio_Branco|Santarem|Sao_Paulo)$/.test(timeZone)
        ? 'Brazil'
        : '';
    } catch {
      return '';
    }
  }

  const FLAG_CODES = {
    'Brazil': 'br',    'Colombia': 'co',  'Ethiopia': 'et', 'Guatemala': 'gt',
    'Honduras': 'hn',  'India': 'in',     'Indonesia': 'id','Kenya': 'ke',
    'Mexico': 'mx',    'Peru': 'pe',      'Philippines': 'ph','Rwanda': 'rw',
    'Tanzania': 'tz',
    'Uganda': 'ug',    'Vietnam': 'vn',   'Yemen': 'ye',
    'Sri Lanka': 'lk', 'China': 'cn',     'Hong Kong': 'hk',
  };

  const COUNTRY_NAME_EXAMPLES = {
    'Ethiopia': 'Abebe Kebede', 'Kenya': 'Wanjiru Kamau',
    'Tanzania': 'Neema Mushi', 'Uganda': 'Grace Nakato',
    'Sri Lanka': 'Nimal Perera', 'India': 'Priya Sharma',
    'Vietnam': 'Nguyễn Văn An', 'Philippines': 'Maria Santos',
    'Colombia': 'Jorge Rodríguez', 'Guatemala': 'Ana López',
    'Honduras': 'Carlos Mejía', 'Brazil': 'João Silva',
    'China': 'Wang Fang', 'Hong Kong': 'Chan Tai Man',
  };

  const CONSENT_TEXTS = {
    en: [
      'Hi.',
      'We would like to share your story with coffee drinkers.',
      'We will take your photo and video, and put them on the internet.',
      'A computer will also make a drawing of you for our cards.',
      'You can say no, or ask us later to remove them.',
      'If you agree, press the green button.',
    ],
    es: [
      'Hola.',
      'Nos gustaría compartir su historia con las personas que toman café.',
      'Tomaremos su foto y un video, y los pondremos en internet.',
      'Una computadora también hará un dibujo de usted para nuestras tarjetas.',
      'Usted puede decir que no, o pedirnos más adelante que los quitemos.',
      'Si está de acuerdo, presione el botón verde.',
    ],
    fr: [
      'Bonjour.',
      'Nous aimerions partager votre histoire avec les personnes qui boivent du café.',
      'Nous prendrons votre photo et enregistrerons une vidéo, puis nous les mettrons sur internet.',
      'Un ordinateur fera aussi un dessin de vous pour nos cartes.',
      'Vous pouvez dire non, ou nous demander plus tard de les retirer.',
      "Si vous êtes d'accord, appuyez sur le bouton vert.",
    ],
    pt: [
      'Olá.',
      'Gostaríamos de compartilhar a sua história com as pessoas que tomam café.',
      'Vamos tirar sua foto e gravar um vídeo, e colocá-los na internet.',
      'Um computador também vai fazer um desenho seu para os nossos cartões.',
      'Você pode dizer não, ou pedir depois para que a gente os retire.',
      'Se concordar, aperte o botão verde.',
    ],
    sw: [
      'Habari.',
      'Tungependa kushiriki hadithi yako na watu wanaokunywa kahawa.',
      'Tutakupiga picha na kurekodi video, na kuziweka mtandaoni.',
      'Kompyuta pia itatengeneza mchoro wako kwa ajili ya kadi zetu.',
      'Unaweza kukataa, au baadaye utuombe tuziondoe.',
      'Ukikubali, bonyeza kitufe cha kijani.',
    ],
    vi: [
      'Xin chào.',
      'Chúng tôi muốn chia sẻ câu chuyện của quý vị với những người uống cà phê.',
      'Chúng tôi sẽ chụp ảnh và quay video quý vị, rồi đăng lên mạng.',
      'Máy tính cũng sẽ vẽ một hình vẽ của quý vị cho các tấm thẻ của chúng tôi.',
      'Quý vị có thể từ chối, hoặc sau này nhờ chúng tôi gỡ ảnh và video xuống.',
      'Nếu quý vị đồng ý, hãy bấm nút màu xanh lá.',
    ],
    hi: [
      'नमस्ते।',
      'हम आपकी कहानी कॉफ़ी पीने वालों के साथ बाँटना चाहते हैं।',
      'हम आपकी फ़ोटो और वीडियो लेंगे, और उन्हें इंटरनेट पर डालेंगे।',
      'कंप्यूटर हमारे कार्डों के लिए आपका एक चित्र भी बनाएगा।',
      'आप मना कर सकते हैं, या बाद में हमसे उन्हें हटाने के लिए कह सकते हैं।',
      'अगर आप सहमत हैं, तो हरा बटन दबाएँ।',
    ],
    ta: [
      'வணக்கம்.',
      'உங்கள் கதையை காபி குடிப்பவர்களுடன் பகிர விரும்புகிறோம்.',
      'உங்கள் புகைப்படத்தையும் வீடியோவையும் எடுத்து, இன்டர்நெட்டில் வைப்போம்.',
      'எங்கள் அட்டைகளுக்காக, கணினி உங்கள் ஓவியம் ஒன்றையும் உருவாக்கும்.',
      'நீங்கள் மறுக்கலாம், அல்லது பின்னர் அவற்றை நீக்க எங்களிடம் சொல்லலாம்.',
      'நீங்கள் சம்மதித்தால், பச்சை பட்டனை அழுத்துங்கள்.',
    ],
    si: [
      'ආයුබෝවන්.',
      'ඔබේ කතාව කෝපි බොන අය සමඟ බෙදාගන්න අපි කැමතියි.',
      'අපි ඔබේ ඡායාරූපයක් සහ වීඩියෝවක් අරගෙන, ඒවා අන්තර්ජාලයට දමනවා.',
      'අපගේ කාඩ්පත් සඳහා පරිගණකයක් ඔබේ චිත්‍රයක්ද සාදනවා.',
      'ඔබට ප්‍රතික්ෂේප කළ හැකියි, නැත්නම් පසුව ඒවා ඉවත් කරන්න කියා අපෙන් ඉල්ලන්න පුළුවන්.',
      'ඔබ එකඟ නම්, කොළ පාට බොත්තම ඔබන්න.',
    ],
    am: [
      'ሰላም።',
      'ታሪክዎን ቡና ከሚጠጡ ሰዎች ጋር ማካፈል እንፈልጋለን።',
      'ፎቶዎንና ቪዲዮዎን አንስተን በኢንተርኔት ላይ እናስቀምጣቸዋለን።',
      'ኮምፒውተር ደግሞ ለካርዶቻችን የእርስዎን ስዕል ይሰራል።',
      'እምቢ ማለት ይችላሉ፣ ወይም በኋላ እንድናስወግዳቸው ሊጠይቁን ይችላሉ።',
      'ከተስማሙ፣ አረንጓዴውን ቁልፍ ይጫኑ።',
    ],
    fil: [
      'Kumusta po.',
      'Gusto po naming ibahagi ang inyong kuwento sa mga taong umiinom ng kape.',
      'Kukunan po namin kayo ng larawan at video, at ilalagay ang mga ito sa internet.',
      'Gagawa rin po ang computer ng guhit ninyo para sa aming mga card.',
      'Puwede po kayong tumanggi, o hilingin sa amin sa ibang araw na alisin ang mga ito.',
      'Kung pumapayag po kayo, pindutin ang berdeng button.',
    ],
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
  let screenAudioController = null;
  let audioToggleState = 'idle';
  let audioToggleTimer = null;
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
  let soundCheckListening = false;
  let soundCheckListeningTimer = null;
  let faceDetector    = null;
  let isFaceDetectionSupported = false;
  let hasMultipleVideoInputs = false;
  let deliveredCameraSettings = null;
  let uploadInProgress = false;
  let previewViewportCleanup = null;
  let hasShownCameraPermissionNote = false;
  let activeHistoryScreen = 'registration';
  let appHistoryReady = false;

  const HISTORY_BLOCKED_SCREENS = new Set([
    'countdown', 'recording', 'recording-review', 'upload',
  ]);

  function setHistoryScreen(screen, { push = true } = {}) {
    activeHistoryScreen = screen;
    if (appHistoryReady && push) {
      history.pushState({ screen }, '', window.location.href);
    }
  }

  function restoreHistoryScreen(screen) {
    activeHistoryScreen = screen;
    if (appHistoryReady) {
      history.replaceState({ screen }, '', window.location.href);
    }
  }

  function clearConsentForRegistration() {
    consentGiven = null;
    consentTime = null;
  }

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

    const indicator = document.getElementById('soundIndicator');
    if (indicator) {
      const level = Math.min(1, currentMicLevel / 0.08);
      indicator.style.setProperty('--sound-level', level.toFixed(3));
    }

    if (
      soundCheckListening
      && document.getElementById('soundStatus')
      && currentMicLevel >= SOUND_LEVEL_THRESHOLD
    ) {
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
    soundCheckListening = false;
    clearSoundCheckListeningTimer();
  }

  function clearSoundCheckTimer() {
    if (soundCheckTimer) {
      window.clearTimeout(soundCheckTimer);
      soundCheckTimer = null;
    }
  }

  function clearSoundCheckListeningTimer() {
    if (soundCheckListeningTimer) {
      window.clearTimeout(soundCheckListeningTimer);
      soundCheckListeningTimer = null;
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
      primary.textContent = 'Next →';
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
    clearSoundCheckListeningTimer();
    soundCheckListening = true;
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

    history.replaceState({ screen: 'registration' }, '', window.location.href);
    activeHistoryScreen = 'registration';
    appHistoryReady = true;

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

  function renderMuteToggleIcon(muted) {
    const isPlaying = !muted && audioToggleState === 'playing';
    return `
      <svg class="mute-toggle-icon${isPlaying ? ' is-playing' : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 10v4h3l4 3V7l-4 3H4Z"></path>
        ${muted
          ? '<path d="m5 5 14 14"></path>'
          : '<path class="mute-toggle-wave mute-toggle-wave--1" d="M15 9.5a4 4 0 0 1 0 5"></path><path class="mute-toggle-wave mute-toggle-wave--2" d="M18 7a7 7 0 0 1 0 10"></path><path class="mute-toggle-wave mute-toggle-wave--3" d="M20.5 4.5a10.5 10.5 0 0 1 0 15"></path>'}
      </svg>
    `;
  }

  function muteToggleShowsLabel() {
    return audioToggleState !== 'playing';
  }

  function renderMuteToggleContent() {
    return `${renderMuteToggleIcon(isMuted)}${muteToggleShowsLabel() ? '<span class="mute-toggle-label">Tap for sound</span>' : ''}`;
  }

  function renderMuteToggle() {
    return `
      <div class="mute-toggle-wrap" style="width:100%; display:flex; justify-content:flex-end;">
        <button
          class="btn btn--small"
          id="muteToggleBtn"
          data-mute-toggle
          type="button"
          style="width:auto; min-width:56px; padding:10px 14px;"
        >${renderMuteToggleContent()}</button>
      </div>
    `;
  }

  function renderAudioReplayButton(id, className = '') {
    return `
      <button class="audio-replay-icon${className ? ` ${className}` : ''}" id="${id}" type="button" aria-label="Replay audio">
        <span aria-hidden="true">↺</span>
      </button>
    `;
  }

  function renderCameraIcon(className = '') {
    return `
      <svg class="button-icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"></path>
        <circle cx="12" cy="13" r="3.5"></circle>
      </svg>
    `;
  }

  function syncMuteToggleButton(button) {
    if (!button) return;
    button.innerHTML = renderMuteToggleContent();
    const action = audioToggleState === 'playing' ? 'Mute audio' : 'Play audio';
    button.setAttribute('aria-label', action);
    button.setAttribute('title', action);
  }

  function syncMuteToggleButtons() {
    document.querySelectorAll('[data-mute-toggle]').forEach(syncMuteToggleButton);
  }

  function clearAudioToggleTimer() {
    if (audioToggleTimer) {
      window.clearTimeout(audioToggleTimer);
      audioToggleTimer = null;
    }
  }

  function setAudioToggleState(nextState) {
    audioToggleState = nextState;
    if (nextState === 'playing' || nextState === 'needs-tap') {
      clearAudioToggleTimer();
    }
    syncMuteToggleButtons();
  }

  function resetScreenAudioController() {
    clearAudioToggleTimer();
    screenAudioController = null;
    audioToggleState = 'idle';
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
    if (!isMuted) audioToggleState = 'idle';
    syncMuteToggleButtons();
  }

  function setMuted(nextMuted) {
    isMuted = !!nextMuted;
    if (isMuted) {
      audioToggleState = 'needs-tap';
      stopCurrentAudio();
    }
    syncMuteToggleButtons();
  }

  function setupMuteToggle(controller) {
    const button = document.getElementById('muteToggleBtn');
    if (!button) return;
    screenAudioController = controller || null;
    audioToggleState = isMuted ? 'needs-tap' : 'idle';
    clearAudioToggleTimer();
    if (!isMuted && screenAudioController) {
      audioToggleTimer = window.setTimeout(() => {
        if (audioToggleState !== 'playing') setAudioToggleState('needs-tap');
      }, 1000);
    }
    syncMuteToggleButton(button);
    button.addEventListener('click', () => {
      if (audioToggleState === 'playing') {
        setMuted(true);
        return;
      }
      if (!screenAudioController) return;
      if (isMuted) setMuted(false);
      setAudioToggleState('idle');
      screenAudioController.replay();
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
        syncMuteToggleButtons();
        resolve(status);
      };

      currentAudio = audio;
      currentAudioSettle = finish;
      audio.addEventListener('play', () => {
        if (currentAudio === audio) setAudioToggleState('playing');
      });
      audio.addEventListener('playing', () => {
        if (currentAudio === audio) setAudioToggleState('playing');
      });
      audio.addEventListener('pause', () => {
        if (currentAudio === audio) setAudioToggleState('idle');
      });
      audio.onended = () => {
        if (currentAudio === audio) setAudioToggleState('idle');
        finish('ended');
      };
      audio.onerror = () => {
        if (currentAudio === audio) setAudioToggleState('needs-tap');
        finish('error');
      };

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            // Some mobile browsers resolve playback before they dispatch a
            // paintable `playing` event, so mirror the real play promise too.
            if (currentAudio === audio) setAudioToggleState('playing');
            if (typeof options.onPlayStart === 'function') {
              options.onPlayStart();
            }
            syncMuteToggleButtons();
          })
          .catch(() => {
            if (currentAudio === audio) setAudioToggleState('needs-tap');
            finish('play-error');
          });
      } else {
        if (currentAudio === audio) setAudioToggleState('playing');
        if (typeof options.onPlayStart === 'function') {
          options.onPlayStart();
        }
        syncMuteToggleButtons();
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
        return 'muted';
      }

      let playStartHandled = false;
      let finalResult = 'ended';

      for (const clip of sequence) {
        if (isMuted) {
          if (completeOnStop && typeof onComplete === 'function') {
            onComplete();
          }
          return 'muted';
        }

        if (clip.pauseMs) {
          const pauseResult = await waitForAudioPause(clip.pauseMs);
          if (pauseResult === 'stopped') {
            if (completeOnStop && typeof onComplete === 'function') {
              onComplete();
            }
            return 'stopped';
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
          return result;
        }
        finalResult = result;
      }

      if (!isMuted && typeof onComplete === 'function') {
        onComplete();
      }
      return finalResult;
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
          width:  { ideal: 1280 },
          height: { ideal: 960  },
          aspectRatio: { ideal: 4 / 3 },
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

  function stopCameraResourcesForHistory() {
    stopAudioMonitor();
    if (audioSourceNode) {
      try {
        audioSourceNode.disconnect();
      } catch {}
    }
    audioSourceNode = null;
    analyserNode = null;
    analyserData = null;
    audioStreamForMonitor = null;
    stopMediaStream();
  }

  function returnToRegistrationFromHistory() {
    stopCurrentAudio();
    stopCameraResourcesForHistory();
    clearConsentForRegistration();
    restoreHistoryScreen('registration');
    showRegistryForm();
  }

  function returnToConsentFromHistory() {
    stopCurrentAudio();
    stopCameraResourcesForHistory();
    resetSelfieCaptureState();
    restoreHistoryScreen('consent');
    showConsent({ attemptAutoplay: false, history: false });
  }

  async function returnToSelfieLiveFromHistory() {
    stopAudioMonitor();
    if (!mediaStream && !await initCamera()) return;
    restoreHistoryScreen('selfie-live');
    showSelfieCapture({ showGuide: true, attemptAutoplay: false, forceLive: true, history: false });
  }

  function returnToSelfieReviewFromHistory() {
    stopCurrentAudio();
    stopAudioMonitor();
    if (!selfieBlob || !selfieObjectUrl) {
      void returnToSelfieLiveFromHistory();
      return;
    }
    restoreHistoryScreen('selfie-review');
    showSelfieCapture({ history: false });
  }

  async function returnToSoundCheckFromHistory() {
    stopCurrentAudio();
    stopAudioMonitor();
    if (!mediaStream && !await initCamera()) return;
    restoreHistoryScreen('soundcheck');
    await showSoundCheck({ history: false });
  }

  function handleHistoryPopState() {
    const fromScreen = activeHistoryScreen;

    if (fromScreen === 'registration' || fromScreen === 'success') {
      return;
    }
    if (HISTORY_BLOCKED_SCREENS.has(fromScreen)) {
      history.pushState({ screen: fromScreen }, '', window.location.href);
      return;
    }

    switch (fromScreen) {
      case 'prepermission':
      case 'consent':
        returnToRegistrationFromHistory();
        break;
      case 'selfie-live':
        returnToConsentFromHistory();
        break;
      case 'selfie-review':
        void returnToSelfieLiveFromHistory();
        break;
      case 'soundcheck':
        returnToSelfieReviewFromHistory();
        break;
      case 'question':
        void returnToSoundCheckFromHistory();
        break;
      default:
        break;
    }
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
      const isRecordingPreview = wrap.classList.contains('preview-wrap--recording');
      const viewportAspect = isLandscape
        ? (isRecordingPreview ? 4 / 5 : 3 / 4)
        : aspect;
      const screen = wrap.closest('.screen');
      const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const isSelfieScreen = screen && screen.classList.contains('screen--selfie')
        && !screen.classList.contains('screen--camera-permission');
      const isSoundCheckScreen = screen && screen.classList.contains('screen--sound-check');
      const fillsAvailableSlot = (isSelfieScreen || isSoundCheckScreen)
        && wrap.parentElement
        && wrap.parentElement.clientHeight > 0;
      const maxHeight = fillsAvailableSlot
        ? wrap.parentElement.clientHeight
        : 0.62 * viewportHeight;
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
          cropRule: isLandscape
            ? `center ${isRecordingPreview ? '4:5' : '3:4'}, sides only`
            : 'contain full frame',
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
        <ellipse class="selfie-outline-guide__head" cx="50" cy="40" rx="27.5" ry="26" />
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
    resetScreenAudioController();
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
    setHistoryScreen('registration', { push: false });
    const flagHtml = country => {
      const code = FLAG_CODES[country];
      return code
        ? `<img src="https://flagcdn.com/24x18/${code}.png" style="vertical-align:middle;margin-right:6px;" alt="">`
        : '';
    };
    const selectedCountry = countryOptionFromValue(farmerCountry);
    const suggestedCountry = selectedCountry ? '' : suggestedCountryFromTimeZone();
    const csOpts = COUNTRY_OPTIONS.map(name => {
      return `<li class="cs-opt" data-value="${name}">${flagHtml(name)}${name}</li>`;
    }).join('');
    const suggestedOption = suggestedCountry
      ? `<li class="cs-opt cs-opt--suggested" data-value="${suggestedCountry}">Suggested: ${flagHtml(suggestedCountry)}${suggestedCountry}</li>`
      : '';

    render(`
      <div class="screen screen--registry">
        <div class="card">
          <form class="registry-form" id="registryForm" novalidate>
            <div class="form-group">
              <label>Country/Region *</label>
              <div class="cs-wrap" id="csWrap">
                <div class="cs-trigger" id="csTrigger" role="button" tabindex="0" aria-expanded="false">
                  <span id="csDisplay" class="cs-placeholder">📍 Choose country</span>
                  <span class="cs-arrow">▾</span>
                </div>
                <ul class="cs-list" id="csList">
                  <li class="cs-opt cs-opt--empty" data-value="">📍 Choose country</li>
                  ${suggestedOption}
                  ${csOpts}
                </ul>
                <input type="hidden" id="countrySelect">
              </div>
              <p class="field-error" id="countryError" aria-live="polite"></p>
            </div>
            <div class="form-group">
              <label for="nameInput">Name *</label>
              <input type="text" id="nameInput" placeholder="Your name" required enterkeyhint="next" value="${escapeHtml(farmerName || '')}">
              <p class="field-error" id="nameError" aria-live="polite"></p>
            </div>
            <div class="form-group">
              <label for="phoneInput">Phone *</label>
              <div class="phone-input-wrap">
                <span id="phonePrefix" class="phone-prefix"></span>
                <input type="tel" id="phoneInput" placeholder="📞 Phone number" inputmode="numeric" pattern="[0-9]*" maxlength="15" enterkeyhint="done">
              </div>
              <p class="field-error" id="phoneError" aria-live="polite"></p>
            </div>
            <button class="btn registry-submit-button" id="registrySubmitBtn" type="submit">Continue →</button>
          </form>
        </div>
      </div>
    `);

    // ── Custom dropdown wiring ───────────────────────────────────────────────
    const csWrap    = document.getElementById('csWrap');
    const csList    = document.getElementById('csList');
    const csHidden  = document.getElementById('countrySelect');
    const csDisplay = document.getElementById('csDisplay');
    const csTrigger = document.getElementById('csTrigger');
    const nameInput = document.getElementById('nameInput');
    const phoneInput = document.getElementById('phoneInput');
    const phoneWrap = phoneInput.closest('.phone-input-wrap');

    const clearFieldError = (element, errorId) => {
      element.classList.remove('is-invalid');
      const error = document.getElementById(errorId);
      if (error) error.textContent = '';
    };
    const showFieldError = (element, errorId, message) => {
      element.classList.add('is-invalid');
      const error = document.getElementById(errorId);
      if (error) error.textContent = message;
    };
    const updateNamePlaceholder = country => {
      nameInput.placeholder = COUNTRY_NAME_EXAMPLES[country]
        ? `e.g. ${COUNTRY_NAME_EXAMPLES[country]}`
        : 'Your name';
    };
    const updatePhonePrefix = country => {
      const prefix = DIAL_CODES[country] || '';
      const phonePrefix = document.getElementById('phonePrefix');
      phonePrefix.innerHTML = prefix ? `${flagHtml(country)}${prefix}` : '';
      phonePrefix.style.display = prefix ? 'inline-flex' : 'none';
    };
    const setCountry = country => {
      csHidden.value = country;
      csWrap.classList.remove('cs-open');
      csTrigger.setAttribute('aria-expanded', 'false');
      if (country) {
        csDisplay.innerHTML = `${flagHtml(country)}${country}`;
        csDisplay.classList.remove('cs-placeholder');
        clearFieldError(csTrigger, 'countryError');
      } else {
        csDisplay.textContent = '📍 Choose country';
        csDisplay.classList.add('cs-placeholder');
      }
      updateNamePlaceholder(country);
      updatePhonePrefix(country);
    };

    csTrigger.addEventListener('click', () => {
      csWrap.classList.toggle('cs-open');
      csTrigger.setAttribute('aria-expanded', String(csWrap.classList.contains('cs-open')));
    });

    csList.addEventListener('click', e => {
      const opt = e.target.closest('.cs-opt');
      if (!opt) return;
      setCountry(opt.dataset.value);
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (csWrap && !csWrap.contains(e.target)) csWrap.classList.remove('cs-open');
    });

    setCountry(selectedCountry);
    const linkedDigits = String(farmerPhone || '').replace(/\D/g, '');
    const linkedPrefix = (DIAL_CODES[selectedCountry] || '').replace(/\D/g, '');
    phoneInput.value = linkedPrefix && linkedDigits.startsWith(linkedPrefix)
      ? linkedDigits.slice(linkedPrefix.length, linkedPrefix.length + 15)
      : linkedDigits.slice(0, 15);

    nameInput.addEventListener('input', () => {
      if (nameInput.value.trim().replace(/\s/g, '').length >= 2) {
        clearFieldError(nameInput, 'nameError');
      }
    });
    phoneInput.addEventListener('input', () => {
      phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 15);
      if (phoneInput.value.replace(/^0+/, '').length >= 6) {
        clearFieldError(phoneWrap, 'phoneError');
      }
    });
    phoneInput.addEventListener('paste', event => {
      event.preventDefault();
      const digits = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      phoneInput.setRangeText(digits, phoneInput.selectionStart, phoneInput.selectionEnd, 'end');
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    document.getElementById('registryForm').addEventListener('submit', event => {
      event.preventDefault();
      const name = nameInput.value.trim();
      const country = csHidden.value;
      const phoneDigits = phoneInput.value.replace(/\D/g, '');
      const phoneLocal = phoneDigits.replace(/^0+/, '');
      let firstInvalid = null;

      if (!country) {
        showFieldError(csTrigger, 'countryError', 'Please choose your country');
        firstInvalid = csTrigger;
      }
      if (name.replace(/\s/g, '').length < 2) {
        showFieldError(nameInput, 'nameError', 'Please enter your name');
        firstInvalid = firstInvalid || nameInput;
      }
      if (!phoneDigits) {
        showFieldError(phoneWrap, 'phoneError', 'Please enter your phone number');
        firstInvalid = firstInvalid || phoneInput;
      } else if (phoneLocal.length < 6) {
        showFieldError(phoneWrap, 'phoneError', 'Please enter your full phone number');
        firstInvalid = firstInvalid || phoneInput;
      }
      if (firstInvalid) {
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }

      farmerName    = name;
      farmerCountry = country;
      farmerPhone   = `${DIAL_CODES[country] || ''}${phoneLocal}`;
      proceedToConsent();
    });

    const scrollContinueIntoView = () => {
      const submitButton = document.getElementById('registrySubmitBtn');
      if (submitButton) submitButton.scrollIntoView({ block: 'end', behavior: 'smooth' });
    };
    phoneInput.addEventListener('focus', () => {
      window.setTimeout(scrollContinueIntoView, 250);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scrollContinueIntoView, { once: true });
      }
    });
  }

  function showRegistryConfirm() {
    setHistoryScreen('registration', { push: false });
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
          <button class="btn btn--primary" id="registryConfirmBtn">Confirm & Continue →</button>
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
  function showConsent({ attemptAutoplay = false, history = true } = {}) {
    setHistoryScreen('consent', { push: history });
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
    const consentLines = CONSENT_TEXTS[farmerLang] || CONSENT_TEXTS[DEFAULT_LANG];
    const consentTextClass = consentLines.join('').length > 520 ? ' consent-text--compact' : '';

    render(`
      <div class="screen screen--consent">
        ${renderMuteToggle()}
        <div class="consent-body">
          <div class="consent-text${consentTextClass}">
            ${renderAudioReplayButton('consentReplayBtn')}
            ${consentLines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
          </div>
          <div class="consent-actions">
            <button class="btn btn--consent btn--yes" id="consentYesBtn">✓ Agree</button>
            <button class="btn btn--consent btn--no" id="consentNoBtn">✕ Disagree</button>
          </div>
          <a class="contact-line" href="mailto:ron@bunabaraka.org">Questions or removal requests: ron@bunabaraka.org</a>
        </div>
      </div>
    `);
    setupMuteToggle(consentAudio);
    document.getElementById('consentReplayBtn').addEventListener('click', () => consentAudio.replay());

    document.getElementById('consentYesBtn').addEventListener('click', async () => {
      if (!isMuted && !currentAudio && !consentAudioAutoplaySucceeded) {
        consentAudio.play();
      }
      consentGiven = true;
      consentTime = new Date().toISOString();
      const agreedAt = consentTime;
      try {
        await syncFarmerConsent(true);
      } catch (err) {
        console.error('[webcap] consent update error:', err);
        showError('Could not save your consent. Please try again.');
        return;
      }
      if (activeHistoryScreen !== 'consent' || consentGiven !== true || consentTime !== agreedAt) {
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

  function showCameraPermissionNote({ history = true } = {}) {
    setHistoryScreen('prepermission', { push: history });
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
        <div class="camera-permission-instruction">
          ${renderAudioReplayButton('permissionReplayBtn')}
          <div class="camera-permission-icons" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false"><path d="M4 7h3l1.5-2h7L17 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /></svg>
            <svg viewBox="0 0 24 24" focusable="false"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-5 8a5 5 0 0 0 10 0M12 16v4m-4 0h8" /></svg>
          </div>
          <p class="camera-permission-copy">${escapeHtml(permissionCopy[farmerLang] || permissionCopy.en)}</p>
        </div>
        <button class="btn btn--record" id="cameraPermissionContinueBtn">Continue →</button>
      </div>
    `);
    setupMuteToggle(permissionAudio);
    document.getElementById('permissionReplayBtn').addEventListener('click', () => permissionAudio.replay());
    document.getElementById('cameraPermissionContinueBtn').addEventListener('click', startSelfieCamera);
    permissionAudio.play();
  }

  async function startSelfieCamera() {
    const originatingScreen = activeHistoryScreen;
    showLoading();
    const cameraReady = await initCamera();
    if (!cameraReady) return;
    if (activeHistoryScreen !== originatingScreen) {
      stopMediaStream();
      return;
    }
    showSelfieCapture({ showGuide: true, attemptAutoplay: true });
  }

  function showSelfieCapture({
    showGuide = false,
    attemptAutoplay = false,
    forceLive = false,
    history = true,
  } = {}) {
    const hasCapturedSelfie = !forceLive && !!(selfieBlob && selfieObjectUrl);
    setHistoryScreen(hasCapturedSelfie ? 'selfie-review' : 'selfie-live', { push: history });
    const showFlipButton = !hasCapturedSelfie && hasMultipleVideoInputs;
    const selfieAudio = hasCapturedSelfie
      ? null
      : createAudioController({ clips: [{ screen: 'selfie', lang: farmerLang }] });
    const actionHtml = hasCapturedSelfie
      ? `
          <div class="selfie-actions">
            <button class="btn selfie-retake-button" id="retakeSelfieBtn">↺ Retake</button>
            <button class="btn selfie-use-button" id="useSelfieBtn">✓ Use this photo</button>
          </div>
        `
      : `
          <div class="selfie-camera-controls">
            ${showFlipButton ? '<button class="selfie-flip-button" id="selfieFlipBtn" type="button" aria-label="Flip camera">↻</button>' : ''}
            <button class="btn selfie-take-button" id="takeSelfieBtn" type="button">${renderCameraIcon()}<span>Take photo</span></button>
          </div>
        `;

    render(`
      <div class="screen screen--selfie">
        ${hasCapturedSelfie ? '' : renderMuteToggle()}
        ${hasCapturedSelfie ? '' : '<h1 class="selfie-live-title">🤳 Take a selfie</h1>'}
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
    if (!hasCapturedSelfie) setupMuteToggle(selfieAudio);

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

    if (attemptAutoplay && selfieAudio) {
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
  function showQuestion({ attemptAutoplay = true, history = true } = {}) {
    setHistoryScreen('question', { push: history });
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
          ${renderAudioReplayButton('playBtn')}
          <p class="question-listen-text">${escapeHtml(questionText || '')}</p>
        </div>
        <button class="btn btn--record" id="readyToRecordBtn"><span class="record-start-dot" aria-hidden="true"></span>Start recording</button>
        ${updateInfoLink}
      </div>
    `);
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
    setupMuteToggle(questionAudio);

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

  async function showSoundCheck({ history = true } = {}) {
    setHistoryScreen('soundcheck', { push: history });
    const soundCheckPrompt = createAudioController({
      clips: [{ screen: 'soundcheck', lang: farmerLang }],
    });
    let promptRun = 0;

    render(`
      <div class="screen screen--sound-check">
        ${renderMuteToggle()}
        <div class="question-card">
          ${renderAudioReplayButton('soundCheckReplayBtn')}
          <p class="question-label">Sound check</p>
          <p class="question-text">Please say hello.</p>
        </div>
        <div class="sound-check-preview-slot">
          ${renderCameraPreview()}
        </div>
        <div class="sound-check-card">
          <div class="sound-check-status-row">
            <div class="sound-indicator" id="soundIndicator" aria-hidden="true">
              <svg class="sound-microphone" viewBox="0 0 24 24" focusable="false"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-5 8a5 5 0 0 0 10 0M12 16v4m-4 0h8" /></svg>
              <span class="sound-checkmark">✓</span>
            </div>
            <div class="sound-check-status-copy">
              <p class="sound-status" id="soundStatus"></p>
              <p class="sound-status-detail" id="soundStatusDetail"></p>
            </div>
          </div>
        </div>
        <div class="sound-check-actions">
          <button class="btn btn--record" id="soundCheckPrimaryBtn">Next →</button>
          <button class="btn btn--link" id="continueAnywayBtn" style="display:none">Continue anyway</button>
        </div>
      </div>
    `);

    const startListeningAfterPrompt = async () => {
      const run = ++promptRun;
      soundCheckListening = false;
      clearSoundCheckTimer();
      clearSoundCheckListeningTimer();
      soundCheckHeard = false;
      soundCheckTimedOut = false;
      updateSoundCheckUi();

      const result = await soundCheckPrompt.play();
      if (run !== promptRun || !document.getElementById('soundCheckPrimaryBtn')) return;

      const beginListening = () => {
        if (run === promptRun && document.getElementById('soundCheckPrimaryBtn')) {
          resetSoundCheckWindow();
        }
      };

      // The speaker can feed back into the mic, so only begin sampling just
      // after a completed prompt. Failed, muted, and blocked clips listen now.
      if (result === 'ended') {
        soundCheckListeningTimer = window.setTimeout(beginListening, 300);
      } else {
        beginListening();
      }
    };
    const soundCheckAudio = {
      play: startListeningAfterPrompt,
      replay: startListeningAfterPrompt,
    };
    setupMuteToggle(soundCheckAudio);
    document.getElementById('soundCheckReplayBtn').addEventListener('click', startListeningAfterPrompt);

    const preview = document.getElementById('preview');
    if (preview) {
      preview.srcObject = mediaStream;
      sizePreviewViewport(preview);
    }

    await startAudioMonitor();
    startListeningAfterPrompt();

    const continueToQuestion = () => {
      promptRun++;
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
    setHistoryScreen('countdown');
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
    setHistoryScreen('recording-review');
    const questionText = currentQuestionText();
    clearReviewObjectUrl();
    reviewObjectUrl = URL.createObjectURL(recordedBlob);

    render(`
      <div class="screen screen--review">
        <div class="question-card">
          <p class="question-label">Review your response</p>
          <p class="question-text">${escapeHtml(questionText || '')}</p>
        </div>
        <div class="preview-wrap preview-wrap--recording${isUsingFrontCamera() ? ' preview-wrap--mirrored' : ''}">
          <div class="camera-preview-content">
            <video id="playback" controls playsinline></video>
          </div>
        </div>
        <div class="review-actions">
          <button class="btn btn--secondary" id="rerecordBtn">↺ Re-record</button>
          <button class="btn btn--upload" id="uploadBtn">✓ Upload</button>
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
    setHistoryScreen('upload');
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
    setHistoryScreen('success', { push: false });
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
          ${renderAudioReplayButton('successReplayBtn')}
          <div class="success-icon" aria-hidden="true">
            <svg viewBox="0 0 80 80" role="img" focusable="false">
              <circle cx="40" cy="40" r="36"></circle>
              <path d="M24 41.5 35 52.5 57 29.5"></path>
            </svg>
          </div>
          <p class="success-eyebrow">Submission complete</p>
          <h1>Thank you${displayName}!</h1>
          <p class="success-copy">Thank you! Your video has been sent.</p>
          <a class="contact-line" href="mailto:ron@bunabaraka.org">Questions or removal requests: ron@bunabaraka.org</a>
          <p class="success-footer">Buna Baraka</p>
        </div>
      </div>
    `);
    setupMuteToggle(successAudio);
    document.getElementById('successReplayBtn').addEventListener('click', () => successAudio.replay());

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
    setHistoryScreen('recording');
    createMediaRecorder();
    mediaRecorder.start(1000); // collect a chunk every second
    void startAudioMonitor();
    const progressTrack = document.getElementById('recordingProgressTrack');
    if (progressTrack) progressTrack.hidden = false;
    const progress = document.getElementById('recordingProgress');
    if (progress) {
      progress.style.width = '0%';
      progress.classList.remove('recording-progress__bar--good-length');
    }
    const stopButton = document.getElementById('stopBtn');
    if (stopButton) stopButton.hidden = false;

    countdownTimer = setInterval(() => {
      elapsedSeconds++;
      const remaining = MAX_DURATION_SEC - elapsedSeconds;
      const activeProgress = document.getElementById('recordingProgress');
      if (activeProgress) {
        const elapsedPercent = Math.min(100, (elapsedSeconds / MAX_DURATION_SEC) * 100);
        activeProgress.style.width = `${elapsedPercent}%`;
        activeProgress.classList.toggle('recording-progress__bar--good-length', elapsedSeconds >= 30);
      }
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
  window.addEventListener('popstate', handleHistoryPopState);
  document.addEventListener('DOMContentLoaded', init);
})();
