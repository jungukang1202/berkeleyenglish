// netlify/functions/stt.mjs
//
// 쉐도잉 연습장의 "서버 받아쓰기" 대체 기능용 서버리스 함수입니다.
// 태블릿에 USB(충전 단자) 이어폰을 꽂으면 Chrome 내장 음성 인식이 이어폰 마이크를 못 써서
// no-speech만 나오는 경우가 있어요. 그럴 때 브라우저가 직접 녹음한 음성 파일을
// POST /api/stt 로 보내면, 여기서 Groq의 Whisper 음성 인식으로 받아써서 { text } 를 돌려줍니다.
// API 키는 similar-expressions 함수와 같은 Netlify 환경변수 GROQ_API_KEY 를 사용합니다.

const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_STT_MODEL = 'whisper-large-v3-turbo';
const MAX_BYTES = 4 * 1024 * 1024; // 4MB (약 1분 이상 분량이라 문장 하나에는 충분)
const TIMEOUT_MS = 15000;
const NO_SPEECH_PROB = 0.6;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return json({ error: 'GROQ_API_KEY not configured' }, 500);

  const contentType = (req.headers.get('content-type') || 'audio/webm').split(';')[0].trim();
  if (!contentType.startsWith('audio/') && contentType !== 'video/webm' && contentType !== 'video/mp4') {
    return json({ error: 'unsupported content type' }, 400);
  }
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return json({ error: 'empty audio' }, 400);
  if (buf.byteLength > MAX_BYTES) return json({ error: 'audio too large' }, 413);

  const ext = contentType.includes('mp4') || contentType.includes('m4a') ? 'mp4'
    : contentType.includes('ogg') ? 'ogg'
    : contentType.includes('wav') ? 'wav'
    : 'webm';

  const form = new FormData();
  form.append('file', new Blob([buf], { type: contentType }), `speech.${ext}`);
  form.append('model', GROQ_STT_MODEL);
  form.append('language', 'en');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(GROQ_STT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!r.ok) return json({ error: 'groq stt error ' + r.status }, 502);
    const data = await r.json();
    // Whisper는 아무 말도 없는 녹음에서 "Thank you." 같은 문장을 지어내는 경우가 있어서,
    // "말소리가 없을 확률"이 높은 구간은 버립니다.
    const segs = Array.isArray(data.segments) ? data.segments : null;
    const text = segs
      ? segs.filter(s => !(typeof s.no_speech_prob === 'number' && s.no_speech_prob > NO_SPEECH_PROB))
            .map(s => s.text).join(' ')
      : (data.text || '');
    return json({
      text: text.replace(/\s+/g, ' ').trim(),
      // 진단용(?debug=1): 걸러내기 전 원문과 구간별 "말소리 없음 확률"
      raw: (data.text || '').trim(),
      noSpeechProb: segs ? segs.map(s => Math.round((s.no_speech_prob || 0) * 100) / 100) : null,
    });
  } catch (e) {
    return json({ error: e && e.name === 'AbortError' ? 'groq stt timeout' : 'groq stt failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

// 이 사이트는 netlify.toml에 /api/* 연결 설정이 없어서, 함수마다 주소를 직접 지정합니다.
export const config = { path: '/api/stt' };
