// 영상 쉐도잉 자동 생성용 받아쓰기 — 관리자 토큰 필요.
// 관리자 브라우저가 영상에서 소리만 뽑아(16kHz 모노 WAV, 약 100초씩) POST /api/admin-transcribe 로 보내면
// Groq Whisper로 받아써서 단어별 시간까지 돌려줍니다. (stt.mjs와 같은 GROQ_API_KEY 사용)
//   응답: { segments:[{s,e,text}], words:[{w,s,e}] }   시간은 보낸 조각의 시작 기준(초)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';

const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_STT_MODEL = 'whisper-large-v3-turbo';
const MAX_BYTES = 4.4 * 1024 * 1024;
const TIMEOUT_MS = 50000;

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);

  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return jsonResponse({ error: 'empty audio' }, 400);
  if (buf.byteLength > MAX_BYTES) return jsonResponse({ error: 'audio too large' }, 413);
  const prompt = (new URL(req.url).searchParams.get('prompt') || '').slice(0, 400);

  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', GROQ_STT_MODEL);
  form.append('language', 'en');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', prompt); // 앞 조각의 끝 문장 → 문맥이 이어지게

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(GROQ_STT_ENDPOINT, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal,
    });
    if (r.status === 429) {
      // 무료 사용량 한도(분당 요청 수) — 브라우저가 잠시 기다렸다 다시 보냅니다.
      const wait = Number(r.headers.get('retry-after')) || 20;
      return jsonResponse({ error: 'rate_limited', retryAfter: wait }, 429);
    }
    if (!r.ok) {
      let detail = ''; try { detail = (await r.text()).slice(0, 300); } catch (e) {}
      return jsonResponse({ error: 'groq stt error ' + r.status, detail }, 502);
    }
    const data = await r.json();
    const round = x => Math.round(Number(x || 0) * 100) / 100;
    const segments = (Array.isArray(data.segments) ? data.segments : [])
      // 음악·무음 구간에서 지어낸 문장("Thank you." 등) 버리기
      .filter(s => !(s.no_speech_prob > 0.6 && (s.avg_logprob ?? 0) < -0.6))
      .map(s => ({ s: round(s.start), e: round(s.end), text: String(s.text || '').trim() }))
      .filter(s => s.text);
    const words = (Array.isArray(data.words) ? data.words : [])
      .map(w => ({ w: String(w.word || '').trim(), s: round(w.start), e: round(w.end) }))
      .filter(w => w.w);
    return jsonResponse({ segments, words });
  } catch (e) {
    return jsonResponse({ error: e && e.name === 'AbortError' ? 'groq stt timeout' : 'groq stt failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
};

export const config = { path: '/api/admin-transcribe' };
