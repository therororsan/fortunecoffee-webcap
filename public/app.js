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
      'Hi!',
      'We would like to share your story with coffee drinkers.',
      'We will take your photo and video, and put them on the internet.',
      'A computer will also make a drawing of you for our cards.',
      'You can say no, or ask us later to remove them.',
      'If you agree, press the green button.',
    ],
    es: [
      '¡Hola!',
      'Nos gustaría compartir su historia con las personas que toman café.',
      'Tomaremos su foto y un video, y los pondremos en internet.',
      'Una computadora también hará un dibujo de usted para nuestras tarjetas.',
      'Usted puede decir que no, o pedirnos más adelante que los quitemos.',
      'Si está de acuerdo, presione el botón verde.',
    ],
    fr: [
      'Bonjour !',
      'Nous aimerions partager votre histoire avec les personnes qui boivent du café.',
      'Nous prendrons votre photo et enregistrerons une vidéo, puis nous les mettrons sur internet.',
      'Un ordinateur fera aussi un dessin de vous pour nos cartes.',
      'Vous pouvez dire non, ou nous demander plus tard de les retirer.',
      "Si vous êtes d'accord, appuyez sur le bouton vert.",
    ],
    pt: [
      'Olá!',
      'Gostaríamos de compartilhar a sua história com as pessoas que tomam café.',
      'Vamos tirar sua foto e gravar um vídeo, e colocá-los na internet.',
      'Um computador também vai fazer um desenho seu para os nossos cartões.',
      'Você pode dizer não, ou pedir depois para que a gente os retire.',
      'Se concordar, aperte o botão verde.',
    ],
    sw: [
      'Habari!',
      'Tungependa kushiriki hadithi yako na watu wanaokunywa kahawa.',
      'Tutakupiga picha na kurekodi video, na kuziweka mtandaoni.',
      'Kompyuta pia itatengeneza mchoro wako kwa ajili ya kadi zetu.',
      'Unaweza kukataa, au baadaye utuombe tuziondoe.',
      'Ukikubali, bonyeza kitufe cha kijani.',
    ],
    vi: [
      'Xin chào!',
      'Chúng tôi muốn chia sẻ câu chuyện của quý vị với những người uống cà phê.',
      'Chúng tôi sẽ chụp ảnh và quay video quý vị, rồi đăng lên mạng.',
      'Máy tính cũng sẽ vẽ một hình vẽ của quý vị cho các tấm thẻ của chúng tôi.',
      'Quý vị có thể từ chối, hoặc sau này nhờ chúng tôi gỡ ảnh và video xuống.',
      'Nếu quý vị đồng ý, hãy bấm nút màu xanh lá.',
    ],
    hi: [
      'नमस्ते!',
      'हम आपकी कहानी कॉफ़ी पीने वालों के साथ बाँटना चाहते हैं।',
      'हम आपकी फ़ोटो और वीडियो लेंगे, और उन्हें इंटरनेट पर डालेंगे।',
      'कंप्यूटर हमारे कार्डों के लिए आपका एक चित्र भी बनाएगा।',
      'आप मना कर सकते हैं, या बाद में हमसे उन्हें हटाने के लिए कह सकते हैं।',
      'अगर आप सहमत हैं, तो हरा बटन दबाएँ।',
    ],
    ta: [
      'வணக்கம்!',
      'உங்கள் கதையை காபி குடிப்பவர்களுடன் பகிர விரும்புகிறோம்.',
      'உங்கள் புகைப்படத்தையும் வீடியோவையும் எடுத்து, இன்டர்நெட்டில் வைப்போம்.',
      'எங்கள் அட்டைகளுக்காக, கணினி உங்கள் ஓவியம் ஒன்றையும் உருவாக்கும்.',
      'நீங்கள் மறுக்கலாம், அல்லது பின்னர் அவற்றை நீக்க எங்களிடம் சொல்லலாம்.',
      'நீங்கள் சம்மதித்தால், பச்சை பட்டனை அழுத்துங்கள்.',
    ],
    si: [
      'ආයුබෝවන්!',
      'ඔබේ කතාව කෝපි බොන අය සමඟ බෙදාගන්න අපි කැමතියි.',
      'අපි ඔබේ ඡායාරූපයක් සහ වීඩියෝවක් අරගෙන, ඒවා අන්තර්ජාලයට දමනවා.',
      'අපගේ කාඩ්පත් සඳහා පරිගණකයක් ඔබේ චිත්‍රයක්ද සාදනවා.',
      'ඔබට ප්‍රතික්ෂේප කළ හැකියි, නැත්නම් පසුව ඒවා ඉවත් කරන්න කියා අපෙන් ඉල්ලන්න පුළුවන්.',
      'ඔබ එකඟ නම්, කොළ පාට බොත්තම ඔබන්න.',
    ],
    am: [
      'ሰላም!',
      'ታሪክዎን ቡና ከሚጠጡ ሰዎች ጋር ማካፈል እንፈልጋለን።',
      'ፎቶዎንና ቪዲዮዎን አንስተን በኢንተርኔት ላይ እናስቀምጣቸዋለን።',
      'ኮምፒውተር ደግሞ ለካርዶቻችን የእርስዎን ስዕል ይሰራል።',
      'እምቢ ማለት ይችላሉ፣ ወይም በኋላ እንድናስወግዳቸው ሊጠይቁን ይችላሉ።',
      'ከተስማሙ፣ አረንጓዴውን ቁልፍ ይጫኑ።',
    ],
    fil: [
      'Kumusta po!',
      'Gusto po naming ibahagi ang inyong kuwento sa mga taong umiinom ng kape.',
      'Kukunan po namin kayo ng larawan at video, at ilalagay ang mga ito sa internet.',
      'Gagawa rin po ang computer ng guhit ninyo para sa aming mga card.',
      'Puwede po kayong tumanggi, o hilingin sa amin sa ibang araw na alisin ang mga ito.',
      'Kung pumapayag po kayo, pindutin ang berdeng button.',
    ],
  };

  const UI_TEXTS = {
    "document_title": {
      "en": "Share your story",
      "es": "Comparta su historia",
      "fr": "Partagez votre histoire",
      "pt": "Compartilhe sua história",
      "sw": "Shiriki hadithi yako",
      "vi": "Chia sẻ câu chuyện của quý vị",
      "hi": "अपनी कहानी साझा करें",
      "ta": "உங்கள் கதையைப் பகிருங்கள்",
      "si": "ඔබේ කතාව බෙදාගන්න",
      "am": "ታሪክዎን ያካፍሉ",
      "fil": "Ibahagi ang inyong kuwento"
    },
    "loading": {
      "en": "Loading…",
      "es": "Cargando…",
      "fr": "Chargement…",
      "pt": "Carregando…",
      "sw": "Inapakia…",
      "vi": "Đang tải…",
      "hi": "लोड हो रहा है…",
      "ta": "ஏற்றப்படுகிறது…",
      "si": "පූරණය වෙමින් පවතී…",
      "am": "በመጫን ላይ…",
      "fil": "Naglo-load…"
    },
    "replay_audio_aria": {
      "en": "Replay audio",
      "es": "Repetir audio",
      "fr": "Réécouter l’audio",
      "pt": "Ouvir de novo",
      "sw": "Rudia sauti",
      "vi": "Nghe lại âm thanh",
      "hi": "आवाज़ फिर सुनें",
      "ta": "ஒலியை மீண்டும் கேளுங்கள்",
      "si": "හඬ නැවත අහන්න",
      "am": "ድምፁን ደግመው ያዳምጡ",
      "fil": "Patugtugin muli ang audio"
    },
    "play_audio_aria": {
      "en": "Play audio",
      "es": "Reproducir audio",
      "fr": "Lire l’audio",
      "pt": "Tocar áudio",
      "sw": "Cheza sauti",
      "vi": "Phát âm thanh",
      "hi": "आवाज़ चलाएँ",
      "ta": "ஒலியை இயக்குங்கள்",
      "si": "හඬ වාදනය කරන්න",
      "am": "ድምፅ ያጫውቱ",
      "fil": "Patugtugin ang audio"
    },
    "mute_audio_aria": {
      "en": "Mute audio",
      "es": "Silenciar audio",
      "fr": "Couper le son",
      "pt": "Silenciar áudio",
      "sw": "Nyamazisha sauti",
      "vi": "Tắt âm thanh",
      "hi": "आवाज़ बंद करें",
      "ta": "ஒலியை அணைக்கவும்",
      "si": "හඬ නිහඬ කරන්න",
      "am": "ድምፅ ያጥፉ",
      "fil": "Patayin ang tunog"
    },
    "tap_for_sound": {
      "en": "Tap for sound",
      "es": "Toque para oír",
      "fr": "Touchez pour le son",
      "pt": "Toque para ouvir",
      "sw": "Bonyeza kusikia",
      "vi": "Bấm để nghe",
      "hi": "आवाज़ के लिए दबाएँ",
      "ta": "ஒலிக்காகத் தட்டவும்",
      "si": "හඬ සඳහා තට්ටු කරන්න",
      "am": "ለድምፅ ይጫኑ",
      "fil": "Pindutin para sa tunog"
    },
    "config_error": {
      "en": "App is not configured. Please contact your coordinator.",
      "es": "La aplicación no está configurada. Contacte a su coordinador.",
      "fr": "L’application n’est pas configurée. Contactez votre coordinateur.",
      "pt": "O aplicativo não está configurado. Fale com seu coordenador.",
      "sw": "Programu haijawekwa. Wasiliana na mratibu wako.",
      "vi": "Ứng dụng chưa được cài đặt. Vui lòng liên hệ người phụ trách.",
      "hi": "ऐप तैयार नहीं है। अपने समन्वयक से बात करें।",
      "ta": "செயலி அமைக்கப்படவில்லை. உங்கள் ஒருங்கிணைப்பாளரைத் தொடர்புகொள்ளுங்கள்.",
      "si": "යෙදුම සකසා නැත. ඔබේ සම්බන්ධකයා අමතන්න.",
      "am": "መተግበሪያው አልተዘጋጀም። አስተባባሪዎን ያነጋግሩ።",
      "fil": "Hindi pa handa ang app. Makipag-ugnayan sa inyong coordinator."
    },
    "questions_load_error": {
      "en": "Could not load questions. Please try again later.",
      "es": "No se pudieron cargar las preguntas. Inténtelo más tarde.",
      "fr": "Impossible de charger les questions. Réessayez plus tard.",
      "pt": "Não foi possível carregar as perguntas. Tente mais tarde.",
      "sw": "Haikuweza kupakia maswali. Jaribu baadaye.",
      "vi": "Không tải được câu hỏi. Vui lòng thử lại sau.",
      "hi": "सवाल लोड नहीं हुए। बाद में फिर कोशिश करें।",
      "ta": "கேள்விகளை ஏற்ற முடியவில்லை. பின்னர் முயற்சிக்கவும்.",
      "si": "ප්‍රශ්න පූරණය කළ නොහැක. පසුව නැවත උත්සාහ කරන්න.",
      "am": "ጥያቄዎችን መጫን አልተቻለም። በኋላ ይሞክሩ።",
      "fil": "Hindi ma-load ang mga tanong. Subukan muli mamaya."
    },
    "camera_denied": {
      "en": "Camera access was denied. Please allow camera access and reload the page.",
      "es": "Se negó el acceso a la cámara. Permita la cámara y vuelva a cargar la página.",
      "fr": "L’accès à la caméra a été refusé. Autorisez la caméra et rechargez la page.",
      "pt": "O acesso à câmera foi negado. Permita a câmera e recarregue a página.",
      "sw": "Ruhusa ya kamera imekataliwa. Ruhusu kamera, kisha pakia ukurasa tena.",
      "vi": "Quyền dùng máy ảnh bị từ chối. Hãy cho phép máy ảnh rồi tải lại trang.",
      "hi": "कैमरे की अनुमति नहीं मिली। कैमरा अनुमति दें और पेज फिर खोलें।",
      "ta": "கேமரா அனுமதி மறுக்கப்பட்டது. கேமராவை அனுமதித்து பக்கத்தை மீண்டும் திறக்கவும்.",
      "si": "කැමරා අවසරය ප්‍රතික්ෂේප විය. කැමරාවට අවසර දී පිටුව නැවත පූරණය කරන්න.",
      "am": "የካሜራ ፈቃድ ተከልክሏል። ካሜራውን ይፍቀዱና ገጹን ድጋሚ ይክፈቱ።",
      "fil": "Tinanggihan ang camera. Payagan ang camera at i-reload ang page."
    },
    "camera_unavailable": {
      "en": "Could not access your camera. Please check that it is not in use by another app.",
      "es": "No se pudo acceder a la cámara. Compruebe que otra aplicación no la esté usando.",
      "fr": "Impossible d’accéder à votre caméra. Vérifiez qu’une autre application ne l’utilise pas.",
      "pt": "Não foi possível acessar a câmera. Veja se outro aplicativo não a está usando.",
      "sw": "Haikuweza kufikia kamera yako. Angalia kama programu nyingine haitumii kamera.",
      "vi": "Không thể dùng máy ảnh. Hãy xem ứng dụng khác có đang dùng máy ảnh không.",
      "hi": "कैमरा नहीं खुला। देखें कि कोई दूसरा ऐप कैमरा तो नहीं इस्तेमाल कर रहा।",
      "ta": "கேமராவைத் திறக்க முடியவில்லை. வேறு செயலி கேமராவைப் பயன்படுத்துகிறதா என்று பார்க்கவும்.",
      "si": "කැමරාවට පිවිසිය නොහැක. වෙනත් යෙදුමක් එය භාවිතා කරනවාද බලන්න.",
      "am": "ካሜራውን መጠቀም አልተቻለም። ሌላ መተግበሪያ እየተጠቀመበት መሆኑን ይመልከቱ።",
      "fil": "Hindi mabuksan ang camera. Tingnan kung ginagamit ito ng ibang app."
    },
    "country_label": {
      "en": "Country/Region *",
      "es": "País o región *",
      "fr": "Pays ou région *",
      "pt": "País ou região *",
      "sw": "Nchi/Eneo *",
      "vi": "Quốc gia/Khu vực *",
      "hi": "देश/क्षेत्र *",
      "ta": "நாடு/பகுதி *",
      "si": "රට/ප්‍රදේශය *",
      "am": "ሀገር/ክልል *",
      "fil": "Bansa/Rehiyon *"
    },
    "choose_country": {
      "en": "Choose country",
      "es": "Elija su país",
      "fr": "Choisissez votre pays",
      "pt": "Escolha seu país",
      "sw": "Chagua nchi",
      "vi": "Chọn quốc gia",
      "hi": "देश चुनें",
      "ta": "நாட்டைத் தேர்ந்தெடுக்கவும்",
      "si": "රට තෝරන්න",
      "am": "ሀገር ይምረጡ",
      "fil": "Pumili ng bansa"
    },
    "suggested_country": {
      "en": "Suggested: {country}",
      "es": "Sugerido: {country}",
      "fr": "Suggéré : {country}",
      "pt": "Sugerido: {country}",
      "sw": "Imependekezwa: {country}",
      "vi": "Gợi ý: {country}",
      "hi": "सुझाया गया: {country}",
      "ta": "பரிந்துரை: {country}",
      "si": "යෝජනා කළේ: {country}",
      "am": "የተጠቆመ: {country}",
      "fil": "Mungkahi: {country}"
    },
    "name_label": {
      "en": "Name *",
      "es": "Nombre *",
      "fr": "Nom *",
      "pt": "Nome *",
      "sw": "Jina *",
      "vi": "Tên *",
      "hi": "नाम *",
      "ta": "பெயர் *",
      "si": "නම *",
      "am": "ስም *",
      "fil": "Pangalan *"
    },
    "name_placeholder": {
      "en": "Your name",
      "es": "Su nombre",
      "fr": "Votre nom",
      "pt": "Seu nome",
      "sw": "Jina lako",
      "vi": "Tên của quý vị",
      "hi": "आपका नाम",
      "ta": "உங்கள் பெயர்",
      "si": "ඔබේ නම",
      "am": "የእርስዎ ስም",
      "fil": "Pangalan ninyo"
    },
    "name_example": {
      "en": "e.g. {name}",
      "es": "p. ej., {name}",
      "fr": "par ex. {name}",
      "pt": "ex.: {name}",
      "sw": "kwa mfano {name}",
      "vi": "ví dụ: {name}",
      "hi": "जैसे: {name}",
      "ta": "உதாரணம்: {name}",
      "si": "උදා: {name}",
      "am": "ለምሳሌ፡ {name}",
      "fil": "hal.: {name}"
    },
    "phone_label": {
      "en": "Phone *",
      "es": "Teléfono *",
      "fr": "Téléphone *",
      "pt": "Telefone *",
      "sw": "Simu *",
      "vi": "Điện thoại *",
      "hi": "फ़ोन *",
      "ta": "தொலைபேசி *",
      "si": "දුරකථනය *",
      "am": "ስልክ *",
      "fil": "Telepono *"
    },
    "phone_placeholder": {
      "en": "Phone number",
      "es": "Número de teléfono",
      "fr": "Numéro de téléphone",
      "pt": "Número de telefone",
      "sw": "Namba ya simu",
      "vi": "Số điện thoại",
      "hi": "फ़ोन नंबर",
      "ta": "தொலைபேசி எண்",
      "si": "දුරකථන අංකය",
      "am": "ስልክ ቁጥር",
      "fil": "Numero ng telepono"
    },
    "continue": {
      "en": "Continue →",
      "es": "Continuar →",
      "fr": "Continuer →",
      "pt": "Continuar →",
      "sw": "Endelea →",
      "vi": "Tiếp tục →",
      "hi": "आगे बढ़ें →",
      "ta": "தொடரவும் →",
      "si": "ඉදිරියට →",
      "am": "ይቀጥሉ →",
      "fil": "Magpatuloy →"
    },
    "country_required": {
      "en": "Please choose your country",
      "es": "Elija su país",
      "fr": "Choisissez votre pays",
      "pt": "Escolha seu país",
      "sw": "Chagua nchi yako",
      "vi": "Hãy chọn quốc gia",
      "hi": "अपना देश चुनें",
      "ta": "உங்கள் நாட்டைத் தேர்ந்தெடுக்கவும்",
      "si": "ඔබේ රට තෝරන්න",
      "am": "ሀገርዎን ይምረጡ",
      "fil": "Piliin ang inyong bansa"
    },
    "name_required": {
      "en": "Please enter your name",
      "es": "Escriba su nombre",
      "fr": "Entrez votre nom",
      "pt": "Digite seu nome",
      "sw": "Weka jina lako",
      "vi": "Hãy nhập tên của quý vị",
      "hi": "अपना नाम लिखें",
      "ta": "உங்கள் பெயரை உள்ளிடவும்",
      "si": "ඔබේ නම ඇතුළත් කරන්න",
      "am": "ስምዎን ያስገቡ",
      "fil": "Ilagay ang inyong pangalan"
    },
    "phone_required": {
      "en": "Please enter your phone number",
      "es": "Escriba su número de teléfono",
      "fr": "Entrez votre numéro de téléphone",
      "pt": "Digite seu número de telefone",
      "sw": "Weka namba yako ya simu",
      "vi": "Hãy nhập số điện thoại",
      "hi": "अपना फ़ोन नंबर लिखें",
      "ta": "உங்கள் தொலைபேசி எண்ணை உள்ளிடவும்",
      "si": "ඔබේ දුරකථන අංකය ඇතුළත් කරන්න",
      "am": "ስልክ ቁጥርዎን ያስገቡ",
      "fil": "Ilagay ang numero ng inyong telepono"
    },
    "phone_short": {
      "en": "Please enter your full phone number",
      "es": "Escriba su número de teléfono completo",
      "fr": "Entrez votre numéro de téléphone complet",
      "pt": "Digite seu número de telefone completo",
      "sw": "Weka namba yako kamili ya simu",
      "vi": "Hãy nhập đủ số điện thoại",
      "hi": "अपना पूरा फ़ोन नंबर लिखें",
      "ta": "உங்கள் முழு தொலைபேசி எண்ணை உள்ளிடவும்",
      "si": "ඔබේ සම්පූර්ණ දුරකථන අංකය ඇතුළත් කරන්න",
      "am": "ሙሉ ስልክ ቁጥርዎን ያስገቡ",
      "fil": "Ilagay ang buong numero ng inyong telepono"
    },
    "confirm_greeting": {
      "en": "Hi, {name}!",
      "es": "¡Hola, {name}!",
      "fr": "Bonjour, {name} !",
      "pt": "Olá, {name}!",
      "sw": "Habari, {name}!",
      "vi": "Xin chào, {name}!",
      "hi": "नमस्ते, {name}!",
      "ta": "வணக்கம், {name}!",
      "si": "ආයුබෝවන්, {name}!",
      "am": "ሰላም, {name}!",
      "fil": "Kumusta po, {name}!"
    },
    "confirm_details": {
      "en": "Please confirm your details:",
      "es": "Confirme sus datos:",
      "fr": "Confirmez vos informations :",
      "pt": "Confirme seus dados:",
      "sw": "Thibitisha maelezo yako:",
      "vi": "Hãy xác nhận thông tin của quý vị:",
      "hi": "अपनी जानकारी जाँचें:",
      "ta": "உங்கள் விவரங்களை உறுதிப்படுத்தவும்:",
      "si": "ඔබේ විස්තර තහවුරු කරන්න:",
      "am": "መረጃዎን ያረጋግጡ፦",
      "fil": "Kumpirmahin ang inyong detalye:"
    },
    "confirm_continue": {
      "en": "Confirm & Continue →",
      "es": "Confirmar y continuar →",
      "fr": "Confirmer et continuer →",
      "pt": "Confirmar e continuar →",
      "sw": "Thibitisha na endelea →",
      "vi": "Xác nhận và tiếp tục →",
      "hi": "पुष्टि करें और आगे बढ़ें →",
      "ta": "உறுதிசெய்து தொடரவும் →",
      "si": "තහවුරු කර ඉදිරියට යන්න →",
      "am": "ያረጋግጡና ይቀጥሉ →",
      "fil": "Kumpirmahin at magpatuloy →"
    },
    "agree": {
      "en": "✓ Agree",
      "es": "✓ Acepto",
      "fr": "✓ J’accepte",
      "pt": "✓ Concordo",
      "sw": "✓ Ninakubali",
      "vi": "✓ Đồng ý",
      "hi": "✓ सहमत हूँ",
      "ta": "✓ ஒப்புக்கொள்கிறேன்",
      "si": "✓ එකඟයි",
      "am": "✓ እስማማለሁ",
      "fil": "✓ Sumasang-ayon ako"
    },
    "disagree": {
      "en": "✕ Disagree",
      "es": "✕ No acepto",
      "fr": "✕ Je refuse",
      "pt": "✕ Não concordo",
      "sw": "✕ Sikubali",
      "vi": "✕ Không đồng ý",
      "hi": "✕ सहमत नहीं हूँ",
      "ta": "✕ ஒப்புக்கொள்ளவில்லை",
      "si": "✕ එකඟ නැත",
      "am": "✕ አልስማማም",
      "fil": "✕ Hindi ako sang-ayon"
    },
    "contact_line": {
      "en": "Questions or removal requests: ron@bunabaraka.org",
      "es": "Preguntas o solicitudes de eliminación: ron@bunabaraka.org",
      "fr": "Questions ou demandes de retrait : ron@bunabaraka.org",
      "pt": "Perguntas ou pedidos de remoção: ron@bunabaraka.org",
      "sw": "Maswali au maombi ya kuondoa: ron@bunabaraka.org",
      "vi": "Câu hỏi hoặc yêu cầu gỡ bỏ: ron@bunabaraka.org",
      "hi": "सवाल या हटाने के अनुरोध: ron@bunabaraka.org",
      "ta": "கேள்விகள் அல்லது நீக்கக் கோரிக்கைகள்: ron@bunabaraka.org",
      "si": "ප්‍රශ්න හෝ ඉවත් කිරීමේ ඉල්ලීම්: ron@bunabaraka.org",
      "am": "ጥያቄዎች ወይም የማስወገድ ጥያቄዎች: ron@bunabaraka.org",
      "fil": "Mga tanong o kahilingan na alisin: ron@bunabaraka.org"
    },
    "consent_save_error": {
      "en": "Could not save your consent. Please try again.",
      "es": "No se pudo guardar su respuesta. Inténtelo de nuevo.",
      "fr": "Impossible d’enregistrer votre réponse. Réessayez.",
      "pt": "Não foi possível salvar sua resposta. Tente de novo.",
      "sw": "Haikuweza kuhifadhi jibu lako. Jaribu tena.",
      "vi": "Không lưu được câu trả lời. Vui lòng thử lại.",
      "hi": "आपकी सहमति सेव नहीं हुई। फिर कोशिश करें।",
      "ta": "உங்கள் ஒப்புதல் சேமிக்கப்படவில்லை. மீண்டும் முயற்சிக்கவும்.",
      "si": "ඔබේ එකඟතාව සුරැකිය නොහැක. නැවත උත්සාහ කරන්න.",
      "am": "ፈቃድዎን ማስቀመጥ አልተቻለም። ድጋሚ ይሞክሩ።",
      "fil": "Hindi na-save ang inyong sagot. Subukan muli."
    },
    "decision_save_error": {
      "en": "Could not save your decision. Please try again.",
      "es": "No se pudo guardar su decisión. Inténtelo de nuevo.",
      "fr": "Impossible d’enregistrer votre décision. Réessayez.",
      "pt": "Não foi possível salvar sua decisão. Tente de novo.",
      "sw": "Haikuweza kuhifadhi uamuzi wako. Jaribu tena.",
      "vi": "Không lưu được quyết định của quý vị. Vui lòng thử lại.",
      "hi": "आपका निर्णय सेव नहीं हुआ। फिर कोशिश करें।",
      "ta": "உங்கள் முடிவை சேமிக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      "si": "ඔබේ තීරණය සුරැකිය නොහැක. නැවත උත්සාහ කරන්න.",
      "am": "ውሳኔዎን ማስቀመጥ አልተቻለም። ድጋሚ ይሞክሩ።",
      "fil": "Hindi na-save ang inyong pasya. Subukan muli."
    },
    "declined_title": {
      "en": "Thank you",
      "es": "Gracias",
      "fr": "Merci",
      "pt": "Obrigado",
      "sw": "Asante",
      "vi": "Cảm ơn quý vị",
      "hi": "धन्यवाद",
      "ta": "நன்றி",
      "si": "ස්තුතියි",
      "am": "እናመሰግናለን",
      "fil": "Salamat"
    },
    "declined_copy": {
      "en": "Thank you for your time. Your decision has been recorded.",
      "es": "Gracias por su tiempo. Su decisión fue registrada.",
      "fr": "Merci pour votre temps. Votre décision a été enregistrée.",
      "pt": "Obrigado pelo seu tempo. Sua decisão foi registrada.",
      "sw": "Asante kwa muda wako. Uamuzi wako umehifadhiwa.",
      "vi": "Cảm ơn quý vị. Quyết định của quý vị đã được ghi lại.",
      "hi": "आपका समय देने के लिए धन्यवाद। आपका निर्णय दर्ज हो गया है।",
      "ta": "உங்கள் நேரத்திற்கு நன்றி. உங்கள் முடிவு பதிவு செய்யப்பட்டது.",
      "si": "ඔබේ කාලයට ස්තුතියි. ඔබේ තීරණය සටහන් විය.",
      "am": "ለጊዜዎ እናመሰግናለን። ውሳኔዎ ተመዝግቧል።",
      "fil": "Salamat sa oras ninyo. Naitala ang inyong pasya."
    },
    "selfie_title": {
      "en": "🤳 Take a selfie",
      "es": "🤳 Tome una selfie",
      "fr": "🤳 Prenez un selfie",
      "pt": "🤳 Tire uma selfie",
      "sw": "🤳 Piga selfie",
      "vi": "🤳 Chụp ảnh selfie",
      "hi": "🤳 सेल्फ़ी लें",
      "ta": "🤳 செல்ஃபி எடுக்கவும்",
      "si": "🤳 සෙල්ෆියක් ගන්න",
      "am": "🤳 የራስዎን ፎቶ ያንሱ",
      "fil": "🤳 Mag-selfie"
    },
    "take_photo": {
      "en": "Take photo",
      "es": "Tomar foto",
      "fr": "Prendre une photo",
      "pt": "Tirar foto",
      "sw": "Piga picha",
      "vi": "Chụp ảnh",
      "hi": "फ़ोटो लें",
      "ta": "புகைப்படம் எடுக்கவும்",
      "si": "ඡායාරූපයක් ගන්න",
      "am": "ፎቶ ያንሱ",
      "fil": "Kumuha ng larawan"
    },
    "retake": {
      "en": "↺ Retake",
      "es": "↺ Tomar otra",
      "fr": "↺ Reprendre",
      "pt": "↺ Tirar outra",
      "sw": "↺ Piga tena",
      "vi": "↺ Chụp lại",
      "hi": "↺ फिर से लें",
      "ta": "↺ மீண்டும் எடுக்கவும்",
      "si": "↺ නැවත ගන්න",
      "am": "↺ እንደገና ያንሱ",
      "fil": "↺ Kunan muli"
    },
    "use_photo": {
      "en": "✓ Use this photo",
      "es": "✓ Usar esta foto",
      "fr": "✓ Utiliser cette photo",
      "pt": "✓ Usar esta foto",
      "sw": "✓ Tumia picha hii",
      "vi": "✓ Dùng ảnh này",
      "hi": "✓ यही फ़ोटो रखें",
      "ta": "✓ இந்தப் புகைப்படத்தைப் பயன்படுத்தவும்",
      "si": "✓ මේ ඡායාරූපය භාවිතා කරන්න",
      "am": "✓ ይህን ፎቶ ይጠቀሙ",
      "fil": "✓ Gamitin ang larawang ito"
    },
    "flip_camera_aria": {
      "en": "Flip camera",
      "es": "Cambiar cámara",
      "fr": "Retourner la caméra",
      "pt": "Virar câmera",
      "sw": "Geuza kamera",
      "vi": "Đổi máy ảnh",
      "hi": "कैमरा बदलें",
      "ta": "கேமராவை மாற்றவும்",
      "si": "කැමරාව මාරු කරන්න",
      "am": "ካሜራ ይቀይሩ",
      "fil": "Baligtarin ang camera"
    },
    "selfie_preview_alt": {
      "en": "Selfie preview",
      "es": "Vista previa de selfie",
      "fr": "Aperçu du selfie",
      "pt": "Prévia da selfie",
      "sw": "Onyesho la selfie",
      "vi": "Xem trước ảnh selfie",
      "hi": "सेल्फ़ी झलक",
      "ta": "செல்ஃபி முன்னோட்டம்",
      "si": "සෙල්ෆි පෙරදසුන",
      "am": "የራስ ፎቶ ቅድመ እይታ",
      "fil": "Preview ng selfie"
    },
    "camera_starting": {
      "en": "Camera is still starting. Please try again.",
      "es": "La cámara aún está iniciando. Inténtelo de nuevo.",
      "fr": "La caméra démarre encore. Réessayez.",
      "pt": "A câmera ainda está iniciando. Tente de novo.",
      "sw": "Kamera bado inaanza. Jaribu tena.",
      "vi": "Máy ảnh đang mở. Vui lòng thử lại.",
      "hi": "कैमरा अभी शुरू हो रहा है। फिर कोशिश करें।",
      "ta": "கேமரா இன்னும் தொடங்குகிறது. மீண்டும் முயற்சிக்கவும்.",
      "si": "කැමරාව තවම ආරම්භ වෙමින් ඇත. නැවත උත්සාහ කරන්න.",
      "am": "ካሜራው ገና በመጀመር ላይ ነው። ድጋሚ ይሞክሩ።",
      "fil": "Nagsisimula pa ang camera. Subukan muli."
    },
    "capture_error": {
      "en": "Could not capture your photo. Please try again.",
      "es": "No se pudo tomar su foto. Inténtelo de nuevo.",
      "fr": "Impossible de prendre votre photo. Réessayez.",
      "pt": "Não foi possível tirar sua foto. Tente de novo.",
      "sw": "Haikuweza kupiga picha yako. Jaribu tena.",
      "vi": "Không chụp được ảnh của quý vị. Vui lòng thử lại.",
      "hi": "आपकी फ़ोटो नहीं ली जा सकी। फिर कोशिश करें।",
      "ta": "உங்கள் புகைப்படத்தை எடுக்க முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      "si": "ඔබේ ඡායාරූපය ගත නොහැකි විය. නැවත උත්සාහ කරන්න.",
      "am": "ፎቶዎን ማንሳት አልተቻለም። ድጋሚ ይሞክሩ።",
      "fil": "Hindi makuha ang larawan ninyo. Subukan muli."
    },
    "selfie_dark": {
      "en": "Photo looks dark — try again in better light",
      "es": "La foto se ve oscura. Inténtelo con más luz.",
      "fr": "La photo est sombre. Réessayez avec plus de lumière.",
      "pt": "A foto está escura. Tente com mais luz.",
      "sw": "Picha ina giza. Jaribu mahali penye mwanga zaidi.",
      "vi": "Ảnh bị tối. Hãy thử nơi sáng hơn.",
      "hi": "फ़ोटो अंधेरी है। अधिक रोशनी में फिर कोशिश करें।",
      "ta": "புகைப்படம் இருட்டாக உள்ளது. அதிக வெளிச்சத்தில் மீண்டும் முயற்சிக்கவும்.",
      "si": "ඡායාරූපය අඳුරුයි. වැඩි ආලෝකයක් ඇති තැනක නැවත උත්සාහ කරන්න.",
      "am": "ፎቶው ጨለማ ነው። በበለጠ ብርሃን ድጋሚ ይሞክሩ።",
      "fil": "Madilim ang larawan. Subukan sa mas maliwanag na lugar."
    },
    "selfie_unclear": {
      "en": "We could not see you clearly — put your head inside the oval and retake",
      "es": "No pudimos verle bien. Ponga su cabeza dentro del óvalo y tome otra foto.",
      "fr": "Nous ne vous voyons pas bien. Placez votre tête dans l’ovale et reprenez la photo.",
      "pt": "Não conseguimos ver você bem. Coloque a cabeça dentro do oval e tire outra foto.",
      "sw": "Hatukuweza kukuona vizuri. Weka kichwa ndani ya umbo la yai na upige picha tena.",
      "vi": "Chúng tôi không thấy rõ quý vị. Hãy đặt đầu vào trong hình bầu dục rồi chụp lại.",
      "hi": "हम आपको साफ़ नहीं देख पाए। अपना सिर अंडाकार के अंदर रखें और फिर फ़ोटो लें।",
      "ta": "உங்களைத் தெளிவாகப் பார்க்க முடியவில்லை. உங்கள் தலையை ஓவல் வடிவத்துக்குள் வைத்து மீண்டும் படம் எடுக்கவும்.",
      "si": "ඔබව පැහැදිලිව දැකීමට නොහැකි විය. හිස ඕවලාකාරය තුළ තබා නැවත ඡායාරූපය ගන්න.",
      "am": "በግልጽ ማየት አልቻልንም። ራስዎን በሞላላው ውስጥ አድርገው ፎቶውን ድጋሚ ያንሱ።",
      "fil": "Hindi namin kayo makita nang malinaw. Ilagay ang ulo sa loob ng bilog na pahaba at kunan muli."
    },
    "selfie_good": {
      "en": "Looks good ✓",
      "es": "Se ve bien ✓",
      "fr": "C’est bien ✓",
      "pt": "Está bom ✓",
      "sw": "Inaonekana vizuri ✓",
      "vi": "Trông đẹp ✓",
      "hi": "अच्छा है ✓",
      "ta": "நன்றாக உள்ளது ✓",
      "si": "හොඳයි ✓",
      "am": "ጥሩ ይመስላል ✓",
      "fil": "Ayos na ✓"
    },
    "update_info": {
      "en": "Update info / Rescind consent",
      "es": "Cambiar datos / Retirar consentimiento",
      "fr": "Modifier mes infos / Retirer mon accord",
      "pt": "Alterar dados / Retirar consentimento",
      "sw": "Badilisha taarifa / Ondoa idhini",
      "vi": "Sửa thông tin / Rút lại đồng ý",
      "hi": "जानकारी बदलें / सहमति वापस लें",
      "ta": "தகவலை மாற்றவும் / ஒப்புதலைத் திரும்பப் பெறவும்",
      "si": "විස්තර වෙනස් කරන්න / එකඟතාව ඉවත් කරන්න",
      "am": "መረጃ ይቀይሩ / ፈቃድ ይመልሱ",
      "fil": "Baguhin ang detalye / Bawiin ang pahintulot"
    },
    "start_recording": {
      "en": "Start recording",
      "es": "Empezar a grabar",
      "fr": "Commencer l’enregistrement",
      "pt": "Começar a gravar",
      "sw": "Anza kurekodi",
      "vi": "Bắt đầu quay",
      "hi": "रिकॉर्डिंग शुरू करें",
      "ta": "பதிவு தொடங்கவும்",
      "si": "පටිගත කිරීම අරඹන්න",
      "am": "መቅረጽ ይጀምሩ",
      "fil": "Simulan ang pag-record"
    },
    "sound_check": {
      "en": "Sound check",
      "es": "Prueba de sonido",
      "fr": "Test du son",
      "pt": "Teste de som",
      "sw": "Jaribio la sauti",
      "vi": "Kiểm tra âm thanh",
      "hi": "आवाज़ जाँच",
      "ta": "ஒலி சோதனை",
      "si": "හඬ පරීක්ෂාව",
      "am": "የድምፅ ሙከራ",
      "fil": "Pagsubok ng tunog"
    },
    "say_hello": {
      "en": "Please say hello.",
      "es": "Por favor, diga hola.",
      "fr": "Veuillez dire bonjour.",
      "pt": "Por favor, diga olá.",
      "sw": "Tafadhali sema habari.",
      "vi": "Xin quý vị nói xin chào.",
      "hi": "कृपया नमस्ते बोलिए।",
      "ta": "தயவுசெய்து வணக்கம் சொல்லுங்கள்.",
      "si": "කරුණාකර ආයුබෝවන් කියන්න.",
      "am": "እባክዎ ሰላም ይበሉ።",
      "fil": "Pakisabi po ang kumusta."
    },
    "heard_you": {
      "en": "We can hear you",
      "es": "Podemos oírle",
      "fr": "Nous vous entendons",
      "pt": "Podemos ouvir você",
      "sw": "Tunaweza kukusikia",
      "vi": "Chúng tôi nghe thấy quý vị",
      "hi": "हम आपको सुन सकते हैं",
      "ta": "உங்களைக் கேட்க முடிகிறது",
      "si": "අපට ඔබව ඇසෙනවා",
      "am": "ልንሰማዎት እንችላለን",
      "fil": "Naririnig namin kayo"
    },
    "mic_heard_detail": {
      "en": "Your microphone is picking up your voice.",
      "es": "Su micrófono capta su voz.",
      "fr": "Votre micro capte votre voix.",
      "pt": "Seu microfone está captando sua voz.",
      "sw": "Kipaza sauti chako kinachukua sauti yako.",
      "vi": "Mic của quý vị đang nhận giọng nói.",
      "hi": "आपका माइक्रोफ़ोन आपकी आवाज़ पकड़ रहा है।",
      "ta": "உங்கள் மைக்ரோஃபோன் உங்கள் குரலைப் பெறுகிறது.",
      "si": "ඔබේ මයික්‍රෆෝනය ඔබේ හඬ ගන්නවා.",
      "am": "ማይክሮፎንዎ ድምፅዎን እየቀበለ ነው።",
      "fil": "Nakukuha ng mikropono ang boses ninyo."
    },
    "no_sound": {
      "en": "No sound detected",
      "es": "No se detectó sonido",
      "fr": "Aucun son détecté",
      "pt": "Nenhum som detectado",
      "sw": "Hakuna sauti iliyosikika",
      "vi": "Không phát hiện âm thanh",
      "hi": "कोई आवाज़ नहीं मिली",
      "ta": "ஒலி கண்டறியப்படவில்லை",
      "si": "හඬක් හමු නොවීය",
      "am": "ድምፅ አልተገኘም",
      "fil": "Walang nakitang tunog"
    },
    "mic_hint": {
      "en": "Try speaking closer to the phone or check your mic.",
      "es": "Hable más cerca del teléfono o revise su micrófono.",
      "fr": "Parlez plus près du téléphone ou vérifiez votre micro.",
      "pt": "Fale mais perto do telefone ou verifique seu microfone.",
      "sw": "Ongea karibu na simu au angalia kipaza sauti.",
      "vi": "Hãy nói gần điện thoại hơn hoặc kiểm tra mic.",
      "hi": "फ़ोन के पास बोलें या अपना माइक्रोफ़ोन जाँचें।",
      "ta": "ஃபோனுக்கு அருகில் பேசுங்கள் அல்லது மைக்ரோஃபோனைப் பாருங்கள்.",
      "si": "දුරකථනයට ළඟින් කතා කරන්න හෝ මයික්‍රෆෝනය පරීක්ෂා කරන්න.",
      "am": "ወደ ስልኩ ቀርበው ይናገሩ ወይም ማይክሮፎንዎን ይመልከቱ።",
      "fil": "Magsalita nang mas malapit sa telepono o tingnan ang mikropono."
    },
    "next": {
      "en": "Next →",
      "es": "Siguiente →",
      "fr": "Suivant →",
      "pt": "Próximo →",
      "sw": "Inayofuata →",
      "vi": "Tiếp theo →",
      "hi": "आगे →",
      "ta": "அடுத்து →",
      "si": "ඊළඟට →",
      "am": "ቀጣይ →",
      "fil": "Susunod →"
    },
    "try_again": {
      "en": "Try again",
      "es": "Intentar de nuevo",
      "fr": "Réessayer",
      "pt": "Tentar de novo",
      "sw": "Jaribu tena",
      "vi": "Thử lại",
      "hi": "फिर कोशिश करें",
      "ta": "மீண்டும் முயற்சிக்கவும்",
      "si": "නැවත උත්සාහ කරන්න",
      "am": "ድጋሚ ይሞክሩ",
      "fil": "Subukan muli"
    },
    "continue_anyway": {
      "en": "Continue anyway",
      "es": "Continuar de todos modos",
      "fr": "Continuer quand même",
      "pt": "Continuar mesmo assim",
      "sw": "Endelea hata hivyo",
      "vi": "Vẫn tiếp tục",
      "hi": "फिर भी आगे बढ़ें",
      "ta": "எப்படியும் தொடரவும்",
      "si": "එහෙත් ඉදිරියට යන්න",
      "am": "ቢሆንም ይቀጥሉ",
      "fil": "Magpatuloy pa rin"
    },
    "recording": {
      "en": "Recording",
      "es": "Grabando",
      "fr": "Enregistrement",
      "pt": "Gravando",
      "sw": "Inarekodi",
      "vi": "Đang quay",
      "hi": "रिकॉर्ड हो रहा है",
      "ta": "பதிவு செய்கிறது",
      "si": "පටිගත වෙමින් පවතී",
      "am": "በመቅረጽ ላይ",
      "fil": "Nagre-record"
    },
    "stop": {
      "en": "■ Stop",
      "es": "■ Detener",
      "fr": "■ Arrêter",
      "pt": "■ Parar",
      "sw": "■ Simamisha",
      "vi": "■ Dừng",
      "hi": "■ रोकें",
      "ta": "■ நிறுத்தவும்",
      "si": "■ නවත්වන්න",
      "am": "■ ያቁሙ",
      "fil": "■ Ihinto"
    },
    "saving": {
      "en": "Saving…",
      "es": "Guardando…",
      "fr": "Enregistrement…",
      "pt": "Salvando…",
      "sw": "Inahifadhi…",
      "vi": "Đang lưu…",
      "hi": "सहेजा जा रहा है…",
      "ta": "சேமிக்கப்படுகிறது…",
      "si": "සුරකිමින් පවතී…",
      "am": "በማስቀመጥ ላይ…",
      "fil": "Sine-save…"
    },
    "review_response": {
      "en": "Review your response",
      "es": "Revise su respuesta",
      "fr": "Vérifiez votre réponse",
      "pt": "Revise sua resposta",
      "sw": "Kagua jibu lako",
      "vi": "Xem lại câu trả lời",
      "hi": "अपना जवाब देखें",
      "ta": "உங்கள் பதிலைப் பாருங்கள்",
      "si": "ඔබේ පිළිතුර බලන්න",
      "am": "መልስዎን ይመልከቱ",
      "fil": "Suriin ang inyong sagot"
    },
    "rerecord": {
      "en": "↺ Re-record",
      "es": "↺ Grabar de nuevo",
      "fr": "↺ Réenregistrer",
      "pt": "↺ Gravar de novo",
      "sw": "↺ Rekodi tena",
      "vi": "↺ Quay lại",
      "hi": "↺ फिर रिकॉर्ड करें",
      "ta": "↺ மீண்டும் பதிவு செய்யவும்",
      "si": "↺ නැවත පටිගත කරන්න",
      "am": "↺ እንደገና ይቅረጹ",
      "fil": "↺ Mag-record muli"
    },
    "upload": {
      "en": "✓ Upload",
      "es": "✓ Enviar",
      "fr": "✓ Envoyer",
      "pt": "✓ Enviar",
      "sw": "✓ Tuma",
      "vi": "✓ Gửi",
      "hi": "✓ भेजें",
      "ta": "✓ அனுப்பவும்",
      "si": "✓ යවන්න",
      "am": "✓ ይላኩ",
      "fil": "✓ Ipadala"
    },
    "uploading": {
      "en": "Uploading your response…",
      "es": "Enviando su respuesta…",
      "fr": "Envoi de votre réponse…",
      "pt": "Enviando sua resposta…",
      "sw": "Inatuma jibu lako…",
      "vi": "Đang gửi câu trả lời…",
      "hi": "आपका जवाब भेजा जा रहा है…",
      "ta": "உங்கள் பதில் அனுப்பப்படுகிறது…",
      "si": "ඔබේ පිළිතුර යවමින් පවතී…",
      "am": "መልስዎ በመላክ ላይ…",
      "fil": "Ipinapadala ang inyong sagot…"
    },
    "upload_hint": {
      "en": "Please stay on this page until the upload is complete.",
      "es": "Permanezca en esta página hasta que termine el envío.",
      "fr": "Restez sur cette page jusqu’à la fin de l’envoi.",
      "pt": "Fique nesta página até o envio terminar.",
      "sw": "Tafadhali baki kwenye ukurasa huu hadi kutuma kumalizike.",
      "vi": "Hãy ở lại trang này đến khi gửi xong.",
      "hi": "भेजना पूरा होने तक इसी पेज पर रहें।",
      "ta": "அனுப்புவது முடியும் வரை இந்தப் பக்கத்தில் இருங்கள்.",
      "si": "යැවීම අවසන් වන තෙක් මෙම පිටුවේ රැඳී සිටින්න.",
      "am": "መላኩ እስኪጠናቀቅ ድረስ በዚህ ገጽ ላይ ይቆዩ።",
      "fil": "Manatili sa pahinang ito hanggang matapos ang pagpapadala."
    },
    "upload_failed": {
      "en": "Upload failed: {reason}",
      "es": "Error al enviar: {reason}",
      "fr": "Échec de l’envoi : {reason}",
      "pt": "Falha ao enviar: {reason}",
      "sw": "Kutuma kumeshindikana: {reason}",
      "vi": "Gửi không thành công: {reason}",
      "hi": "भेजना विफल हुआ: {reason}",
      "ta": "பதிவேற்றம் தோல்வியடைந்தது: {reason}",
      "si": "යැවීම අසාර්ථක විය: {reason}",
      "am": "መላክ አልተሳካም፦ {reason}",
      "fil": "Nabigo ang pag-upload: {reason}"
    },
    "missing_selfie": {
      "en": "Missing selfie photo. Please retake your photo and try again.",
      "es": "Falta la foto selfie. Tome otra foto e inténtelo de nuevo.",
      "fr": "La photo selfie manque. Reprenez une photo et réessayez.",
      "pt": "Falta a selfie. Tire outra foto e tente de novo.",
      "sw": "Picha ya selfie haipo. Piga tena na ujaribu tena.",
      "vi": "Thiếu ảnh selfie. Hãy chụp lại rồi thử lại.",
      "hi": "सेल्फ़ी फ़ोटो नहीं है। फिर फ़ोटो लें और कोशिश करें।",
      "ta": "செல்ஃபி புகைப்படம் இல்லை. மீண்டும் எடுத்து முயற்சிக்கவும்.",
      "si": "සෙල්ෆි ඡායාරූපය නැත. නැවත ගෙන උත්සාහ කරන්න.",
      "am": "የራስ ፎቶው የለም። ድጋሚ አንስተው ይሞክሩ።",
      "fil": "Wala ang selfie. Kunan muli at subukan uli."
    },
    "recording_stopped": {
      "en": "Recording stopped unexpectedly. Please try again.",
      "es": "La grabación se detuvo inesperadamente. Inténtelo de nuevo.",
      "fr": "L’enregistrement s’est arrêté. Réessayez.",
      "pt": "A gravação parou. Tente de novo.",
      "sw": "Kurekodi kumesimama ghafla. Jaribu tena.",
      "vi": "Việc quay đã dừng. Vui lòng thử lại.",
      "hi": "रिकॉर्डिंग रुक गई। फिर कोशिश करें।",
      "ta": "பதிவு நின்றுவிட்டது. மீண்டும் முயற்சிக்கவும்.",
      "si": "පටිගත කිරීම නතර විය. නැවත උත්සාහ කරන්න.",
      "am": "ቀረጻው ቆሟል። ድጋሚ ይሞክሩ።",
      "fil": "Huminto ang pag-record. Subukan muli."
    },
    "unknown_error": {
      "en": "Unknown error. Please try again.",
      "es": "Error desconocido. Inténtelo de nuevo.",
      "fr": "Erreur inconnue. Réessayez.",
      "pt": "Erro desconhecido. Tente de novo.",
      "sw": "Hitilafu isiyojulikana. Jaribu tena.",
      "vi": "Lỗi không rõ. Vui lòng thử lại.",
      "hi": "अज्ञात त्रुटि। फिर कोशिश करें।",
      "ta": "தெரியாத பிழை. மீண்டும் முயற்சிக்கவும்.",
      "si": "නොදන්නා දෝෂයකි. නැවත උත්සාහ කරන්න.",
      "am": "ያልታወቀ ስህተት። ድጋሚ ይሞክሩ።",
      "fil": "Hindi kilalang error. Subukan muli."
    },
    "submission_complete": {
      "en": "Submission complete",
      "es": "Envío completo",
      "fr": "Envoi terminé",
      "pt": "Envio concluído",
      "sw": "Kutuma kumekamilika",
      "vi": "Gửi xong",
      "hi": "भेजना पूरा हुआ",
      "ta": "அனுப்புதல் முடிந்தது",
      "si": "යැවීම සම්පූර්ණයි",
      "am": "መላክ ተጠናቋል",
      "fil": "Kumpleto na ang pagpapadala"
    },
    "thank_you_name": {
      "en": "Thank you{name}!",
      "es": "¡Gracias{name}!",
      "fr": "Merci{name} !",
      "pt": "Obrigado{name}!",
      "sw": "Asante{name}!",
      "vi": "Cảm ơn{name}!",
      "hi": "धन्यवाद{name}!",
      "ta": "நன்றி{name}!",
      "si": "ස්තුතියි{name}!",
      "am": "እናመሰግናለን{name}!",
      "fil": "Salamat{name}!"
    },
    "video_sent": {
      "en": "Thank you! Your video has been sent.",
      "es": "¡Gracias! Su video fue enviado.",
      "fr": "Merci. Votre vidéo a été envoyée.",
      "pt": "Obrigado. Seu vídeo foi enviado.",
      "sw": "Asante. Video yako imetumwa.",
      "vi": "Cảm ơn. Video của quý vị đã được gửi.",
      "hi": "धन्यवाद। आपका वीडियो भेज दिया गया है।",
      "ta": "நன்றி. உங்கள் வீடியோ அனுப்பப்பட்டது.",
      "si": "ස්තුතියි. ඔබේ වීඩියෝව යවා ඇත.",
      "am": "እናመሰግናለን። ቪዲዮዎ ተልኳል።",
      "fil": "Salamat. Naipadala ang inyong video."
    },
    "brand_footer": {
      "en": "Buna Baraka",
      "es": "Buna Baraka",
      "fr": "Buna Baraka",
      "pt": "Buna Baraka",
      "sw": "Buna Baraka",
      "vi": "Buna Baraka",
      "hi": "Buna Baraka",
      "ta": "Buna Baraka",
      "si": "Buna Baraka",
      "am": "Buna Baraka",
      "fil": "Buna Baraka"
    },
    "country_options": {
      "en": "Brazil, Colombia, Ethiopia, Guatemala, Honduras, India, Indonesia, Kenya, Mexico, Peru, Philippines, Rwanda, Tanzania, Uganda, Vietnam, Yemen, Sri Lanka, China, Hong Kong, Other",
      "es": "Brasil, Colombia, Etiopía, Guatemala, Honduras, India, Indonesia, Kenia, México, Perú, Filipinas, Ruanda, Tanzania, Uganda, Vietnam, Yemen, Sri Lanka, China, Hong Kong, Otro",
      "fr": "Brésil, Colombie, Éthiopie, Guatemala, Honduras, Inde, Indonésie, Kenya, Mexique, Pérou, Philippines, Rwanda, Tanzanie, Ouganda, Vietnam, Yémen, Sri Lanka, Chine, Hong Kong, Autre",
      "pt": "Brasil, Colômbia, Etiópia, Guatemala, Honduras, Índia, Indonésia, Quênia, México, Peru, Filipinas, Ruanda, Tanzânia, Uganda, Vietnã, Iêmen, Sri Lanka, China, Hong Kong, Outro",
      "sw": "Brazili, Kolombia, Ethiopia, Guatemala, Honduras, India, Indonesia, Kenya, Mexico, Peru, Ufilipino, Rwanda, Tanzania, Uganda, Vietnam, Yemen, Sri Lanka, China, Hong Kong, Nyingine",
      "vi": "Brazil, Colombia, Ethiopia, Guatemala, Honduras, Ấn Độ, Indonesia, Kenya, Mexico, Peru, Philippines, Rwanda, Tanzania, Uganda, Việt Nam, Yemen, Sri Lanka, Trung Quốc, Hồng Kông, Khác",
      "hi": "ब्राज़ील, कोलंबिया, इथियोपिया, ग्वाटेमाला, होंडुरास, भारत, इंडोनेशिया, केन्या, मेक्सिको, पेरू, फ़िलीपींस, रवांडा, तंज़ानिया, युगांडा, वियतनाम, यमन, श्रीलंका, चीन, हांगकांग, अन्य",
      "ta": "பிரேசில், கொலம்பியா, எத்தியோப்பியா, குவாத்தமாலா, ஹோண்டுராஸ், இந்தியா, இந்தோனேசியா, கென்யா, மெக்சிகோ, பெரு, பிலிப்பைன்ஸ், ருவாண்டா, தான்சானியா, உகாண்டா, வியட்நாம், ஏமன், இலங்கை, சீனா, ஹாங்காங், மற்றவை",
      "si": "බ්‍රසීලය, කොලොම්බියාව, ඉතියෝපියාව, ග්වාතමාලාව, හොන්ඩුරාස්, ඉන්දියාව, ඉන්දුනීසියාව, කෙන්යාව, මෙක්සිකෝව, පේරු, පිලිපීනය, රුවන්ඩාව, ටැන්සානියාව, උගන්ඩාව, වියට්නාමය, යේමනය, ශ්‍රී ලංකාව, චීනය, හොංකොං, වෙනත්",
      "am": "ብራዚል፣ ኮሎምቢያ፣ ኢትዮጵያ፣ ጓቲማላ፣ ሆንዱራስ፣ ህንድ፣ ኢንዶኔዥያ፣ ኬንያ፣ ሜክሲኮ፣ ፔሩ፣ ፊሊፒንስ፣ ሩዋንዳ፣ ታንዛኒያ፣ ዩጋንዳ፣ ቬትናም፣ የመን፣ ስሪላንካ፣ ቻይና፣ ሆንግ ኮንግ፣ ሌላ",
      "fil": "Brazil, Colombia, Ethiopia, Guatemala, Honduras, India, Indonesia, Kenya, Mexico, Peru, Pilipinas, Rwanda, Tanzania, Uganda, Vietnam, Yemen, Sri Lanka, China, Hong Kong, Iba"
    },
    "smile": {
      "en": "Smile",
      "es": "Sonría",
      "fr": "Souriez",
      "pt": "Sorria",
      "sw": "Tabasamu",
      "vi": "Mỉm cười",
      "hi": "मुस्कुराएँ",
      "ta": "புன்னகைக்கவும்",
      "si": "සිනාසෙන්න",
      "am": "ፈገግ ይበሉ",
      "fil": "Ngumiti"
    },
    "get_ready": {
      "en": "Get ready",
      "es": "Prepárese",
      "fr": "Préparez-vous",
      "pt": "Prepare-se",
      "sw": "Jitayarishe",
      "vi": "Chuẩn bị",
      "hi": "तैयार हो जाएँ",
      "ta": "தயாராகுங்கள்",
      "si": "සූදානම් වන්න",
      "am": "ይዘጋጁ",
      "fil": "Maghanda"
    }
  };

  // ── State ────────────────────────────────────────────────────────────────
  let farmerId        = null;
  let farmerName      = null;
  let farmerCountry   = null;
  let farmerPhone     = null;
  let farmerLang      = DEFAULT_LANG;
  const sharedPromptAudio = new Audio();
  sharedPromptAudio.preload = 'auto';
  let audioUnlocked = false;
  let unlockPending = false;

  function unlockPromptAudio() {
    if (audioUnlocked || unlockPending || currentAudio) return;
    unlockPending = true;
    sharedPromptAudio.src = 'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA';
    try {
      const attempt = sharedPromptAudio.play();
      Promise.resolve(attempt).then(() => {
        audioUnlocked = true;
        if (!currentAudio) sharedPromptAudio.pause();
      }).catch(() => {}).finally(() => { unlockPending = false; });
    } catch { unlockPending = false; }
  }

  document.addEventListener('pointerdown', unlockPromptAudio, true);
  document.addEventListener('keydown', unlockPromptAudio, true);

  function t(key, variables = {}) {
    const translations = UI_TEXTS[key];
    if (!translations) {
      console.warn(`[webcap] Missing UI translation key: ${key}`);
      return key;
    }
    let value = translations[farmerLang];
    if (!value) {
      console.warn(`[webcap] Missing ${farmerLang} translation: ${key}; using English`);
      value = translations.en;
    }
    return value.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match);
  }

  function translatedCountry(country) {
    const index = COUNTRY_OPTIONS.indexOf(country);
    if (index < 0) {
      if (country === 'United Kingdom') {
        try { return new Intl.DisplayNames([farmerLang], { type: 'region' }).of('GB'); } catch { return country; }
      }
      return country;
    }
    const names = t('country_options').split(/,\s*|፣\s*/);
    return names[index] || country;
  }

  function updateDocumentLanguage() {
    document.documentElement.lang = farmerLang;
    document.title = t('document_title');
  }
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
  let blockedPromptRetry = null;
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
      const firstDetection = !soundCheckHeard;
      soundCheckHeard = true;
      clearSoundCheckTimer();
      if (firstDetection) void playAudioClip('soundcheck_success', farmerLang, { retryClipOnTap: true });
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
      status.textContent = t('heard_you');
      status.className = 'sound-status sound-status--good';
      statusDetail.textContent = t('mic_heard_detail');
      primary.textContent = t('next');
      continueAnyway.style.display = 'none';
    } else if (soundCheckTimedOut) {
      indicator.classList.remove('sound-indicator--detected');
      status.textContent = t('no_sound');
      status.className = 'sound-status sound-status--warn';
      statusDetail.textContent = t('mic_hint');
      primary.textContent = t('try_again');
      continueAnyway.style.display = 'inline-block';
    } else {
      indicator.classList.remove('sound-indicator--detected');
      status.textContent = '';
      status.className = 'sound-status';
      statusDetail.textContent = '';
      primary.textContent = t('next');
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
    updateDocumentLanguage();

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
      showError(t('config_error'));
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
        if (!params.has('lang') && SUPPORTED_LANGS.includes(existingSubmission.language)) {
          farmerLang = existingSubmission.language;
          updateDocumentLanguage();
        }
        await applyQuestionOverride(params.get('q'));
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

    await applyQuestionOverride(params.get('q'));

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
      showError(t('questions_load_error'));
      return false;
    }
  }

  async function applyQuestionOverride(questionId) {
    if (questionId === null) return;
    const question = questions.find(item => item.question_id === questionId);
    const text = question && question.text && question.text[farmerLang];
    if (!question || !question.audio_key || !question.file_slot_key ||
        typeof text !== 'string' || !text.trim() ||
        questions.filter(item => item.audio_key === question.audio_key).length !== 1) {
      console.warn('[webcap] Invalid question override; using rotation');
      return;
    }

    try {
      const path = resolveAudioPath('question', farmerLang, {
        folder: 'questions', baseName: question.audio_key,
      });
      const response = await fetch(path, { method: 'HEAD' });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.toLowerCase().startsWith('audio/')) throw new Error('Audio unavailable');
      currentQuestion = question;
    } catch (err) {
      console.warn('[webcap] Question override audio unavailable; using rotation');
    }
  }

  function questionTextForLanguage(question, lang) {
    if (!question || !question.text) return null;
    const requestedText = question.text[lang];
    const englishText = question.text[DEFAULT_LANG];
    if ((!requestedText || !requestedText.trim()) && lang !== DEFAULT_LANG) console.warn(`[webcap] Missing question translation for ${lang}; using English`);
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
    return `${renderMuteToggleIcon(isMuted)}${muteToggleShowsLabel() ? `<span class="mute-toggle-label">${escapeHtml(t('tap_for_sound'))}</span>` : ''}`;
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
      <button class="audio-replay-icon${className ? ` ${className}` : ''}" id="${id}" type="button" aria-label="${escapeHtml(t('replay_audio_aria'))}">
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
    const action = t(audioToggleState === 'playing' ? 'mute_audio_aria' : 'play_audio_aria');
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
    blockedPromptRetry = null;
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
      if (blockedPromptRetry) {
        const retry = blockedPromptRetry;
        blockedPromptRetry = null;
        retry();
        return;
      }
      screenAudioController.replay();
    });
  }

  function playAudioPath(path, options = {}) {
    if (isMuted) {
      return Promise.resolve('muted');
    }

    stopCurrentAudio();

    return new Promise(resolve => {
      const audio = sharedPromptAudio;
      audio.src = path;
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
      audio.onplay = () => {
        if (currentAudio === audio) setAudioToggleState('playing');
      };
      audio.onplaying = () => {
        if (currentAudio === audio) setAudioToggleState('playing');
      };
      audio.onpause = () => {
        if (currentAudio === audio) setAudioToggleState('idle');
      };
      audio.onended = () => {
        if (currentAudio === audio) setAudioToggleState('idle');
        finish('ended');
      };
      audio.onerror = () => {
        if (currentAudio === audio) setAudioToggleState('needs-tap');
        finish('error');
      };

      let playPromise;
      try {
        playPromise = audio.play();
      } catch (error) {
        if (options.retryClipOnTap) blockedPromptRetry = () => playAudioPath(path, options);
        setAudioToggleState('needs-tap');
        finish('play-error');
        return;
      }
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (settled) return;
            blockedPromptRetry = null;
            // Some mobile browsers resolve playback before they dispatch a
            // paintable `playing` event, so mirror the real play promise too.
            if (currentAudio === audio) setAudioToggleState('playing');
            if (typeof options.onPlayStart === 'function') {
              options.onPlayStart();
            }
            syncMuteToggleButtons();
          })
          .catch(() => {
            if (settled) return;
            if (options.retryClipOnTap) blockedPromptRetry = () => playAudioPath(path, options);
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

    if (primaryResult === 'play-error') return primaryResult;
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
        if (result === 'stopped' || result === 'muted' || result === 'play-error') {
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
        showError(t('camera_denied'));
      } else {
        showError(t('camera_unavailable'));
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
        <p>${escapeHtml(t('loading'))}</p>
      </div>
    `);
  }

  function showError(msg) {
    render(`
      <div class="screen screen--error">
        <div class="error-icon">⚠</div>
        <p class="error-msg">${escapeHtml(msg)}</p>
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
      return `<li class="cs-opt" data-value="${escapeHtml(name)}">${flagHtml(name)}${escapeHtml(translatedCountry(name))}</li>`;
    }).join('');
    const suggestedOption = suggestedCountry
      ? `<li class="cs-opt cs-opt--suggested" data-value="${suggestedCountry}">${flagHtml(suggestedCountry)}${escapeHtml(t('suggested_country', { country: translatedCountry(suggestedCountry) }))}</li>`
      : '';

    render(`
      <div class="screen screen--registry">
        <div class="card">
          <form class="registry-form" id="registryForm" novalidate>
            <div class="form-group">
              <label>${escapeHtml(t('country_label'))}</label>
              <div class="cs-wrap" id="csWrap">
                <div class="cs-trigger" id="csTrigger" role="button" tabindex="0" aria-expanded="false">
                  <span id="csDisplay" class="cs-placeholder">📍 ${escapeHtml(t('choose_country'))}</span>
                  <span class="cs-arrow">▾</span>
                </div>
                <ul class="cs-list" id="csList">
                  <li class="cs-opt cs-opt--empty" data-value="">📍 ${escapeHtml(t('choose_country'))}</li>
                  ${suggestedOption}
                  ${csOpts}
                </ul>
                <input type="hidden" id="countrySelect">
              </div>
              <p class="field-error" id="countryError" aria-live="polite"></p>
            </div>
            <div class="form-group">
              <label for="nameInput">${escapeHtml(t('name_label'))}</label>
              <input type="text" id="nameInput" placeholder="${escapeHtml(t('name_placeholder'))}" required enterkeyhint="next" value="${escapeHtml(farmerName || '')}">
              <p class="field-error" id="nameError" aria-live="polite"></p>
            </div>
            <div class="form-group">
              <label for="phoneInput">${escapeHtml(t('phone_label'))}</label>
              <div class="phone-input-wrap">
                <span id="phonePrefix" class="phone-prefix"></span>
                <input type="tel" id="phoneInput" placeholder="📞 ${escapeHtml(t('phone_placeholder'))}" inputmode="numeric" pattern="[0-9]*" maxlength="15" enterkeyhint="done">
              </div>
              <p class="field-error" id="phoneError" aria-live="polite"></p>
            </div>
            <button class="btn registry-submit-button" id="registrySubmitBtn" type="submit">${escapeHtml(t('continue'))}</button>
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
        ? t('name_example', { name: COUNTRY_NAME_EXAMPLES[country] })
        : t('name_placeholder');
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
        csDisplay.innerHTML = `${flagHtml(country)}${escapeHtml(translatedCountry(country))}`;
        csDisplay.classList.remove('cs-placeholder');
        clearFieldError(csTrigger, 'countryError');
      } else {
        csDisplay.textContent = `📍 ${t('choose_country')}`;
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
        showFieldError(csTrigger, 'countryError', t('country_required'));
        firstInvalid = csTrigger;
      }
      if (name.replace(/\s/g, '').length < 2) {
        showFieldError(nameInput, 'nameError', t('name_required'));
        firstInvalid = firstInvalid || nameInput;
      }
      if (!phoneDigits) {
        showFieldError(phoneWrap, 'phoneError', t('phone_required'));
        firstInvalid = firstInvalid || phoneInput;
      } else if (phoneLocal.length < 6) {
        showFieldError(phoneWrap, 'phoneError', t('phone_short'));
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
          <h2>${escapeHtml(t('confirm_greeting', { name: farmerName || '' }))} 👋</h2>
          <p>${escapeHtml(t('confirm_details'))}</p>
          <div class="form-group">
            <label for="nameConfirm">${escapeHtml(t('name_label').replace(/\s*\*$/, ''))}</label>
            <input type="text" id="nameConfirm" value="${escapeHtml(farmerName || '')}">
          </div>
          <div class="form-group">
            <label>${escapeHtml(t('country_label').replace(/\s*\*$/, ''))}</label>
            <p class="registry-field-readonly">${escapeHtml(translatedCountry(countryDisplayName(farmerCountry)) || '—')}</p>
          </div>
          <div class="form-group">
            <label for="phoneConfirm">${escapeHtml(t('phone_label').replace(/\s*\*$/, ''))} 📞</label>
            <input type="text" id="phoneConfirm" value="${escapeHtml(farmerPhone || '')}">
          </div>
          <button class="btn btn--primary" id="registryConfirmBtn">${escapeHtml(t('confirm_continue'))}</button>
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
    const consentParagraphs = [
      `${escapeHtml(consentLines[0])} ${escapeHtml(consentLines[1])}`,
      `${escapeHtml(consentLines[2])} ${escapeHtml(consentLines[3])}`,
      `${escapeHtml(consentLines[4])} <strong>${escapeHtml(consentLines[5])}</strong>`,
    ];

    render(`
      <div class="screen screen--consent">
        ${renderMuteToggle()}
        <div class="consent-body">
          <div class="consent-text${consentTextClass}">
            ${renderAudioReplayButton('consentReplayBtn')}
            ${consentParagraphs.map(paragraph => `<p>${paragraph}</p>`).join('')}
          </div>
          <div class="consent-actions">
            <button class="btn btn--consent btn--yes" id="consentYesBtn">${escapeHtml(t('agree'))}</button>
            <button class="btn btn--consent btn--no" id="consentNoBtn">${escapeHtml(t('disagree'))}</button>
          </div>
          <a class="contact-line" href="mailto:ron@bunabaraka.org">${escapeHtml(t('contact_line'))}</a>
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
        showError(t('consent_save_error'));
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
        showError(t('decision_save_error'));
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
          <h2>${escapeHtml(t('declined_title'))}</h2>
          <p>${escapeHtml(t('declined_copy'))}</p>
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
        <button class="btn btn--record" id="cameraPermissionContinueBtn">${escapeHtml(t('continue'))}</button>
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
            <button class="btn selfie-retake-button" id="retakeSelfieBtn">${escapeHtml(t('retake'))}</button>
            <button class="btn selfie-use-button" id="useSelfieBtn">${escapeHtml(t('use_photo'))}</button>
          </div>
        `
      : `
          <div class="selfie-camera-controls">
            ${showFlipButton ? `<button class="selfie-flip-button" id="selfieFlipBtn" type="button" aria-label="${escapeHtml(t('flip_camera_aria'))}">↻</button>` : ''}
            <button class="btn selfie-take-button" id="takeSelfieBtn" type="button">${renderCameraIcon()}<span>${escapeHtml(t('take_photo'))}</span></button>
          </div>
        `;

    render(`
      <div class="screen screen--selfie">
        ${hasCapturedSelfie ? '' : renderMuteToggle()}
        ${hasCapturedSelfie ? '' : `<h1 class="selfie-live-title">${escapeHtml(t('selfie_title'))}</h1>`}
        <div class="selfie-preview-slot">
        ${hasCapturedSelfie
          ? `<div class="preview-wrap" id="selfiePreviewWrap">
              <img id="selfiePreviewImage" src="${selfieObjectUrl}" alt="${escapeHtml(t('selfie_preview_alt'))}">
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
      alert(t('camera_starting'));
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
      showError(t('capture_error'));
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
      selfieFeedbackMessage = t('selfie_dark');
    } else if (subjectMissing) {
      selfieFeedbackTone = 'warn';
      selfieFeedbackMessage = t('selfie_unclear');
    } else {
      selfieFeedbackTone = 'good';
      selfieFeedbackMessage = t('selfie_good');
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
      ? `<a href="#" id="updateInfoLink" class="question-update-link">${escapeHtml(t('update_info'))}</a>`
      : '';

    render(`
      <div class="screen screen--question">
        ${renderMuteToggle()}
        <div class="question-listen-card">
          ${renderAudioReplayButton('playBtn')}
          <p class="question-listen-text">${escapeHtml(questionText || '')}</p>
        </div>
        <button class="btn btn--record" id="readyToRecordBtn"><span class="record-start-dot" aria-hidden="true"></span>${escapeHtml(t('start_recording'))}</button>
        ${updateInfoLink}
      </div>
    `);
    const revealReadyButton = () => {
      const readyButton = document.getElementById('readyToRecordBtn');
      if (readyButton) {
        readyButton.style.display = 'block';
      }
    };
    const questionAudioPath = resolveAudioPath('question', questionLanguage, {
      folder: 'questions',
      baseName: questionAudioKey,
    });
    const preloadedQuestionAudio = new Audio(questionAudioPath);
    preloadedQuestionAudio.preload = 'auto';
    preloadedQuestionAudio.load();

    const questionAudio = createAudioController({
      clips: [
        {
          screen: 'question_intro',
          lang: farmerLang,
          optional: true,
          skipEnglishFallback: true,
        },
        { pauseMs: 300 },
        {
          screen: 'question',
          lang: questionLanguage,
          folder: 'questions',
          baseName: questionAudioKey,
          preloadedAudio: preloadedQuestionAudio,
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
          <p class="question-label">${escapeHtml(t('sound_check'))}</p>
          <p class="question-text">${escapeHtml(t('say_hello'))}</p>
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
          <button class="btn btn--record" id="soundCheckPrimaryBtn">${escapeHtml(t('next'))}</button>
          <button class="btn btn--link" id="continueAnywayBtn" style="display:none">${escapeHtml(t('continue_anyway'))}</button>
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
          <span class="rec-label">${escapeHtml(t('recording'))}</span>
        </div>
        <p class="recording-question-band">${escapeHtml(questionText || '')}</p>
        ${renderCameraPreview({ id: 'recordingPreviewWrap', recording: true })}
        <button class="btn btn--stop" id="stopBtn" hidden>${escapeHtml(t('stop'))}</button>
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
          <p class="question-label">${escapeHtml(t('review_response'))}</p>
          <p class="question-text">${escapeHtml(questionText || '')}</p>
        </div>
        <div class="preview-wrap preview-wrap--recording${isUsingFrontCamera() ? ' preview-wrap--mirrored' : ''}">
          <div class="camera-preview-content">
            <video id="playback" controls playsinline></video>
          </div>
        </div>
        <div class="review-actions">
          <button class="btn btn--secondary" id="rerecordBtn">${escapeHtml(t('rerecord'))}</button>
          <button class="btn btn--upload" id="uploadBtn">${escapeHtml(t('upload'))}</button>
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
        <p class="upload-label">${escapeHtml(t('uploading'))}</p>
        <div class="progress-bar-wrap">
          <div class="progress-bar" id="progressBar"></div>
        </div>
        <p class="upload-hint">${escapeHtml(t('upload_hint'))}</p>
      </div>
    `);
  }

  function showUploadError(msg) {
    render(`
      <div class="screen screen--error">
        <div class="error-icon">⚠</div>
        <p class="error-msg">${escapeHtml(t('upload_failed', { reason: msg }))}</p>
        <button class="btn btn--secondary" id="retryBtn" style="margin-top:16px">${escapeHtml(t('try_again'))}</button>
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
          <p class="success-eyebrow">${escapeHtml(t('submission_complete'))}</p>
          <h1>${escapeHtml(t('thank_you_name', { name: displayName }))}</h1>
          <p class="success-copy">${escapeHtml(t('video_sent'))}</p>
          <a class="contact-line" href="mailto:ron@bunabaraka.org">${escapeHtml(t('contact_line'))}</a>
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
        failRecording(t('recording_stopped'));
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
        stopButton.textContent = t('saving');
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
      showUploadError(t('missing_selfie'));
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
      showUploadError(t('unknown_error'));
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  window.addEventListener('popstate', handleHistoryPopState);
  document.addEventListener('DOMContentLoaded', init);
})();
