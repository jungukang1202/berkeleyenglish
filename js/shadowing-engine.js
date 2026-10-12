/* ==========================================================================
   shadowing-engine.js
   shadowing.html 안에 있던 "듣기(TTS) / 따라 말하기(STT) / 번역 / 문법 설명 /
   비슷한 표현 생성" 로직을 그대로 옮겨서, admin.html / member.html 에서도
   재사용할 수 있게 만든 공용 엔진입니다. (shadowing.html 자체는 손대지 않았어요.)

   사용법: <script src="js/shadowing-engine.js"></script> 를 넣으면
   전역 변수 window.ShadowingEngine 에 아래 함수/값들이 들어있습니다.
     - escapeHTML(s)
     - loadTranslationInto(krSpanEl, text)
     - buildShadowingControls(targetText)  → 듣기/따라 말하기 UI DOM 반환
     - explainDifference(x, o)             → 문법 해설 텍스트
     - buildVariantBlock(sentenceText)     → "비슷한 표현 4개" DOM (또는 null)
     - parseFeedbackBlock(text, pairMode)  → { newSentences, newWords }
     - parseWordsBlock(text)               → string[]
     - hasTTS, hasSTT
========================================================================== */
(function (global) {
  'use strict';

  function escapeHTML(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  /* ===================== 번역 ===================== */
  const translationCache = new Map();

  async function translateOnceGoogle(text, target, source, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error('google translate HTTP ' + resp.status);
      const data = await resp.json();
      const translated = Array.isArray(data) && Array.isArray(data[0])
        ? data[0].map(seg => (Array.isArray(seg) ? seg[0] : '')).join('')
        : '';
      if (!translated) throw new Error('empty google translation');
      return translated;
    } finally {
      clearTimeout(timer);
    }
  }

  async function translateOnceMyMemory(text, target, source, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`;
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error('translate HTTP ' + resp.status);
      const data = await resp.json();
      const translated = data && data.responseData && data.responseData.translatedText;
      if (!translated) throw new Error('empty translation');
      if (/mymemory warning|invalid|quota/i.test(translated)) throw new Error('quota/limit response: ' + translated);
      return translated;
    } finally {
      clearTimeout(timer);
    }
  }

  async function translateOnce(text, target, source, timeoutMs) {
    try {
      return await translateOnceGoogle(text, target, source, timeoutMs);
    } catch (err) {
      console.warn('구글 번역 실패, MyMemory로 대체합니다:', err);
      return await translateOnceMyMemory(text, target, source, timeoutMs);
    }
  }

  async function translateText(text, target = 'ko', source = 'en', retries = 2) {
    if (!text || !text.trim()) return '';
    const key = `${source}|${target}|${text}`;
    if (translationCache.has(key)) return translationCache.get(key);
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const translated = await translateOnce(text, target, source, 6000);
        translationCache.set(key, translated);
        return translated;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    console.warn('translation failed after retries:', lastErr);
    return null;
  }

  function loadTranslationInto(krSpan, text) {
    if (!krSpan) return;
    krSpan.textContent = '번역 중...';
    translateText(text).then(tr => {
      if (!krSpan.isConnected) return;
      if (tr) {
        krSpan.textContent = tr;
        krSpan.classList.remove('kr-text-retry');
        krSpan.onclick = null;
      } else {
        krSpan.textContent = '번역 실패 (인터넷 연결을 확인하고 클릭하면 다시 시도해요) 🔄';
        krSpan.classList.add('kr-text-retry');
        krSpan.onclick = () => loadTranslationInto(krSpan, text);
      }
    });
  }

  /* ===================== TTS/STT 지원 여부 ===================== */
  const hasTTS = true; // 기기 음성 엔진이 없어도 인터넷 음성(/api/tts)으로 들을 수 있어서 항상 true
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  // 브라우저 내장 음성 인식(SpeechRecognition)은 Google 음성 서버를 쓰는 '진짜 Chrome'에서만 안정적이에요.
  // Edge·웨일·Brave·삼성 인터넷·Opera는 같은 기능이 있어도 Google 서버를 못 써서 오류(network 등)가 나고,
  // Safari는 Siri 설정에 따라 자주 실패하며, Firefox는 기능 자체가 없어요.
  // → Chrome이 아니면 사이트가 직접 녹음해서 서버(/api/stt)에서 받아쓰는 방식을 씁니다.
  function isGoogleChrome() {
    const ua = navigator.userAgent || '';
    if (/Edg\/|EdgA\/|EdgiOS|OPR\/|Opera|SamsungBrowser|Whale|YaBrowser|Vivaldi|CriOS|FxiOS|Firefox|NAVER|KAKAOTALK|Instagram|FBAN|FBAV|Line\//i.test(ua)) return false;
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    if (brands && brands.length) return brands.some(b => b.brand === 'Google Chrome');
    return /Chrome\/\d+/.test(ua) && navigator.vendor === 'Google Inc.' && !(navigator.brave);
  }
  const isChrome = isGoogleChrome();
  const canBrowserSTT = !!SpeechRecognitionCtor && isChrome;
  const canServerSTT = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const hasSTT = canBrowserSTT || canServerSTT || !!SpeechRecognitionCtor;
  const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) // iPadOS
    // 안드로이드 태블릿 Chrome은 기본으로 '데스크톱 사이트' 모드라서 자신을 Linux PC라고 소개해요.
    // 터치 화면이면서 마우스·트랙패드(정밀 포인터)가 없으면 태블릿으로 봅니다.
    || (navigator.maxTouchPoints > 0 && /Linux|X11|CrOS/.test(navigator.userAgent)
        && !(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches))
    || !!(navigator.userAgentData && navigator.userAgentData.platform === 'Android');

  // ── 듣기(원어민 음성) 재생 모듈 ──
  // 1순위: 기기 자체 음성 엔진(speechSynthesis). PC나 영어 음성이 설치된 기기는 이걸 그대로 씁니다.
  // 2순위: 기기에 영어 음성이 없거나 재생이 실패하면 → 사이트 서버(/api/tts)에서 받은 mp3로 대신 재생합니다.
  // 주소 끝에 ?voice=online 을 붙이면 PC에서도 인터넷 음성으로 강제 재생해서 테스트할 수 있어요.
  // iPad는 자신을 "Macintosh"로 표시해서 터치 지원 여부로 추가 판별합니다(isMobileDevice 참고).
  const TTS_AUDIO_ENDPOINT = '/api/tts';
  // 인터넷 음성(구글 목소리)은 기기 음성보다 원래 느리게 말해서, 같은 '빠르게'라도 느리게 들려요 → 1.2배 더 빠르게 보정
  const ONLINE_VOICE_SPEED_BOOST = 1.2;
  const __ttsKeepAlive = []; // 일부 브라우저가 재생 중인 발화 객체를 지워 onend가 안 오는 버그 방지
  // 태블릿·휴대폰(터치 화면)은 항상 인터넷 음성(mp3)으로 재생합니다. 태블릿 음성 엔진은 첫 재생 때 앞 단어(예: I)를
  // 잘라먹는 문제가 있었어요. PC는 기기 음성 엔진을 그대로 씁니다.
  // (주소 끝 ?voice=online → 인터넷 음성 강제, ?voice=device → 기기 음성 엔진 강제)
  let __voiceMode = /[?&]voice=online\b/.test(location.search) ? 'audio'
    : /[?&]voice=device\b/.test(location.search) ? null
    : (isMobileDevice || (navigator.maxTouchPoints || 0) > 0) ? 'audio'
    : null; // 'tts' | 'audio' | null(아직 모름)
  let __voiceGen = 0;
  let __lastTtsEnd = 0;     // 마지막으로 원어민 음성이 끝난 시각(첫 단어 잘림 방지용)          // stopVoice()가 불릴 때마다 증가 → 진행 중이던 재생이 "중단됨"을 알 수 있게
  // 지금 재생 중인 카드의 '멈춤' 함수(다른 카드를 누르면 앞 카드를 완전히 멈춰 소리 겹침 방지)
  let __activeShadowStop = null;
  const ENGINE_VERSION = '2026-10-12c'; // 배포할 때마다 바꿔서, 기기마다 최신 코드인지 화면 맨 아래에서 확인할 수 있게 합니다.
  // 화면 진단 표시(주소 끝 ?debug=1): 띵동·음성이 실제로 재생됐는지/막혔는지 오른쪽 아래에 보여줍니다.
  const __DEBUG_ON = /[?&]debug=1\b/.test(location.search);
  function __dbg(msg) {
    if (!__DEBUG_ON) return;
    try {
      let box = document.getElementById('__dbgBox');
      if (!box) {
        box = document.createElement('div');
        box.id = '__dbgBox';
        box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;max-width:min(360px,90vw);max-height:40vh;overflow:auto;background:rgba(27,42,78,.92);color:#fff;font:12px/1.5 monospace;padding:8px 10px;border-radius:8px;white-space:pre-wrap;';
        document.body.appendChild(box);
      }
      const t = new Date().toTimeString().slice(0, 8);
      box.textContent += `${t} ${msg}\n`;
      box.scrollTop = box.scrollHeight;
    } catch (e) {}
  }
  // 음성 엔진 깨우기용 문장. 예전엔 'Okay.'였는데 일부 기기(안드로이드 등)는 볼륨 설정을 무시해서
  // "okay"가 작게 들렸어요. 쉼표는 소리 없는 짧은 쉼으로 읽혀서 엔진만 깨우고 단어는 들리지 않아요.
  const WARMUP_TEXT = ',';
  // 페이지에서 처음 화면을 터치(또는 클릭)하는 순간, 거의 안 들리는 짧은 음성으로 태블릿 음성 엔진을 미리 깨워 둡니다.
  // (태블릿은 엔진이 처음 켜질 때 첫 단어가 잘리는 경우가 있어서, 버튼을 누르기 전에 준비시켜 두는 거예요)
  (function prewarmTTSOnFirstTouch() {
    if (!('speechSynthesis' in window)) return;
    const once = () => {
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('touchstart', once, true);
      try {
        const synth = window.speechSynthesis;
        if (synth.speaking || synth.pending) return;
        const u = new SpeechSynthesisUtterance(WARMUP_TEXT);
        u.lang = 'en-US'; u.volume = 0.01; u.rate = 1.5;
        const v = pickEnglishVoice(); if (v) u.voice = v;
        __ttsKeepAlive.push(u);
        u.onend = u.onerror = () => { const k = __ttsKeepAlive.indexOf(u); if (k >= 0) __ttsKeepAlive.splice(k, 1); };
        synth.speak(u);
      } catch (e) {}
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('touchstart', once, true);
  })();
  let __voiceAudio = null;     // 인터넷 음성용 오디오 요소(하나를 계속 재사용해야 태블릿에서 재생 허용이 유지돼요)
  let __audioFinish = null;
  let __silentWavUrl = null;

  function __isEnglishVoice(v) { return /^en([-_]|$)/i.test(v.lang || ''); }
  function pickEnglishVoice() {
    if (!('speechSynthesis' in window)) return null;
    const all = window.speechSynthesis.getVoices() || [];
    // Mac(Safari)에는 영어 목록 맨 앞에 "Albert", "Bubbles" 같은 장난감·로봇 목소리가 있어서 빼고 고릅니다.
    const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley)\b/i;
    const voices = all.filter(v => !NOVELTY.test(v.name || ''));
    const lang = v => (v.lang || '').replace('_', '-').toLowerCase(); // 일부 Safari는 en_US 형식
    // 원래 사이트와 같은 기준: 첫 번째 미국 영어(en-US) 음성 → 없으면 아무 영어 음성
    return voices.find(v => lang(v) === 'en-us') || voices.find(v => lang(v).startsWith('en')) || null;
  }
  function __waitVoices(ms) {
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      const now = synth.getVoices() || [];
      if (now.length) return resolve(now);
      const t = setTimeout(() => resolve(synth.getVoices() || []), ms);
      try { synth.addEventListener('voiceschanged', () => { clearTimeout(t); resolve(synth.getVoices() || []); }, { once: true }); } catch (e) {}
    });
  }
  function __getVoiceAudio() {
    if (!__voiceAudio) { __voiceAudio = new Audio(); __voiceAudio.preload = 'auto'; }
    return __voiceAudio;
  }
  function __silentWav() {
    if (__silentWavUrl) return __silentWavUrl;
    const n = 400, bytes = new Uint8Array(44 + n), dv = new DataView(bytes.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    str(36, 'data'); dv.setUint32(40, n, true); bytes.fill(128, 44);
    let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
    return (__silentWavUrl = 'data:audio/wav;base64,' + btoa(bin));
  }

  // 버튼을 누른 "그 순간"(어떤 await보다도 먼저) 호출해야 합니다. 태블릿 브라우저는 사용자가 직접 누른
  // 동작 안에서 한 번 소리를 낸 적이 있어야 이후 자동 재생을 허용하기 때문에, 두 재생 방식을 모두 미리 깨워 둡니다.
  function unlockVoice() {
    // 기기에 영어 음성이 이미 준비되어 있으면 바로 기기 음성으로 확정하고, 인터넷 음성용 오디오는 건드리지 않습니다.
    if (!__voiceMode && 'speechSynthesis' in window && (window.speechSynthesis.getVoices() || []).some(__isEnglishVoice)) {
      __voiceMode = 'tts';
    }
    if ('speechSynthesis' in window && __voiceMode !== 'audio') {
      try {
        const synth = window.speechSynthesis;
        if (synth.paused) synth.resume();
        const u = new SpeechSynthesisUtterance(' ');
        u.lang = 'en-US';
        u.volume = 0;
        synth.speak(u);
      } catch (e) {}
    }
    if (__voiceMode === 'tts') return;
    try {
      const a = __getVoiceAudio();
      if (a.paused) {
        a.src = __silentWav();
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {}
  }

  // USB·블루투스 이어폰은 소리가 없으면 절전 상태가 되고, 다시 깨어나는 0.5~1초 동안의 소리를 버려서
  // 첫 단어(예: I)가 잘려요. 연습하는 동안(터치 기기) 들리지 않는 무음을 계속 흘려 이어폰을 깨어 있게 합니다.
  // USB·블루투스 이어폰은 완전한 무음으로는 깨어나지 않고, 아주 작은 '실제 소리'가 있어야 깨어나요.
  // 기기 음성 엔진으로 거의 안 들리는(볼륨 0.01) 짧은 음성을 내서 이어폰을 깨웁니다(터치 기기만).
  // 깨우기 소리가 '실제로 나기 시작한 순간'(또는 최대 2.5초 뒤)에 끝나는 Promise를 돌려줍니다.
  // 태블릿 음성 엔진은 처음 켜지는 데 1~2초 걸려서, 기다리지 않으면 깨우기 전에 원어민 음성의 첫 단어가 지나가 버려요.
  function wakeOutputViaTTS() {
    if (!(isMobileDevice || (navigator.maxTouchPoints || 0) > 0)) return Promise.resolve();
    if (!('speechSynthesis' in window) || __voiceMode !== 'audio') return Promise.resolve(); // 인터넷 음성으로 재생할 때만
    return new Promise(resolve => {
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(fin, 1200); // 예전 2.5초 → 1.2초(소리 없는 깨우기는 시작 신호가 안 오는 기기가 있어 너무 오래 기다렸어요)
      try {
        const u = new SpeechSynthesisUtterance(WARMUP_TEXT);
        u.lang = 'en-US'; u.volume = 0.01; u.rate = 1.5;
        const v = pickEnglishVoice(); if (v) u.voice = v;
        __ttsKeepAlive.push(u);
        u.onstart = fin;
        u.onend = u.onerror = () => { const k = __ttsKeepAlive.indexOf(u); if (k >= 0) __ttsKeepAlive.splice(k, 1); fin(); };
        window.speechSynthesis.speak(u);
      } catch (e) { fin(); }
    });
  }
  let __keepAwakeAudio = null;
  function startOutputKeepAlive() {
    if (!(isMobileDevice || (navigator.maxTouchPoints || 0) > 0)) return;
    try {
      if (!__keepAwakeAudio) { __keepAwakeAudio = new Audio(__silentWav()); __keepAwakeAudio.loop = true; }
      const p = __keepAwakeAudio.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }
  function stopOutputKeepAlive() {
    try { if (__keepAwakeAudio) __keepAwakeAudio.pause(); } catch (e) {}
  }

  function stopVoice() {
    __voiceGen++;
    if ('speechSynthesis' in window) {
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) synth.cancel();
    }
    if (__voiceAudio) { try { __voiceAudio.pause(); } catch (e) {} }
    if (__audioFinish) __audioFinish(false);
  }

  // 기기 음성 엔진으로 재생. 정상 재생(또는 사용자가 중단)이면 true, 엔진이 실제로 소리를 못 내면 false.
  function __speakViaSynth(text, rate) {
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = rate;
      utter.volume = 1;
      const enVoice = pickEnglishVoice();
      if (enVoice) utter.voice = enVoice;
      __ttsKeepAlive.push(utter);
      let done = false, started = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        const idx = __ttsKeepAlive.indexOf(utter);
        if (idx >= 0) __ttsKeepAlive.splice(idx, 1);
        __lastTtsEnd = Date.now();
        resolve(ok);
      };
      // 재생이 끝났는지는 onend 이벤트와 함께 synth.speaking 상태를 0.25초마다 직접 확인해서 판단합니다.
      // (예전처럼 문장 길이로 시간을 어림잡으면, 긴 문장·느린 속도에서 말이 끝나기 전에 마이크 단계로 넘어가 버려요.)
      // 5초가 지나도 재생이 시작되지 않으면 이 기기 음성 엔진이 작동하지 않는 것으로 보고 인터넷 음성으로 넘깁니다.
      const t0 = Date.now();
      const poll = setInterval(() => {
        if (synth.speaking) started = true;
        const elapsed = Date.now() - t0;
        if (!started && elapsed > 5000) { try { synth.cancel(); } catch (e) {} finish(false); return; }
        if (started && !synth.speaking && !synth.pending && elapsed > 600) { finish(true); return; }
        if (elapsed > 120000) finish(true);
      }, 250);
      utter.onstart = () => { started = true; };
      utter.onend = () => finish(true);
      utter.onerror = (e) => {
        const err = e && e.error;
        finish(err === 'interrupted' || err === 'canceled');
      };
      if (synth.paused) synth.resume();
      synth.speak(utter);
    });
  }

  function __splitForTTS(text, max) {
    const out = [];
    let rest = text.replace(/\s+/g, ' ').trim();
    while (rest.length > max) {
      let cut = -1;
      for (const re of [/[.!?;](?=\s)/g, /[,:](?=\s)/g, /\s/g]) {
        let m; re.lastIndex = 0;
        while ((m = re.exec(rest)) && m.index < max) cut = m.index + 1;
        if (cut > 0) break;
      }
      if (cut <= 0) cut = max;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  function __playAudioOnce(url, rate) {
    return new Promise(resolve => {
      const a = __getVoiceAudio();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        clearInterval(rateTimer);
        a.onended = a.onerror = a.onloadedmetadata = a.onplaying = a.onratechange = null;
        if (__audioFinish === finish) __audioFinish = null;
        resolve(ok);
      };
      __audioFinish = finish;
      const safety = setTimeout(() => finish(false), 30000);
      a.onended = () => finish(true);
      a.onerror = () => finish(false);
      a.src = url;
      a.defaultPlaybackRate = rate;
      a.playbackRate = rate;
      // 태블릿 Chrome은 파일을 불러오면서 속도를 1배로 되돌리는 경우가 있어, 재생이 시작될 때 한 번 더 맞춥니다.
      const fixRate = () => { try { if (a.playbackRate !== rate) a.playbackRate = rate; } catch (e) {} };
      a.onloadedmetadata = fixRate;
      a.onplaying = fixRate;
      a.onratechange = fixRate; // 누가 속도를 바꾸면 바로 되돌림
      const rateTimer = setInterval(fixRate, 200); // 재생 중 0.2초마다 속도 확인(태블릿에서 1배로 돌아가는 경우 대비)
      try { a.preservesPitch = true; } catch (e) {}
      const p = a.play();
      if (p && p.catch) p.catch(() => finish(false));
    });
  }

  // ── 인터넷 음성 속도 조절(사이트가 직접 처리) ──
  // 태블릿 Chrome에 재생 속도(playbackRate)를 맡기면 빠른 속도에서 첫 소리(예: I)를 놓쳐요.
  // 그래서 음성 파일을 받아 사이트가 직접 '목소리 높이는 그대로, 길이만 짧게' 만든 뒤(WSOLA 방식), 1배속으로 재생합니다.
  // 소리 장치를 켜지 않는 계산 전용 도구(OfflineAudioContext)만 쓰므로 원어민 음성·마이크에 영향이 없어요.
  const __stretchCache = new Map(); // "속도|문장" → 만들어 둔 음성 주소(반복 재생 때 다시 만들지 않음)
  function __wsola(x, sr, rate) {
    const N = Math.max(256, Math.round(sr * 0.03) & ~1); // 30ms 구간
    const Hs = N / 2, Ha = Hs * rate, tol = Math.round(N / 4);
    const win = new Float32Array(N);
    for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N);
    const outLen = Math.ceil(x.length / rate) + N;
    const y = new Float32Array(outLen), wsum = new Float32Array(outLen);
    let prev = 0, outPos = 0;
    for (let k = 0; ; k++) {
      const nominal = Math.round(k * Ha);
      if (nominal + N + tol >= x.length || outPos + N >= outLen) break;
      let best = nominal;
      if (k > 0) {
        const nat = prev + Hs;
        if (nat + N / 2 < x.length) {
          let bestC = -Infinity;
          for (let d = -tol; d <= tol; d += 2) {
            const p = nominal + d;
            if (p < 0 || p + N > x.length) continue;
            let c = 0;
            for (let n = 0; n < N / 2; n += 2) c += x[p + n] * x[nat + n];
            if (c > bestC) { bestC = c; best = p; }
          }
        }
      }
      for (let n = 0; n < N; n++) { y[outPos + n] += x[best + n] * win[n]; wsum[outPos + n] += win[n]; }
      prev = best; outPos += Hs;
    }
    const len = Math.min(outLen, outPos + N);
    const out = new Float32Array(len);
    for (let n = 0; n < len; n++) out[n] = wsum[n] > 1e-3 ? y[n] / wsum[n] : 0;
    return out;
  }
  function __wavBlob(samples, sr) {
    const bytes = new ArrayBuffer(44 + samples.length * 2), dv = new DataView(bytes);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }
  // ── "띵동" 시작음 ──
  // 버튼을 누른 뒤 첫 원어민 음성 바로 앞에 "띵동"을 넣어 줍니다. 진짜 소리라서 USB·블루투스 이어폰도 확실히 깨워요.
  let __dingPending = false; // 재생 직전에 true → 그 원어민 음성 앞에 '띵동' 한 번(반복마다 다시 켬)
  function __dingSamples(sr) {
    const notes = [[659.25, 0.32], [523.25, 0.5]]; // 띵(미) → 동(도)
    const total = Math.round(sr * (notes[0][1] + notes[1][1]));
    const out = new Float32Array(total);
    let off = 0;
    for (const [f, d] of notes) {
      const n = Math.round(sr * d);
      for (let i = 0; i < n && off + i < total; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.005) * Math.exp(-t * 4.5); // 종소리처럼 '띵' 하고 잦아듦
        out[off + i] = 0.3 * env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) + 0.12 * Math.sin(6 * Math.PI * f * t));
      }
      off += n;
    }
    return out;
  }
  let __dingAudioUrl = null, __dingAudio = null;
  // PC(기기 음성 엔진)용: 띵동을 따로 재생하고 끝나면 resolve
  function __playDingStandalone() {
    // 1순위: 버튼을 누를 때 이미 깨워 둔 원어민 음성 재생기로 띵동을 틉니다.
    //        삼성 인터넷 등은 '버튼으로 깨운 재생기'가 아니면 자동 재생을 막아서 따로 만든 재생기로는 소리가 안 났어요.
    // 2순위: 그게 안 되면 예전처럼 띵동 전용 재생기로 시도합니다.
    return (async () => {
      try {
        if (!__dingAudioUrl) __dingAudioUrl = URL.createObjectURL(__wavBlob(__dingSamples(24000), 24000));
        const ok = await __playAudioOnce(__dingAudioUrl, 1);
        __dbg(ok ? '띵동(따로) 재생됨' : '띵동(따로) 재생 막힘 → 다른 방법 시도');
        if (ok) { await new Promise(r => setTimeout(r, 250)); return; }
      } catch (e) {}
      await new Promise(resolve => {
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        try {
          if (!__dingAudio) __dingAudio = new Audio();
          __dingAudio.src = __dingAudioUrl;
          __dingAudio.onended = () => setTimeout(fin, 250);
          __dingAudio.onerror = fin;
          const pr = __dingAudio.play();
          if (pr && pr.catch) pr.catch(() => { __dbg('띵동 전용 재생기도 막힘'); fin(); });
          setTimeout(fin, 2000);
        } catch (e) { fin(); }
      });
    })();
  }
  // 속도가 적용된 음성 주소를 돌려줍니다. 실패하면 null(그때는 예전처럼 Chrome 재생 속도로 처리).
  async function __getStretchedVoiceUrl(url, rate, withDing) {
    const key = rate.toFixed(3) + (withDing ? '|ding|' : '|') + url;
    if (__stretchCache.has(key)) return __stretchCache.get(key);
    try {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const ctx = new OAC(1, 2, 24000);
      const buf = await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(ab, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      const ch = buf.getChannelData(0);
      const stretched = Math.abs(rate - 1) < 0.02 ? ch : __wsola(ch, buf.sampleRate, rate);
      // 서버가 붙인 앞 무음(0.9초)도 빨라지면 짧아져요(빠르게 1.44배 → 0.63초). USB 이어폰은 깨어나는 데 약 0.7초가
      // 걸려 첫 단어(I)가 잘리므로, 속도와 상관없이 앞 무음이 항상 1초가 되도록 모자란 만큼 더 붙입니다.
      let out;
      if (withDing) {
        // [0.3초 무음] 띵동 [0.1초 쉼 + 서버 무음] 원어민 음성 — 띵동이 이어폰을 깨우므로 추가 무음은 필요 없어요.
        const ding = __dingSamples(buf.sampleRate);
        const pre = Math.round(0.3 * buf.sampleRate), gap = Math.round(0.1 * buf.sampleRate);
        out = new Float32Array(pre + ding.length + gap + stretched.length);
        out.set(ding, pre);
        out.set(stretched, pre + ding.length + gap);
      } else {
        const extra = Math.max(0, Math.round((1.0 - 0.9 / rate) * buf.sampleRate));
        out = new Float32Array(extra + stretched.length);
        out.set(stretched, extra);
      }
      const objUrl = URL.createObjectURL(__wavBlob(out, buf.sampleRate));
      __stretchCache.set(key, objUrl);
      return objUrl;
    } catch (e) {
      return null;
    }
  }

  async function __speakViaAudio(text, rate, gen, withDing) {
    const r = rate * ONLINE_VOICE_SPEED_BOOST;
    // 매번 재생 직전에 이어폰을 깨우고, 깨우기 소리가 실제로 날 때까지 기다린 뒤 재생합니다.
    // 띵동이 이어폰을 깨워 주므로, 띵동이 있는 재생은 깨우기 대기를 건너뜁니다(반복 사이 간격 단축).
    if (!withDing) await wakeOutputViaTTS();
    if (gen !== __voiceGen) return;
    let first = true;
    for (const chunk of __splitForTTS(text, 180)) {
      if (gen !== __voiceGen) return;
      const ding = withDing && first; first = false;
      const url = TTS_AUDIO_ENDPOINT + '?v=3&q=' + encodeURIComponent(chunk);
      const stretched = await __getStretchedVoiceUrl(url, r, ding);
      if (gen !== __voiceGen) return;
      // 사이트가 속도를 미리 적용한 파일이면 1배속으로, 실패했으면 예전처럼 Chrome 재생 속도로 재생
      if (!stretched && ding) { await __playDingStandalone(); if (gen !== __voiceGen) return; }
      const ok = stretched ? await __playAudioOnce(stretched, 1) : await __playAudioOnce(url, r);
      __dbg(`인터넷 음성 ${ok ? '재생됨' : '재생 실패/막힘'}${stretched ? (ding ? ' (띵동 포함 파일)' : '') : ' (가공 실패 → 원본)'}`);
      if (!ok) return;
    }
  }

  // 문장 하나를 원어민 음성으로 읽어 줍니다(끝나면 resolve). 어떤 방식으로 재생할지는 자동으로 고릅니다.
  async function speakText(text, rate) {
    const gen = __voiceGen;
    let withDing = __dingPending; // 버튼을 누른 뒤 첫 재생이면 앞에 '띵동'
    __dingPending = false;
    if (__voiceMode !== 'audio') {
      if (!('speechSynthesis' in window)) {
        __voiceMode = 'audio';
      } else if (!__voiceMode) {
        const voices = await __waitVoices(1500);
        if (gen !== __voiceGen) return;
        __voiceMode = voices.some(__isEnglishVoice) ? 'tts' : 'audio';
      }
    }
    if (__voiceMode === 'tts') {
      // 처음 재생하거나 4초 넘게 쉬었다가 재생하면 스피커·음성 엔진이 덜 깨어 있어 첫 단어가 잘려요 → 0.35초 기다렸다 시작
      if (Date.now() - __lastTtsEnd > 4000) {
        await new Promise(r => setTimeout(r, __lastTtsEnd ? 350 : 600)); // 페이지 첫 재생은 조금 더 기다림
        if (gen !== __voiceGen) return;
        // 소리 없는(볼륨 0) 짧은 준비 음성을 바로 앞에 줄 세워서, 스피커·음성 엔진이 이미 켜진 상태로 문장이 시작되게 합니다.
        try {
          const warm = new SpeechSynthesisUtterance(WARMUP_TEXT);
          warm.lang = 'en-US'; warm.volume = 0.01; warm.rate = 1.5; // 0이면 엔진이 건너뛰어서 효과가 없어요
          const v = pickEnglishVoice(); if (v) warm.voice = v;
          __ttsKeepAlive.push(warm);
          warm.onend = warm.onerror = () => { const k = __ttsKeepAlive.indexOf(warm); if (k >= 0) __ttsKeepAlive.splice(k, 1); };
          window.speechSynthesis.speak(warm);
        } catch (e) {}
      }
      if (withDing) { await __playDingStandalone(); withDing = false; if (gen !== __voiceGen) return; }
      __dbg(`기기 음성으로 재생 (띵동 ${withDing ? '먼저 재생함' : '없음'})`);
      const ok = await __speakViaSynth(text, rate);
      if (ok || gen !== __voiceGen) return;
      __voiceMode = 'audio'; // 이 기기는 음성 엔진이 실제로 소리를 못 냄 → 이후로는 인터넷 음성 사용
    }
    await __speakViaAudio(text, rate, gen, withDing);
  }

  // ── 따라 말하기 "서버 받아쓰기" 대체 모듈 ──
  // 안드로이드 Chrome 내장 음성 인식은 Google 음성 서비스에 녹음을 맡기는데, 기기에 따라 USB(충전 단자)
  // 이어폰 마이크를 쓰지 못해 no-speech만 나와요. 태블릿에서 no-speech가 2번 연속 나오면, 사이트가 직접
  // 녹음(MediaRecorder — 녹음 앱처럼 이어폰 마이크 사용 가능)해서 서버(/api/stt, Groq Whisper)에서 받아쓰도록 바꿉니다.
  // 주소 끝에 ?stt=server 를 붙이면 처음부터 서버 받아쓰기로 테스트할 수 있어요.
  const STT_SERVER_ENDPOINT = '/api/stt';
const STT_DEBUG = /[?&]debug=1\b/.test(location.search); // 주소 끝에 &debug=1 → 실패 원인을 화면에 표시
  // 태블릿·휴대폰은 처음부터 서버 받아쓰기를 씁니다. 안드로이드 Chrome 내장 인식은 Google 음성 서비스 상태,
  // USB 이어폰 등에 따라 소리를 못 받는 경우가 잦았어요. PC는 Chrome 내장 인식을 그대로 씁니다.
  // (주소 끝 ?stt=server → 서버 받아쓰기 강제, ?stt=browser → Chrome 내장 인식 강제)
  // 이 기기에서 Chrome 내장 인식이 실패한 적이 있으면 기억해 두고, 다음 접속부터 처음부터 서버 받아쓰기를 씁니다.
  const __STT_MEMO_KEY = 'shadowing_stt_server';
  const __isTouchDevice = (navigator.maxTouchPoints || 0) > 0;
  function __sttRememberedServer() { try { return localStorage.getItem(__STT_MEMO_KEY) === '1'; } catch (e) { return false; } }
  function __sttRememberServer() { try { localStorage.setItem(__STT_MEMO_KEY, '1'); } catch (e) {} }
  let __sttMode = !canServerSTT ? 'browser'
    : !SpeechRecognitionCtor ? 'server'
    : /[?&]stt=server\b/.test(location.search) ? 'server'
    : /[?&]stt=browser\b/.test(location.search) ? 'browser'
    : (isMobileDevice || !canBrowserSTT || __sttRememberedServer() ? 'server' : 'browser');
  let __sttNoSpeechStreak = 0;
  let __sttActive = null; // 진행 중인 서버 받아쓰기 녹음(중단 버튼용)

  // 브라우저 인식 결과를 기록해서, 태블릿에서 no-speech가 연달아 나오면 서버 받아쓰기로 전환합니다.
  // 전환되면 true를 돌려줍니다(화면에 안내 문구를 띄우는 데 사용).
  function noteBrowserSTTResult(result) {
    if (__sttMode !== 'browser') return false;
    if (result.ok) { __sttNoSpeechStreak = 0; return false; }
    // 인식 서비스 자체가 안 되는 오류는 다시 해도 소용없으니 바로 서버 받아쓰기로 바꾸고 기억합니다.
    if (canServerSTT && ['network', 'service-not-allowed', 'language-not-supported', 'start-failed'].includes(result.error)) {
      __sttMode = 'server';
      __sttRememberServer();
      return true;
    }
    if (result.error === 'no-speech' || result.error === 'audio-capture') __sttNoSpeechStreak++;
    // 터치 화면 기기(태블릿·휴대폰)는 한 번만 실패해도 바로 서버 받아쓰기로 바꾸고 그 기기에 기억합니다.
    // (기기 판별이 빗나가 태블릿이 PC로 보이는 경우까지 대비) PC는 2번 연속 실패 시에만 바꿉니다.
    const limit = (isMobileDevice || __isTouchDevice) ? 1 : 2;
    if (canServerSTT && __sttNoSpeechStreak >= limit) {
      __sttMode = 'server';
      if (isMobileDevice || __isTouchDevice) __sttRememberServer();
      return true;
    }
    return false;
  }

  function stopServerSTT() { if (__sttActive) __sttActive.abort(); }

  // 마이크로 직접 녹음 → 서버에서 받아쓰기. 결과 형식은 브라우저 인식과 같습니다({ ok, heard } / { ok:false, error }).
  // 녹음 길이는 문장 길이에 맞춰 정합니다(말이 느린 학생도 충분히 말할 수 있도록 여유 있게).

  // ── 서버 받아쓰기 업로드 ──
  // 1) 녹음 파일을 그대로 보내고, 실패하면 2) 어느 브라우저 녹음이든 받아쓰기 서비스가 확실히 읽는 WAV(16kHz)로 바꿔 한 번 더 보냅니다.
  //    (삼성 인터넷 등 일부 브라우저의 녹음 형식을 받아쓰기 서비스가 거부하는 경우 대비)
  // 3) 받아쓰기 엔진(Whisper)은 조용한 녹음에서 "Thank you." 같은 말을 지어내는 버릇이 있어서,
  //    연습 문장에 없는 그런 말만 나오면 "목소리가 안 들렸어요"로 처리합니다.
  const __STT_HALLUCINATIONS = /^(thank you( very much)?( for watching)?|thanks( for watching)?|bye( bye)?|you|okay|ok|so|um+|uh+|hmm+|oh|subtitles?.*|.*amara\.org.*)$/i;
  function __sttNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  async function __toWav16k(blob) {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) return null;
    const ab = await blob.arrayBuffer();
    const tmp = new AC(1, 2, 16000);
    const buf = await new Promise((resolve, reject) => {
      const p = tmp.decodeAudioData(ab, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
    const len = Math.max(1, Math.ceil(buf.duration * 16000));
    const ctx = new AC(1, len, 16000);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
    const out = await ctx.startRendering();
    const ch = out.getChannelData(0);
    const bytes = new ArrayBuffer(44 + ch.length * 2), dv = new DataView(bytes);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + ch.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, ch.length * 2, true);
    for (let i = 0; i < ch.length; i++) { const v = Math.max(-1, Math.min(1, ch[i])); dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    return new Blob([bytes], { type: 'audio/wav' });
  }
  async function __postSTT(body, type) {
    try {
      const r = await fetch(STT_SERVER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': type }, body });
      const data = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, data } : { ok: false, code: String(r.status), detail: data.error || '' };
    } catch (e) {
      return { ok: false, code: 'network', detail: (e && e.message) || '' };
    }
  }
  async function __serverTranscribe(blob, type, targetText, dbg) {
    let res = await __postSTT(blob, type);
    let note = '';
    if (!res.ok) {
      // 원래 형식이 거부됐거나 업로드가 끊김 → WAV로 바꿔 한 번 더
      const first = res;
      try {
        const wav = await __toWav16k(blob);
        if (wav) { res = await __postSTT(wav, 'audio/wav'); note = ' (WAV 재시도)'; }
      } catch (e) {}
      if (!res.ok) {
        if (!note) res = await __postSTT(blob, type); // 변환이 안 되면 원래 파일로 한 번 더
        if (!res.ok) return { ok: false, error: 'server-stt-failed', code: first.code, debug: dbg + (STT_DEBUG ? ` / 서버 ${first.code} ${first.detail}${note}` : '') };
      }
    }
    const data = res.data || {};
    const text = (data.text || '').trim();
    const n = __sttNorm(text);
    if (n && __STT_HALLUCINATIONS.test(n) && !__sttNorm(targetText).includes(n)) {
      return { ok: false, error: 'no-speech', debug: dbg + (STT_DEBUG ? ` / 지어낸 말 걸러냄 "${text}"` : '') };
    }
    return text ? { ok: true, heard: text } : { ok: false, error: 'no-speech', debug: dbg + (STT_DEBUG ? ` / 원문 "${data.raw || ''}" / 무음확률 ${JSON.stringify(data.noSpeechProb)}` : '') };
  }


  // ── 말이 끝나면 녹음 일찍 멈추기 ──
  // 예전엔 문장 길이로 정한 시간(예: 6초)을 다 채워 녹음해서 다 말한 뒤에도 기다려야 했어요.
  // 마이크 소리 크기를 0.1초마다 재서, 말을 시작한 뒤 1초 동안 조용하면 바로 녹음을 끝냅니다.
  // (소리 크기를 못 재는 기기면 아무 일도 안 하고, 예전처럼 정해진 시간까지 녹음해요)
  function __watchSilence(stream, onSilence) {
    let ctx = null, timer = null, stopped = false;
    const stop = () => { stopped = true; clearInterval(timer); try { ctx && ctx.close(); } catch (e) {} };
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return stop;
      ctx = new AC();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const data = new Float32Array(an.fftSize);
      const t0 = Date.now();
      let noise = 0, noiseN = 0, loudFrames = 0, speechAt = 0, quietMs = 0;
      timer = setInterval(() => {
        if (stopped) return;
        an.getFloatTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const elapsed = Date.now() - t0;
        if (elapsed < 400) { noise += rms; noiseN++; return; }           // 처음 0.4초: 주변 소음 크기 재기
        const floor = noiseN ? noise / noiseN : 0;
        const th = Math.max(0.015, floor * 2.5);
        if (!speechAt) {
          loudFrames = rms > th ? loudFrames + 1 : 0;
          if (loudFrames >= 2) speechAt = Date.now();                       // 0.2초 이상 소리가 나면 '말 시작'
          return;
        }
        quietMs = rms < th * 0.8 ? quietMs + 100 : 0;
        if (quietMs >= 1000 && Date.now() - speechAt >= 500) { stop(); onSilence(); }
      }, 100);
    } catch (e) { stop(); }
    return stop;
  }

  function recordAndTranscribe(targetText, onReady) {
    return new Promise(async (resolve) => {
      let settled = false, stream = null, recorder = null, timer = null, aborted = false;
      const chunks = [];
      const cleanup = () => {
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        if (__sttActive && __sttActive.owner === resolve) __sttActive = null;
      };
      const settle = (val) => { if (!settled) { settled = true; cleanup(); resolve(val); } };
      __sttActive = { owner: resolve, abort: () => { aborted = true; try { recorder && recorder.state !== 'inactive' && recorder.stop(); } catch (e) {} settle({ ok: false, error: 'aborted' }); } };

      // 마이크를 켜기 '전에' 삐 소리를 냅니다. 안드로이드는 마이크가 켜지는 순간 소리 출력이 통화 모드로 바뀌어
      // 그 뒤에 내는 삐 소리는 묻혀서 들리지 않아요.
      if (typeof playBeep === 'function') { playBeep(); await new Promise(r => setTimeout(r, 280)); }
      if (aborted) return settle({ ok: false, error: 'aborted' });
      try {
        // 에코 제거를 끄면 태블릿이 '통화 모드'로 바뀌지 않아 다음 원어민 음성도 정상적으로 나와요.
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
      } catch (e) {
        const name = e && e.name;
        return settle({ ok: false, error: (name === 'NotAllowedError' || name === 'SecurityError') ? 'not-allowed' : 'audio-capture' });
      }
      if (aborted) return settle({ ok: false, error: 'aborted' });

      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mimeType = types.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } });
      try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
      catch (e) { return settle({ ok: false, error: 'audio-capture' }); }

      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        if (aborted) return settle({ ok: false, error: 'aborted' });
        const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        const dbg = STT_DEBUG ? `[진단] 녹음 ${(blob.size/1024).toFixed(1)}KB, ${type}` : '';
        if (!blob.size) return settle({ ok: false, error: 'no-speech', debug: dbg });
        settle(await __serverTranscribe(blob, type, targetText, dbg));
      };

      const words = targetText.trim().split(/\s+/).filter(Boolean).length;
      const seconds = Math.min(25, 3 + words * 0.65);
      recorder.start();
      const stopWatch = __watchSilence(stream, () => { try { recorder.state !== 'inactive' && recorder.stop(); } catch (e) {} });
      recorder.addEventListener('stop', stopWatch);
      if (onReady) onReady();
      timer = setTimeout(() => { try { recorder.state !== 'inactive' && recorder.stop(); } catch (e) { settle({ ok: false, error: 'no-speech' }); } }, seconds * 1000);
    });
  }

  // 따라 말하기 결과가 실패일 때 화면에 보여줄 안내 문구
  function __sttFailTextBase(i, result) {
    if (result.switchedToServer) return `📱 이 기기에서는 브라우저 음성 인식이 소리를 받지 못하고 있어요(이어폰 마이크 등). 다음 차례부터 사이트가 직접 녹음해서 받아쓰는 방식으로 바꿨어요.`;
    if (result.error === 'server-stt-failed') return `⚠️ ${i}번째 시도: 서버 받아쓰기에 실패했어요${result.code ? ` (오류 ${result.code})` : ''}. 인터넷 연결을 확인해 주세요. 계속 진행합니다.`;
    if (result.error === 'no-speech') return `⚠️ ${i}번째 시도에서 목소리가 들리지 않았어요. "지금 말씀하세요!"가 뜬 뒤 또렷하게 말해 주세요. 계속 진행합니다.`;
    return `⚠️ ${i}번째 시도에서 소리를 인식하지 못했어요 (${result.error}). 계속 진행합니다.`;
  }
  function sttFailText(i, result) {
    const base = __sttFailTextBase(i, result);
    return result.debug ? base + ' ' + result.debug : base;
  }


  let micWarmupPromise = null;
  function warmupMic() {
    // 태블릿/휴대폰에서는 미리 마이크를 켜지 않습니다. 블루투스 이어폰은 마이크가 켜지는 순간 '통화 모드'로 바뀌어
    // 원어민 음성이 이어폰으로 나오지 않기 때문이에요. 마이크 권한은 따라 말하기 단계에서 물어봅니다.
    // 터치 화면 기기(PC로 잘못 판정된 태블릿 포함)나 서버 받아쓰기를 쓰는 중이면 미리 켜지 않습니다.
    // 마이크가 켜져 있으면 안드로이드에서 원어민 음성이 막혀 바로 '삐'로 넘어가 버려요.
    if (isMobileDevice || (navigator.maxTouchPoints || 0) > 0 || __sttMode === 'server') return Promise.resolve(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
    if (!micWarmupPromise) {
      micWarmupPromise = navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          // 태블릿/모바일에서는 마이크를 계속 켜 두면 오디오가 '녹음 모드'로 바뀌어 듣기(TTS) 소리가 안 나거나 매우 작아져요.
          // 권한만 받아 두고 바로 놓아줍니다. (PC는 기존처럼 붙잡아 두어 권한 재요청을 줄입니다.)
          if (isMobileDevice && stream) stream.getTracks().forEach(t => t.stop());
          return stream;
        })
        .catch(() => null);
    }
    return micWarmupPromise;
  }

  function compareWords(target, heard) {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9'\s]/g, '').split(/\s+/).filter(Boolean);
    const tw = norm(target);
    const hw = norm(heard);
    const dp = Array.from({ length: tw.length + 1 }, () => new Array(hw.length + 1).fill(0));
    for (let i = tw.length - 1; i >= 0; i--)
      for (let j = hw.length - 1; j >= 0; j--)
        dp[i][j] = tw[i] === hw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

    let i = 0, j = 0, html = '', matched = 0;
    while (i < tw.length && j < hw.length) {
      if (tw[i] === hw[j]) { html += `<span class="w-ok">${escapeHTML(tw[i])}</span>`; matched++; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { html += `<span class="w-miss">${escapeHTML(tw[i])}</span>`; i++; }
      else { html += `<span class="w-extra">${escapeHTML(hw[j])}</span>`; j++; }
    }
    while (i < tw.length) { html += `<span class="w-miss">${escapeHTML(tw[i])}</span>`; i++; }
    while (j < hw.length) { html += `<span class="w-extra">${escapeHTML(hw[j])}</span>`; j++; }

    const score = tw.length ? Math.round((matched / tw.length) * 100) : 0;
    return { score, html };
  }

  function buildShadowingControls(targetText) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="controls">
        <select class="rate-select">
          <option value="1.2" selected>빠르게</option>
          <option value="1">보통 속도</option>
          <option value="0.8">약간 천천히</option>
          <option value="0.6">천천히</option>
        </select>
        <span class="repeat-field" style="display:flex; align-items:center; gap:4px;">
          <input type="number" class="repeat-input" min="1" max="30" value="10" style="width:52px; background:var(--input-bg); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:6px 8px; font-size:0.82rem; font-family:inherit;">
          <span style="font-size:0.78rem; color:var(--muted);">회 반복</span>
        </span>
        <label class="mic-toggle-label" style="display:flex; align-items:center; gap:4px; font-size:0.78rem; color:var(--muted); cursor:${hasSTT ? 'pointer' : 'not-allowed'};" title="${hasSTT ? '마이크가 안 되거나 오류가 계속 나면 체크를 꺼서 듣기만 연습하세요.' : '이 브라우저는 마이크 녹음을 지원하지 않아요. 최신 Chrome·Edge·Safari로 열어주세요.'}">
          <input type="checkbox" class="mic-toggle" ${hasSTT ? 'checked' : 'disabled'}> 🎙️ 마이크 사용
        </label>
        <button class="btn-primary btn-small practice-btn" ${hasTTS ? '' : 'disabled title="이 브라우저는 TTS를 지원하지 않습니다"'}>▶ 연습 시작</button>
        <span class="repeat-count-badge" style="display:none;"></span>
        <span class="score-badge" style="display:none;"></span>
      </div>
      <div class="heard" style="display:none;"></div>
      <div class="word-compare"></div>
    `;
    const practiceBtn = wrap.querySelector('.practice-btn');
    const rateSelect = wrap.querySelector('.rate-select');
    const repeatInput = wrap.querySelector('.repeat-input');
    const micToggle = wrap.querySelector('.mic-toggle');
    const scoreBadge = wrap.querySelector('.score-badge');
    const repeatCountBadge = wrap.querySelector('.repeat-count-badge');
    const heardEl = wrap.querySelector('.heard');
    const compareEl = wrap.querySelector('.word-compare');

    let runState = { stopped: true, activeRecognition: null };
    let shadowingCount = 0;

    function speakOnce(rate) {
      return speakText(targetText, rate);
    }

    let sharedRecognition = null;
    function getSharedRecognition() {
      if (!sharedRecognition) {
        sharedRecognition = new SpeechRecognitionCtor();
        sharedRecognition.lang = 'en-US';
        sharedRecognition.interimResults = false;
        sharedRecognition.maxAlternatives = 1;
      }
      return sharedRecognition;
    }

    function runBrowserRecognition(onReady) {
      return new Promise((resolve) => {
        let settled = false, heard = null, lastError = null;
        const settle = (val) => { if (!settled) { settled = true; clearTimeout(hardStop); resolve(val); } };

        const recognition = getSharedRecognition();
        runState.activeRecognition = recognition;

        // 마이크가 완전히 닫힌 뒤(onend)에만 다음 단계로 넘어갑니다. 예전에는 오류(onerror)가 나는 즉시 넘어가서
        // 마이크가 아직 열려 있는 채로 다음 반복이 시작됐고, 그러면 다음 마이크가 바로 실패해서
        // 말할 틈 없이 원어민 음성만 반복되는 문제가 있었어요.
        const hardStop = setTimeout(() => {
          try { recognition.abort(); } catch (e) {}
          setTimeout(() => settle(heard ? { ok: true, heard } : { ok: false, error: lastError || 'no-speech' }), 1000);
        }, 20000);
        recognition.onstart = () => { if (onReady) onReady(); };
        recognition.onresult = (event) => { heard = event.results[0][0].transcript; };
        recognition.onerror = (event) => { lastError = event.error; };
        recognition.onend = () => { settle(heard ? { ok: true, heard } : { ok: false, error: lastError || 'no-speech' }); };
        const tryStart = (canRetry) => {
          try { recognition.start(); }
          catch (e) {
            // 이전 인식이 아직 정리 중이면 잠깐 기다렸다가 한 번 더 시도합니다.
            if (canRetry) { try { recognition.abort(); } catch (_) {} setTimeout(() => tryStart(false), 700); }
            else settle({ ok: false, error: 'start-failed' });
          }
        };
        tryStart(true);
      });
    }

    // 따라 말하기 한 번: 평소엔 브라우저 내장 음성 인식, 이 기기에서 그게 안 되면 서버 받아쓰기.
    function runOneRecognition(onReady) {
      if (__sttMode === 'server') return recordAndTranscribe(targetText, onReady);
      return runBrowserRecognition(onReady).then(result => {
        if (noteBrowserSTTResult(result)) result.switchedToServer = true;
        return result;
      });
    }

    function micPermissionErrorHTML(errorCode) {
      if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
        if (location.protocol === 'file:') {
          return '⚠️ 마이크 권한이 계속 다시 요청돼요. 이 파일을 직접 열어서 쓸 때(file://) 크롬이 마이크 허용 상태를 저장하지 못해서 생기는 문제예요.<br>'
            + '해결 방법: 주소창의 🔒/카메라 아이콘을 눌러 "이 사이트에서 항상 허용"으로 바꿔보시거나, https 주소로 배포해서 사용해주세요. "🎙️ 마이크 사용" 체크를 끄면 듣기만으로도 계속 연습할 수 있어요.';
        }
        return '⚠️ 마이크 권한이 거부됐어요. 주소창의 🔒 아이콘을 눌러 마이크 권한을 "허용"으로 바꾸거나, "🎙️ 마이크 사용" 체크를 끄고 듣기만으로 연습해보세요.';
      }
      return null;
    }

    // 듣기(TTS)와 따라 말하기(마이크)를 버튼 하나로 합친 연습 루프입니다.
    // "🎙️ 마이크 사용" 체크가 꺼져 있으면(마이크가 안 될 때) 마이크 단계는 건너뛰고 듣기만 반복합니다.
    function stopThisCard() {
      runState.stopped = true;
      stopVoice(); stopServerSTT();
      if (runState.activeRecognition) { try { runState.activeRecognition.abort(); } catch (e) {} }
      practiceBtn.textContent = '▶ 연습 시작';
      stopOutputKeepAlive();
      if (__activeShadowStop === stopThisCard) __activeShadowStop = null;
    }

    practiceBtn.addEventListener('click', async () => {
      if (!runState.stopped) { stopThisCard(); return; }
      if (!hasTTS) return;
      // 다른 카드가 재생 중이면 그 카드의 반복을 완전히 멈춘 뒤 시작합니다(두 문장 소리가 겹치지 않게).
      if (__activeShadowStop && __activeShadowStop !== stopThisCard) __activeShadowStop();
      __activeShadowStop = stopThisCard;
      stopVoice();
      // 태블릿: 버튼을 누른 바로 이 순간(마이크 권한 대기 등 await 이전)에 음성 재생을 깨워야 소리가 납니다.
      unlockVoice();
      __dingPending = true; // 이번에 누른 뒤 첫 원어민 음성 앞에 '띵동' (무음 흘리기는 효과가 없어 뺐어요)

      let count = parseInt(repeatInput.value, 10);
      if (!count || count < 1) count = 1;
      if (count > 30) count = 30;
      repeatInput.value = count;

      const useMic = hasSTT && micToggle.checked;
      const rate = parseFloat(rateSelect.value);

      runState = { stopped: false, activeRecognition: null };
      heardEl.style.display = 'none';
      scoreBadge.style.display = 'none';
      compareEl.innerHTML = '';

      if (useMic) await warmupMic();

      for (let i = 1; i <= count; i++) {
        if (runState.stopped) break;
        practiceBtn.textContent = `⏹ 정지 (${i}/${count})`;
        __dingPending = true; // 반복할 때마다 원어민 음성 앞에 '띵동'
        await speakOnce(parseFloat(rateSelect.value) || rate); // 반복마다 지금 선택된 속도로(반복 중에 바꿔도 바로 반영)
        if (runState.stopped) break;

        if (useMic) {
          practiceBtn.textContent = `⏹ 정지 · 마이크 준비 중 (${i}/${count})`;
          const result = await runOneRecognition(() => {
            if (!runState.stopped) practiceBtn.textContent = `⏹ 정지 · 🗣️ 지금 말씀하세요! (${i}/${count})`;
          });
          if (runState.stopped) break;

          if (result.ok) {
            shadowingCount++;
            repeatCountBadge.style.display = 'inline-flex';
            repeatCountBadge.textContent = `🗣️ 따라 말한 횟수 ${shadowingCount}`;

            heardEl.style.display = 'block';
            heardEl.textContent = `👂 인식된 발음 (${i}/${count}): "${result.heard}"`;
            const { score, html } = compareWords(targetText, result.heard);
            compareEl.innerHTML = html;
            scoreBadge.style.display = 'inline-flex';
            scoreBadge.textContent = `일치도 ${score}%`;
            scoreBadge.className = 'score-badge ' + (score >= 85 ? 'good' : score >= 60 ? 'mid' : 'bad');
          } else {
            const permHTML = micPermissionErrorHTML(result.error);
            heardEl.style.display = 'block';
            if (permHTML) {
              heardEl.innerHTML = permHTML;
              break; // 권한 문제는 반복해도 소용없으니 멈춥니다 (마이크 사용 체크를 끄면 계속 진행 가능)
            }
            heardEl.textContent = sttFailText(i, result);
          }
        }

        if (!runState.stopped && i < count) await new Promise(r => setTimeout(r, useMic ? (isMobileDevice ? 900 : 700) : 500)); // 태블릿: 블루투스 이어폰이 통화 모드에서 돌아올 시간
      }
      runState.stopped = true;
      runState.activeRecognition = null;
      if (!__activeShadowStop || __activeShadowStop === stopThisCard) { stopOutputKeepAlive(); __activeShadowStop = null; }
      practiceBtn.textContent = '▶ 연습 시작';
    });

    return wrap;
  }

  if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

  function isSecureContextForMic() {
    const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
    return location.protocol === 'https:' || isLocalhost;
  }

  /* ===================== x: / o: / w: 텍스트 파서 (공용) ===================== */
  // "x:", "x-", "x " 뿐 아니라 "[x]"(대괄호, 뒤에 공백 있어도/없어도) 형식도 인식합니다.
  const X_PREFIX_RE = /^(?:\[x\]\s*|x\s*(?:[:：\-－]\s*|\s+))/i;
  const O_PREFIX_RE = /^(?:\[o\]\s*|o\s*(?:[:：\-－]\s*|\s+))/i;
  const W_PREFIX_RE = /^(?:\[w\]\s*|w\s*(?:[:：\-－]\s*|\s+))/i;

  function parseFeedbackBlock(text, pairMode) {
    const lines = text.split('\n');
    const newSentences = [];
    const newWords = [];
    let pendingX = '';
    let pendingPairX = null;
    lines.forEach(raw => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      if (X_PREFIX_RE.test(line)) {
        pendingX = line.replace(X_PREFIX_RE, '');
      } else if (O_PREFIX_RE.test(line)) {
        const o = line.replace(O_PREFIX_RE, '');
        if (o) newSentences.push({ x: pendingX, o });
        pendingX = '';
      } else if (W_PREFIX_RE.test(line)) {
        const w = line.replace(W_PREFIX_RE, '');
        if (w) newWords.push(w);
      } else if (pairMode) {
        if (pendingPairX === null) {
          pendingPairX = line;
        } else {
          newSentences.push({ x: pendingPairX, o: line, hideX: true });
          pendingPairX = null;
        }
      } else {
        newSentences.push({ x: pendingX, o: line });
        pendingX = '';
      }
    });
    if (pendingPairX !== null) {
      newSentences.push({ x: '', o: pendingPairX });
    }
    return { newSentences, newWords };
  }

  // 이미 저장된 문장/단어에 "[x]", "[o]", "x:", "o:" 같은 접두어가 실수로 남아있어도
  // 화면에 보여줄 때는 항상 깔끔하게 지워서 보여줍니다(과거에 저장된 데이터도 자동으로 교정됨).
  function stripLeadingLabel(text) {
    if (!text) return text;
    return String(text).trim().replace(X_PREFIX_RE, '').replace(O_PREFIX_RE, '').replace(W_PREFIX_RE, '').trim();
  }

  function parseWordsBlock(text) {
    return text
      .split(/[,\n]+/)
      .flatMap(chunk => chunk.trim().split(/\s+/))
      .map(w => w.replace(W_PREFIX_RE, '').trim())
      .filter(Boolean);
  }

  /* ===================== 문법 설명 엔진 (오프라인, 패턴 기반) ===================== */
  function normWords(s) {
    return s.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/).filter(Boolean);
  }

  const BE_VERBS = ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'];
  const AUX_VERBS = ['do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might', 'shall'];
  const MODAL_TO_PHRASES = ["have to", "has to", "had to", "need to", "needs to", "want to", "wants to", "going to", "used to", "try to", "tries to", "love to", "like to", "plan to", "planning to", "decide to", "decided to"];
  const PREPOSITIONS = ['to', 'at', 'in', 'on', 'for', 'of', 'with', 'from', 'by', 'about', 'into', 'onto', 'over', 'under', 'between', 'among', 'through', 'during', 'after', 'before', 'around', 'near', 'without', 'against', 'toward', 'towards', 'across'];
  const ARTICLES = ['a', 'an', 'the'];
  const PRONOUNS = ['i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'this', 'that', 'these', 'those'];
  const COMMON_VERBS = ['go', 'goes', 'went', 'come', 'comes', 'came', 'get', 'gets', 'got', 'take', 'takes', 'took', 'make', 'makes', 'made', 'do', 'does', 'did', 'have', 'has', 'had', 'eat', 'eats', 'ate', 'play', 'plays', 'played', 'study', 'studies', 'studied', 'work', 'works', 'worked', 'watch', 'watches', 'watched', 'meet', 'meets', 'met', 'see', 'sees', 'saw', 'visit', 'visits', 'visited', 'buy', 'buys', 'bought', 'read', 'reads', 'stay', 'stays', 'stayed', 'feel', 'feels', 'felt', 'think', 'thinks', 'thought', 'know', 'knows', 'knew', 'say', 'says', 'said', 'tell', 'tells', 'told', 'give', 'gives', 'gave', 'use', 'uses', 'used', 'find', 'finds', 'found', 'want', 'wants', 'wanted', 'need', 'needs', 'needed', 'try', 'tries', 'tried', 'call', 'calls', 'called', 'ask', 'asks', 'asked', 'wear', 'wears', 'wore', 'sleep', 'sleeps', 'slept', 'run', 'runs', 'ran', 'walk', 'walks', 'walked', 'talk', 'talks', 'talked', 'speak', 'speaks', 'spoke', 'write', 'writes', 'wrote', 'listen', 'listens', 'listened', 'live', 'lives', 'lived'];
  const VERB_HINTS_SUFFIX = /(ed|ing|s)$/;

  function isPrep(w) { return PREPOSITIONS.includes(w); }
  function isArticle(w) { return ARTICLES.includes(w); }
  function isBe(w) { return BE_VERBS.includes(w); }
  function isAux(w) { return AUX_VERBS.includes(w); }
  function isPronoun(w) { return PRONOUNS.includes(w); }
  function looksLikeVerb(w) { return COMMON_VERBS.includes(w) || isBe(w) || isAux(w) || VERB_HINTS_SUFFIX.test(w); }

  function diffWordOps(xw, ow) {
    const n = xw.length, m = ow.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = xw[i] === ow[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const raw = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (xw[i] === ow[j]) { raw.push({ type: 'same', xw: xw[i], ow: ow[j] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ type: 'del', xw: xw[i] }); i++; }
      else { raw.push({ type: 'ins', ow: ow[j] }); j++; }
    }
    while (i < n) { raw.push({ type: 'del', xw: xw[i] }); i++; }
    while (j < m) { raw.push({ type: 'ins', ow: ow[j] }); j++; }

    const ops = [];
    let k = 0;
    while (k < raw.length) {
      if (raw[k].type === 'same') { ops.push({ type: 'same', words: [raw[k].xw] }); k++; continue; }
      let dels = [], inss = [];
      while (k < raw.length && raw[k].type === 'del') { dels.push(raw[k].xw); k++; }
      while (k < raw.length && raw[k].type === 'ins') { inss.push(raw[k].ow); k++; }
      if (dels.length && inss.length) ops.push({ type: 'replace', from: dels, to: inss });
      else if (dels.length) ops.push({ type: 'delete', words: dels });
      else if (inss.length) ops.push({ type: 'insert', words: inss });
    }
    return ops;
  }

  function describeReplace(fromArr, toArr) {
    const from = fromArr.join(' '), to = toArr.join(' ');
    const TENSE_PAIRS = [["don't", "didn't"], ["doesn't", "didn't"], ["isn't", "wasn't"], ["aren't", "weren't"],
      ["is", "was"], ["are", "were"], ["am", "was"], ["do", "did"], ["does", "did"], ["will", "would"]];
    for (const [pres, past] of TENSE_PAIRS) {
      if (from === pres && to === past) {
        return `📌 시제(때) 오류 — "${pres}" → "${past}"\n동사 "${pres}"는 현재 시제인데, 이 문장은 이미 지나간 일(과거)을 말하고 있어요. 영어는 동사 자체의 형태를 바꿔서 시제를 나타내므로, 과거의 일에는 반드시 과거형 "${past}"를 써야 해요. 한국어는 "나는 어제 학교에 가요"처럼 시간부사만 바꿔도 되지만, 영어는 그렇게 하면 문법 오류가 됩니다.`;
      }
    }
    if (fromArr.length === 1 && toArr.length === 1) {
      const f = fromArr[0], t = toArr[0];
      if ((t === f + 's' || t === f + 'es') && !isBe(f) && !isAux(f) && !looksLikeVerb(f)) {
        return `📌 명사의 수(단수/복수) 오류 — "${f}" → "${t}"\n영어 명사는 하나(단수)인지 여럿(복수)인지에 따라 형태가 달라져요. 가리키는 대상이 두 개 이상이라면 명사 끝에 -s(또는 -es)를 붙여 복수형으로 써야 해요. 한국어 명사는 단/복수에 따라 형태가 거의 바뀌지 않아서("사과 한 개"나 "사과 여러 개"나 둘 다 "사과") 한국인 학습자가 자주 놓치는 부분이에요.`;
      }
      if ((t === f + 's' || t === f + 'es') && (looksLikeVerb(f) || looksLikeVerb(t))) {
        return `📌 주어-동사 수일치 오류 — "${f}" → "${t}"\n주어가 3인칭 단수(he, she, it 또는 사람/사물 이름 하나)일 때, 현재 시제 동사에는 반드시 -s(또는 -es)를 붙여야 해요. 그래서 동사원형 "${f}"가 아니라 "${t}"가 맞는 형태예요. 주어가 I, you, we, they이거나 복수일 때는 -s를 붙이지 않는다는 점도 함께 기억해두세요.`;
      }
      if (isPrep(f) && isPrep(t)) {
        return `📌 전치사 오류 — "${f}" → "${t}"\n전치사는 뜻이 비슷해 보여도 쓰임이 서로 다른 경우가 많아서, 문맥에 맞는 전치사를 골라 써야 해요. 이 문장에서는 "${f}"가 아니라 "${t}"를 쓰는 것이 관용적으로(원어민들이 실제로 쓰는 방식으로) 자연스러워요. 전치사는 규칙보다 표현 단위(연어, collocation)로 통째로 외워두는 게 좋아요.`;
      }
      if (isArticle(f) || isArticle(t)) {
        return `📌 관사 오류 — "${f}" → "${t}"\n영어는 명사 앞에 무엇을 쓰는지(a/an, the, 또는 아무것도 안 씀)로 그 명사가 "특정한 것"인지 "막연한 하나"인지를 구분해요. 한국어에는 관사 개념이 없어서 자주 실수하는 부분인데, 여기서는 "${t}"를 쓰는 것이 맞아요.`;
      }
      if (isPronoun(f) || isPronoun(t)) {
        return `📌 대명사/인칭 오류 — "${f}" → "${t}"\n문장 속 주어나 목적어 역할에 맞는 대명사 형태를 써야 해요. "${f}" 대신 "${t}"를 쓰는 것이 문맥(주격/목적격 또는 가리키는 대상)에 맞아요.`;
      }
      if (looksLikeVerb(f) && looksLikeVerb(t)) {
        return `📌 동사 형태 오류 — "${f}" → "${t}"\n같은 동사라도 시제나 형태(원형/과거형/과거분사/-ing형 등)에 따라 모양이 달라져요. 이 문장의 시제·문형에 맞는 형태는 "${f}"가 아니라 "${t}"예요.`;
      }
      return `📌 단어 선택 오류 — "${f}" → "${t}"\n"${f}"라는 단어 자체가 틀린 것은 아니지만, 이 문맥에서는 "${t}"가 의미상 더 정확하고 원어민이 실제로 쓰는 자연스러운 표현이에요.`;
    }
    return `📌 표현 교체 — "${from}" → "${to}"\n이 부분은 단어 하나가 아니라 표현 전체가 더 자연스러운 말로 바뀌었어요. 한국어 표현을 단어 하나하나 그대로 영어로 옮기기보다, 영어에서 실제로 쓰이는 표현 덩어리(구/관용표현) 단위로 익혀두는 것이 좋아요.`;
  }

  function describeInsert(words, prevWord, nextWord) {
    const phrase = words.join(' ');
    if (words.length === 1) {
      const w = words[0];
      if (isPrep(w)) {
        return `📌 전치사 "${w}" 누락\n"${prevWord || '(문장 앞부분)'}"과(와) "${nextWord || '(뒤 단어)'}" 사이에 전치사 "${w}"가 빠져 있었어요. 전치사는 명사(구)가 문장 속에서 시간·장소·방향·대상 등 어떤 역할을 하는지 표시해주는 말이라서, 빠지면 두 단어의 관계가 불명확해져요.`;
      }
      if (isArticle(w)) {
        return `📌 관사 "${w}" 누락\n"${nextWord || '뒤에 오는 명사'}" 앞에 관사 "${w}"가 빠져 있었어요. 셀 수 있는 명사가 하나만 있을 때는 그 앞에 a/an(막연한 하나) 또는 the(특정한 것)를 반드시 붙여야 해요. 한국어에는 이런 관사가 없어서 한국인 학습자가 가장 자주 빠뜨리는 부분이에요.`;
      }
      if (isBe(w)) {
        return `📌 be동사 "${w}" 누락\n주어 뒤에 be동사 "${w}"가 빠져 있었어요. 영어 문장은 "주어 + 동사"가 기본 골격이라서, 형용사나 명사로 끝나는 서술(예: "행복하다", "학생이다")을 하려면 반드시 be동사가 있어야 해요. 한국어는 "나 행복"처럼 동사 없이도 자연스럽지만, 영어에서는 문법 오류가 됩니다.`;
      }
      if (isAux(w) && MODAL_TO_PHRASES.some(p => p.startsWith(w))) {
        return `📌 조동사/준조동사 "${w}" 누락\n"${w}"가 빠져 있었어요. 이 단어는 뒤에 오는 동사의 의미(의무·필요·경험 등)를 더해주는 조동사 역할을 해서, 빠지면 문장의 의미와 형태가 달라져요.`;
      }
      if (looksLikeVerb(w)) {
        if (prevWord === 'to' || MODAL_TO_PHRASES.some(p => p.endsWith('to'))) {
          return `📌 본동사 "${w}" 누락 (to부정사 구조)\n"to" 뒤에는 반드시 동사원형이 와서 "to ${w}"(부정사) 형태를 만들어야 하는데, 정작 동사 "${w}"가 빠지고 "to" 뒤에 명사(장소·대상 등)만 바로 나와 있었어요. "have to / need to / want to / going to"처럼 "동사 + to" 표현 뒤에는 명사가 아니라 반드시 "동사원형"이 와야 해서, 뜻을 완성하려면 "${w}"와 같은 동사를 넣어줘야 해요. 예: "I have to Seoul"(✗, 동사 없음) → "I have to go to Seoul"(✓, go라는 본동사가 있음).`;
        }
        return `📌 본동사 "${w}" 누락\n문장에 술어 역할을 할 동사 "${w}"가 빠져 있었어요. 영어 문장은 명사(구)만 나열해서는 완전한 문장이 될 수 없고, 반드시 주어의 동작이나 상태를 나타내는 동사가 있어야 해요.`;
      }
      return `📌 단어 "${w}" 추가\n"${w}"가 새로 들어가면서 문장의 의미가 더 정확하고 자연스러워졌어요.`;
    }
    const first = words[0];
    if (looksLikeVerb(first) && (prevWord === 'to' || MODAL_TO_PHRASES.some(p => p.split(' ').includes(prevWord)))) {
      return `📌 본동사 "${first}" 누락 (to부정사 구조)\n"to" 뒤에는 반드시 동사원형이 와서 "to ${first}"(부정사) 형태를 만들어야 하는데, 정작 동사 "${first}"가 빠지고 "to" 뒤에 명사(장소·대상 등)만 바로 나와 있었어요. "have to / need to / want to / going to"처럼 "동사 + to" 표현 뒤에는 명사가 아니라 반드시 "동사원형"이 와야 해서, 뜻을 완성하려면 "${phrase}"처럼 동사를 넣어줘야 해요. 예: "I have to Seoul"(✗, 동사 없음) → "I have to ${phrase} Seoul"(✓, 본동사가 있음).`;
    }
    return `📌 표현 "${phrase}" 추가\n이 부분이 문장에 통째로 추가되면서 의미가 더 분명하고 자연스러워졌어요. 한국어에서는 생략해도 자연스러운 부분이 영어에서는 명시적으로 들어가야 하는 경우가 많아요.`;
  }

  function describeDelete(words) {
    const phrase = words.join(' ');
    return `📌 불필요한 표현 "${phrase}" 삭제\n"${phrase}"는 이 문장에서는 없어도 되거나, 있으면 오히려 어색한 표현이라 빠졌어요. 한국어를 단어 그대로 영어로 옮기는 "직역" 과정에서 이런 군더더기 표현이 자주 생기는데, 영어식으로 더 간결하게 표현하는 연습이 필요해요.`;
  }

  function explainDifference(x, o) {
    if (!x || !x.trim()) return '';
    const xw = normWords(x);
    const ow = normWords(o);
    if (!xw.length) return '';

    const notes = [];

    if (xw.length <= 3 && ow.length >= xw.length * 2) {
      notes.push(`📌 문장 조각(단답형) 오류\n"${x}"처럼 단어 몇 개만으로 대답하면 구어체에서는 통해도 격식 있는 완전한 문장이 아니에요. 영어 문장의 기본 구조는 "주어(Subject) + 동사(Verb) + (목적어/보어)"이므로, "${o}"처럼 주어와 동사를 모두 갖춘 문장으로 말하는 연습이 필요해요.`);
    }

    const ops = diffWordOps(xw, ow);
    ops.forEach(op => {
      if (op.type === 'replace') notes.push(describeReplace(op.from, op.to));
      else if (op.type === 'insert') {
        const idx = ops.indexOf(op);
        const prevSame = [...ops.slice(0, idx)].reverse().find(o2 => o2.type === 'same');
        const nextSame = ops.slice(idx + 1).find(o2 => o2.type === 'same');
        notes.push(describeInsert(op.words, prevSame ? prevSame.words[0] : '', nextSame ? nextSame.words[0] : ''));
      }
      else if (op.type === 'delete') notes.push(describeDelete(op.words));
    });

    if (notes.length === 0) {
      notes.push('📌 문장 구조 분석\n단어 구성은 같지만 어순이나 표현 방식이 더 자연스럽게 다듬어졌어요. 위 취소선(✗) 문장과 비교하며 어순 차이를 확인해보세요.');
    }

    const oHasBe = ow.some(isBe);
    const structureNote = `\n📖 문장 구조 정리: "${o}" 는 ${oHasBe ? '[주어] + [be동사] + [보어/설명]' : '[주어] + [동사] + [목적어/부가어]'} 구조의 완전한 문장입니다.`;

    return notes.join('\n\n') + structureNote;
  }

  /* ===================== 비슷한 표현 4개 (사전 기반) ===================== */
  const PARAPHRASE_DICT = [
    [/\ba lot of\b/gi, ['plenty of', 'lots of', 'a good amount of', 'quite a few']],
    [/\bi think\b/gi, ['I believe', 'I feel like', 'In my opinion,', 'It seems to me']],
    [/\bi want to\b/gi, ["I'd like to", "I'm planning to", 'I hope to', "I'm hoping to"]],
    [/\bi like\b/gi, ['I enjoy', "I'm a fan of", 'I really like', "I'm into"]],
    [/\bi love\b/gi, ['I really love', 'I adore', "I'm crazy about", 'I truly enjoy']],
    [/\bi feel proud of myself\b/gi, ['I feel really proud', "I'm proud of myself", 'It makes me proud', 'I feel a sense of pride']],
    [/\bmakes? me excited\b/gi, ['get me excited', 'make me feel thrilled', 'make me really happy', 'get me pumped']],
    [/\ba perfect score\b/gi, ['a perfect mark', 'full marks', '100 percent', 'top marks']],
    [/\bstayed at home\b/gi, ['stayed home', 'stayed in', 'spent the day at home', "didn't go out"]],
    [/\bwhere can i\b/gi, ["where's the best place to", 'do you know where I can', 'where would I go to', 'is there a place where I can']],
    [/\bwhere do i\b/gi, ["where's the best place to", 'do you know where I should', 'where should I', 'is there a place where I should']],
    [/\bhow can i\b/gi, ["what's the best way to", 'do you know how I can', 'how would I', 'is there a way I can']],
    [/\bhow do i\b/gi, ["what's the best way to", 'do you know how I should', 'how should I', 'is there a way I should']],
    [/\bwhat should i\b/gi, ['what do you think I should', 'any idea what I should', "what's the best thing to", 'what would you suggest I']],
    [/\bwhen can i\b/gi, ['what time can I', 'do you know when I can', 'when would be a good time to', 'is there a time I can']],
    [/\bdo you know\b/gi, ['could you tell me', 'would you happen to know', 'any idea', 'can you tell me']],
    [/\bcan i\b/gi, ['could I', 'may I', 'is it possible for me to', 'would it be okay if I']],
    [/\bcan you\b/gi, ['could you', 'would you', 'is it possible for you to', 'would you mind if you']],
    [/\bis there\b/gi, ['do you know if there is', 'i wonder if there is', 'could there be', 'by any chance, is there']],
    [/\bhow much\b/gi, ["what's the price for", 'what does it cost for', 'roughly how much', 'about how much']],
    [/\bwhat time\b/gi, ['at what time', 'around what time', 'roughly when', 'do you know what time']],
    [/\bdoesn't like\b/gi, ["isn't a fan of", "doesn't really like", "isn't into", "isn't really keen on"]],
    [/\bdoesn't want\b/gi, ["isn't looking to", "doesn't really want", "isn't interested in", "isn't up for"]],
    [/\bdoesn't have\b/gi, ["is without", "doesn't happen to have", "is missing", "doesn't currently have"]],
    [/\bvisited\b/gi, ['went to', 'traveled to', 'made a trip to', 'stopped by']],
    [/\bwent to\b/gi, ['visited', 'traveled to', 'headed to', 'made a trip to']],
    [/\bwatched\b/gi, ['saw', 'checked out', 'caught', 'sat through']],
    [/\bate\b/gi, ['had', 'grabbed', 'enjoyed', 'tried']],
    [/\bbought\b/gi, ['picked up', 'got', 'purchased', 'grabbed']],
    [/\bmet\b/gi, ['ran into', 'got together with', 'caught up with', 'hung out with']],
    [/\bsaw\b/gi, ['spotted', 'noticed', 'caught sight of', 'ran into']],
    [/\bplayed\b/gi, ['took part in', 'joined in on', 'had a go at', 'enjoyed playing']],
    [/\bstudied\b/gi, ['looked into', 'went over', 'reviewed', 'worked through']],
    [/\bfinished\b/gi, ['wrapped up', 'completed', 'got done with', 'wound up']],
    [/\bstarted\b/gi, ['began', 'kicked off', 'got going on', 'set out on']],
    [/\bdecided\b/gi, ['made up my mind', 'chose', 'settled on', 'went with']],
    [/\bforgot\b/gi, ['couldn’t remember', 'slipped my mind (', 'lost track of', 'blanked on']],
    [/\brealized\b/gi, ['noticed', 'figured out', 'came to see', 'discovered']],
    [/\btried\b/gi, ['gave it a shot', 'attempted', 'gave it a try', 'had a go']],
    [/\bwanted\b/gi, ['felt like', 'was hoping', 'was in the mood for', 'really wanted']],
    [/\bneeded\b/gi, ['had to have', 'required', 'was in need of', 'ended up needing']],
    [/\bhelped\b/gi, ['gave a hand with', 'assisted with', 'lent a hand with', 'pitched in on']],
    [/\bfound\b/gi, ['came across', 'discovered', 'spotted', 'ran across']],
    [/\bwrote\b/gi, ['put together', 'drafted', 'jotted down', 'typed up']],
    [/\bread\b/gi, ['went through', 'looked over', 'got through', 'checked out']],
    [/\bcalled\b/gi, ['phoned', 'gave a call to', 'rang up', 'reached out to']],
    [/\basked\b/gi, ['checked with', 'wondered out loud to', 'reached out to', 'put the question to']],
    [/\bcooked\b/gi, ['made', 'whipped up', 'prepared', 'threw together']],
    [/\bspent\b/gi, ['put in', 'used up', 'set aside', 'devoted']],
    [/\bworked on\b/gi, ['put time into', 'focused on', 'spent time on', 'worked away at']],
    [/\btraveled\b/gi, ['went', 'took a trip', 'traveled around', 'made a trip']],
    [/\barrived\b/gi, ['got in', 'showed up', 'landed', 'made it there']],
    [/\bstayed\b/gi, ['remained', 'hung around', 'stuck around', 'kept staying']],
    [/\bhappy\b/gi, ['glad', 'pleased', 'delighted', 'thrilled']],
    [/\bsad\b/gi, ['upset', 'down', 'unhappy', 'blue']],
    [/\bgood\b/gi, ['great', 'nice', 'solid', 'decent']],
    [/\bbad\b/gi, ['not great', 'poor', 'rough', 'unpleasant']],
    [/\bnice\b/gi, ['great', 'lovely', 'pleasant', 'wonderful']],
    [/\bgreat\b/gi, ['awesome', 'fantastic', 'wonderful', 'excellent']],
    [/\binteresting\b/gi, ['fascinating', 'intriguing', 'engaging', 'compelling']],
    [/\bboring\b/gi, ['dull', 'tedious', 'not very interesting', 'a bit flat']],
    [/\bdifficult\b/gi, ['hard', 'challenging', 'tough', 'tricky']],
    [/\beasy\b/gi, ['simple', 'straightforward', 'not hard', 'a breeze']],
    [/\bimportant\b/gi, ['essential', 'crucial', 'key', 'significant']],
    [/\bexcited\b/gi, ['thrilled', 'pumped', 'stoked', 'really looking forward to it']],
    [/\bproud\b/gi, ['pleased with myself', 'satisfied', 'delighted', 'accomplished']],
    [/\btired\b/gi, ['exhausted', 'worn out', 'sleepy', 'beat']],
    [/\bbusy\b/gi, ['swamped', 'tied up', 'occupied', 'slammed']],
    [/\bcomfortable\b/gi, ['cozy', 'relaxed', 'at ease', 'comfy']],
    [/\bbeautiful\b/gi, ['gorgeous', 'lovely', 'stunning', 'pretty']],
    [/\bexpensive\b/gi, ['pricey', 'costly', 'a bit much', 'overpriced']],
    [/\bcheap\b/gi, ['affordable', 'inexpensive', 'budget-friendly', 'a good deal']],
    [/\bfast\b/gi, ['quick', 'speedy', 'rapid', 'swift']],
    [/\bslow\b/gi, ['sluggish', 'unhurried', 'gradual', 'leisurely']],
    [/\bdelicious\b/gi, ['tasty', 'yummy', 'amazing', 'mouthwatering']],
    [/\bfun\b/gi, ['enjoyable', 'entertaining', 'a good time', 'a blast']],
    [/\bscary\b/gi, ['frightening', 'creepy', 'terrifying', 'spooky']],
    [/\bangry\b/gi, ['mad', 'annoyed', 'frustrated', 'upset']],
    [/\bworried\b/gi, ['concerned', 'anxious', 'nervous', 'uneasy']],
    [/\bnervous\b/gi, ['anxious', 'on edge', 'a little worried', 'jittery']],
    [/\bconfident\b/gi, ['sure of myself', 'self-assured', 'certain', 'assured']],
    [/\bconfused\b/gi, ['puzzled', 'lost', 'mixed up', 'unsure']],
    [/\bfamily\b/gi, ['family members', 'loved ones', 'relatives', 'folks']],
    [/\bfriends\b/gi, ['buddies', 'close friends', 'pals', 'people I know']],
  ];

  function toTitleCaseFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function generateSimilarExpressions(sentence) {
    const base = (sentence || '').trim();
    if (!base) return [];

    const matches = [];
    PARAPHRASE_DICT.forEach(([re, alts]) => {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
      const globalRe = new RegExp(re.source, flags);
      let m;
      while ((m = globalRe.exec(base)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        const overlaps = matches.some(mm => start < mm.end && end > mm.start);
        if (!overlaps) matches.push({ start, end, text: m[0], alts });
        if (globalRe.lastIndex === m.index) globalRe.lastIndex++;
      }
    });
    matches.sort((a, b) => a.start - b.start);

    const rawVariants = [];
    if (matches.length) {
      for (let i = 0; i < 4; i++) {
        let out = '';
        let cursor = 0;
        matches.forEach(mm => {
          out += base.slice(cursor, mm.start);
          const alt = mm.alts[i % mm.alts.length];
          const isCapitalized = mm.text.charAt(0) === mm.text.charAt(0).toUpperCase() && mm.text.charAt(0) !== mm.text.charAt(0).toLowerCase();
          out += isCapitalized ? toTitleCaseFirst(alt) : alt;
          cursor = mm.end;
        });
        out += base.slice(cursor);
        rawVariants.push({ text: out, changed: true });
      }
    }

    const starters = ['Actually, ', 'Honestly, ', 'You know, ', 'To be honest, '];
    const lowerBase = base.charAt(0).toLowerCase() + base.slice(1);
    const seen = new Set();
    const result = [];
    for (let i = 0; i < 4; i++) {
      const v = rawVariants[i];
      let text = (v && !seen.has(v.text)) ? v.text : (starters[i] + lowerBase);
      if (!seen.has(text)) { seen.add(text); result.push(text); }
    }
    let si = 0;
    while (result.length < 4 && si < starters.length) {
      const candidate = starters[si] + lowerBase;
      if (!seen.has(candidate)) { seen.add(candidate); result.push(candidate); }
      si++;
    }
    return result.slice(0, 4);
  }

  /* ===================== 비슷한 표현 4개 — AI 우선, 실패시 사전 기반 대체 ===================== */
  const AI_CACHE_KEY = 'bek_ai_paraphrase_cache_v2';
  const AI_ENDPOINT = '/api/similar-expressions';
  const AI_TIMEOUT_MS = 12000;

  function loadAICache() {
    try {
      const raw = localStorage.getItem(AI_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function saveAICacheEntry(sentence, variants) {
    try {
      const cache = loadAICache();
      cache[sentence] = variants;
      const keys = Object.keys(cache);
      if (keys.length > 300) delete cache[keys[0]];
      localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* localStorage 사용 불가 환경이면 그냥 캐싱을 건너뜁니다 */ }
  }
  function getCachedAIVariants(sentence) {
    const v = loadAICache()[sentence];
    return (Array.isArray(v) && v.length === 4) ? v : null;
  }

  async function fetchAIParaphrases(sentence) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data.variants) && data.variants.length === 4) return data.variants;
    } catch (e) {
      console.warn('[shadowing] AI 비슷한 표현 생성 실패 — 사전 기반으로 대체합니다.', e);
    }
    return null;
  }

  function buildVariantBlock(sentenceText) {
    const dictVariants = generateSimilarExpressions(sentenceText);
    const cached = getCachedAIVariants(sentenceText);
    const initialVariants = cached || dictVariants;
    const initialIsAI = !!cached;
    if (!initialVariants.length) return null;

    const variantWrap = document.createElement('details');
    variantWrap.className = 'variant-details';
    variantWrap.open = false;

    const summary = document.createElement('summary');
    variantWrap.appendChild(summary);

    const body = document.createElement('div');
    variantWrap.appendChild(body);

    function paint(variants, isAI) {
      summary.textContent = `🗣️ 비슷한 표현 ${variants.length}개로 더 연습하기${isAI ? ' (AI)' : ''}`;
      body.innerHTML = '';
      variants.forEach(vText => {
        const vEl = document.createElement('div');
        vEl.className = 'item variant-item';
        const vLine = document.createElement('div');
        vLine.className = 'o-line';
        vLine.textContent = `➜ ${vText}`;
        vEl.appendChild(vLine);
        vEl.appendChild(buildShadowingControls(vText));
        body.appendChild(vEl);
      });
    }

    paint(initialVariants, initialIsAI);

    if (!cached) {
      fetchAIParaphrases(sentenceText).then(aiVariants => {
        if (!aiVariants) return;
        saveAICacheEntry(sentenceText, aiVariants);
        if (!variantWrap.isConnected) return;
        paint(aiVariants, true);
      });
    }

    return variantWrap;
  }

  /* ===================== 전체 요약 텍스트 (복사용) ===================== */
  // 회차의 문장(교정 전/후 + 문법 해석)과 단어를 사람이 읽기 좋은 텍스트로 모아줍니다.
  function buildSummaryText(sentences, words) {
    const lines = [];
    if (sentences && sentences.length) {
      lines.push('=== 문장 ===');
      sentences.forEach((item, idx) => {
        const x = stripLeadingLabel(item.x);
        const o = stripLeadingLabel(item.o);
        lines.push('');
        lines.push(`[${idx + 1}]`);
        if (x) lines.push(`교정 전: ${x}`);
        lines.push(`교정 후: ${o}`);
        if (x) lines.push(`문법 해석: ${explainDifference(x, o)}`);
      });
    }
    if (words && words.length) {
      lines.push('');
      lines.push('=== 단어 ===');
      words.forEach(w => lines.push(stripLeadingLabel(w)));
    }
    return lines.length ? lines.join('\n') : '아직 등록된 내용이 없어요.';
  }

  /* ===================== 연습 화면 전체 렌더링 (문장 카드 + 단어 카드 + 요약) =====================
     member.html(회원 연습 화면)과 admin.html(관리자 미리보기)이 똑같은 화면을 그릴 수 있도록
     공용화했습니다. container 안의 내용을 지우고 다시 그립니다. */
  function renderPracticeSet(container, set) {
    container.innerHTML = '';
    const sentences = (set && set.sentences) || [];
    const words = (set && set.words) || [];

    if (sentences.length) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h2>① 문장 쉐도잉</h2><div class="card-desc">각 문장을 듣고, 마이크로 따라 말해보세요.</div>`;
      const list = document.createElement('div');
      list.className = 'list';
      sentences.forEach(item => {
        const x = stripLeadingLabel(item.x);
        const o = stripLeadingLabel(item.o);
        const explanation = x ? explainDifference(x, o) : '';
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = `
          <div class="item-top">
            <div style="flex:1;">
              ${x && !item.hideX ? `<div class="x-line">✗ ${escapeHTML(x)}</div>` : ''}
              <div class="o-line">✓ ${escapeHTML(o)}</div>
              <div class="kr-meaning">🇰🇷 뜻: <span class="kr-text">번역 중...</span></div>
              ${explanation ? `<div class="explain-block">🔎 <b>왜 틀렸을까요?</b> ${escapeHTML(explanation)}</div>` : ''}
            </div>
          </div>
        `;
        loadTranslationInto(el.querySelector('.kr-meaning .kr-text'), o);
        el.appendChild(buildShadowingControls(o));
        const variantBlock = buildVariantBlock(o);
        if (variantBlock) el.appendChild(variantBlock);
        list.appendChild(el);
      });
      card.appendChild(list);
      container.appendChild(card);
    }

    if (words.length) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h2>② 단어 발음 연습</h2><div class="card-desc">단어를 듣고, 마이크로 따라 말해보세요.</div>`;
      const list = document.createElement('div');
      list.className = 'list';
      words.forEach(rawWord => {
        const w = stripLeadingLabel(rawWord);
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = `
          <div class="item-top">
            <div style="flex:1;">
              <div class="word-line">${escapeHTML(w)}</div>
              <div class="kr-meaning">🇰🇷 뜻: <span class="kr-text">번역 중...</span></div>
            </div>
          </div>
        `;
        loadTranslationInto(el.querySelector('.kr-meaning .kr-text'), w);
        el.appendChild(buildShadowingControls(w));
        list.appendChild(el);
      });
      card.appendChild(list);
      container.appendChild(card);
    }

    if (!sentences.length && !words.length) {
      container.innerHTML = '<div class="empty">이 회차에는 아직 등록된 문장/단어가 없어요.</div>';
      return;
    }

    const summaryCard = document.createElement('div');
    summaryCard.className = 'card';
    summaryCard.innerHTML = `
      <h2>📋 전체 요약 (복사용)</h2>
      <div class="card-desc">이 회차의 문장 교정 전/후·문법 해석과 단어를 한 번에 모아서 볼 수 있어요. 아래 내용을 복사해서 노트나 문서에 붙여넣을 수 있습니다.</div>
      <textarea readonly class="summary-area" style="min-height:240px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:0.82rem; white-space:pre-wrap; width:100%; resize:vertical; background:var(--input-bg); border:1px solid var(--border); border-radius:10px; color:var(--text); padding:10px 12px; box-sizing:border-box;"></textarea>
      <div class="row">
        <button class="btn-primary btn-small copy-summary-btn">📋 전체 복사하기</button>
      </div>
      <div class="copy-status" style="font-size:0.82rem; color:var(--muted); margin-top:8px;"></div>
    `;
    const summaryArea = summaryCard.querySelector('.summary-area');
    summaryArea.value = buildSummaryText(sentences, words);
    const copyStatus = summaryCard.querySelector('.copy-status');
    summaryCard.querySelector('.copy-summary-btn').addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(summaryArea.value);
        } else {
          summaryArea.select();
          document.execCommand('copy');
        }
        copyStatus.textContent = '✅ 복사했어요! 원하는 곳에 붙여넣기(Ctrl+V / Cmd+V) 하세요.';
      } catch (err) {
        summaryArea.select();
        copyStatus.textContent = '⚠️ 자동 복사에 실패했어요. 위 텍스트 상자가 선택되어 있으니 Ctrl+C / Cmd+C로 직접 복사해주세요.';
      }
    });
    container.appendChild(summaryCard);
  }

  global.ShadowingEngine = {
    VERSION: ENGINE_VERSION,
    escapeHTML,
    translateText,
    loadTranslationInto,
    hasTTS,
    hasSTT,
    isMobileDevice,
    isSecureContextForMic,
    compareWords,
    buildShadowingControls,
    explainDifference,
    generateSimilarExpressions,
    buildVariantBlock,
    parseFeedbackBlock,
    parseWordsBlock,
    stripLeadingLabel,
    buildSummaryText,
    renderPracticeSet,
  };
})(window);
