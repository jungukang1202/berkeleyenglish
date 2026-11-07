// Groq AI 호출 도우미 (문장부호 복원 · 번역 공용)
//
// 왜 필요했나: Groq 무료 한도는 "분당 토큰 수(TPM)"로 막는데, 요청할 때 적은 max_tokens까지 미리 계산에 넣어요.
// 예전에는 max_tokens를 6000~8000으로 크게 잡아서, 요청 하나가 1분 한도(약 8000)를 거의 다 써 버렸고
// → 1분에 한 번만 성공하고 나머지는 429(한도 초과)로 거절됐어요. 그러면 문장부호를 못 붙여 자막 줄 그대로 잘렸어요.
//
// 이제는
//   ① 글 길이에 맞춰 max_tokens를 필요한 만큼만 잡고
//   ② 한 모델이 한도에 걸리면 한도가 따로인 다음 모델로 바로 넘어가고
//   ③ 모두 막혔을 때만 "몇 초 뒤 다시"(retryAfter)를 알려줘요.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const isReasoning = m => /gpt-oss/.test(m); // 답하기 전에 '생각'에도 토큰을 쓰는 모델

function retryAfterOf(r, bodyText) {
  const h = Number(r.headers.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return h;
  const m = String(bodyText || '').match(/try again in\s+(?:(\d+)m)?([\d.]+)s/i);
  if (m) return Number(m[1] || 0) * 60 + Number(m[2]);
  return 10;
}

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {string[]} o.models         시도할 순서
 * @param {string} o.prompt
 * @param {number} o.outTokens        답 글자에 필요한 토큰 어림값
 * @param {number} [o.temperature]
 * @param {number} [o.timeoutMs]      모델 하나당
 * @param {(content:string)=>any} o.accept  쓸 만한 답이면 결과값, 아니면 null
 * @returns {Promise<{ok:true, value:any, model:string} | {ok:false, rateLimited:boolean, retryAfter:number}>}
 */
export async function groqChat({ apiKey, models, prompt, outTokens, temperature = 0, timeoutMs = 20000, accept, deadlineMs = 24000, effort = 'low' }) {
  const started = Date.now();
  let limited = false, wait = Infinity;
  for (const model of models) {
    const left = deadlineMs - (Date.now() - started);
    if (left < 4000) break; // 함수 시간 제한 안에서 끝내기
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, left - 1000));
    try {
      const body = {
        model, temperature,
        messages: [{ role: 'user', content: prompt }],
        // 답에 필요한 만큼만 (+ 생각하는 모델은 생각할 몫을 조금 더)
        max_tokens: Math.min(8000, Math.ceil(outTokens * 1.25) + (isReasoning(model) ? (effort === 'medium' ? 2500 : 900) : 150)),
      };
      if (isReasoning(model)) body.reasoning_effort = effort;
      const r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (r.status === 429) { // 이 모델은 한도 초과 → 한도가 따로인 다음 모델로
        const t = await r.text().catch(() => '');
        limited = true; wait = Math.min(wait, retryAfterOf(r, t));
        console.log(`[groq] 429 ${model} retry=${retryAfterOf(r, t)}s`);
        continue;
      }
      if (!r.ok) { console.log(`[groq] ${r.status} ${model}`); continue; } // 없는 모델 등 → 다음 모델
      const data = await r.json();
      const content = (((data.choices || [])[0] || {}).message || {}).content || '';
      const value = content.trim() ? accept(content.trim()) : null;
      if (value != null) return { ok: true, value, model };
      console.log(`[groq] unusable answer ${model}`);
    } catch (e) {
      console.log(`[groq] ${e.name === 'AbortError' ? 'timeout' : 'error'} ${model}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, rateLimited: limited, retryAfter: Number.isFinite(wait) ? Math.ceil(wait) : 10 };
}

// 대략적인 토큰 수 (영어 ≈ 4글자/토큰, 한글 ≈ 1.5글자/토큰)
export const tokensEn = text => Math.ceil(String(text || '').length / 4);
export const tokensKo = text => Math.ceil(String(text || '').length / 1.5);

// ---------------------------------------------------------------------------
// 아래는 영클 사이트와 같은 공용 함수 (수업영상 받아쓰기 · 문장 나누기 · 틀린 문장 고치기에서 써요)
// chat()은 한 모델이 한도(429)에 걸려도 다음 모델로 넘어가요 (버클리 groqChat과 같은 방식).
const CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const STT = 'https://api.groq.com/openai/v1/audio/transcriptions';
// 대화 모델: 앞에서부터 써 보고, Groq에서 없어진 모델(404)이나 못 쓰는 모델(400)이면 다음 모델로 넘어가요.
//   (예전 llama-3.3-70b-versatile이 없어져서 문장부호·번역·고치기가 모두 멈췄던 일이 있었어요)
export const CHAT_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
export const CHAT_MODEL = CHAT_MODELS[0];
let workingModel = 0; // 한 번 되는 모델을 찾으면 다음 요청부터 그 모델부터 써요
export const STT_MODEL = 'whisper-large-v3-turbo';

export class GroqError extends Error {
  constructor(status, retryAfter) { super('groq HTTP ' + status); this.status = status; this.retryAfter = retryAfter; }
}

function key() {
  const k = process.env.GROQ_API_KEY;
  if (!k) throw new GroqError(500);
  return k;
}

async function call(url, init, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, init));
    if (!r.ok) throw new GroqError(r.status, Number(r.headers.get('retry-after')) || 0);
    return await r.json();
  } finally { clearTimeout(t); }
}

// effort: gpt-oss가 얼마나 깊게 생각할지 — 기본은 빨리('low'), 수업영상 문장 나누기는 더 똑똑하게('high', 운영자 지시 2026-11-03)
export async function chat(messages, { json = false, temperature = 0, timeoutMs = 24000, effort = 'low', models = null } = {}) {
  let lastErr = null;
  const list = models || CHAT_MODELS;
  for (let k = models ? 0 : workingModel; k < list.length; k++) {
    const model = list[k];
    // gpt-oss는 생각하는 모델이라 '짧게 생각하기'로 빨리 답하게 해요
    const extra = /gpt-oss/.test(model) ? { reasoning_effort: effort, max_completion_tokens: effort === 'low' ? 8000 : 20000 } : {};
    try {
      const data = await call(CHAT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
        body: JSON.stringify({ model, messages, temperature, ...extra, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      }, timeoutMs);
      if (!models && !(lastErr && lastErr.status === 429)) workingModel = k; // 잠깐 한도에 걸려 넘어간 건 기억하지 않아요
      return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
    } catch (e) {
      lastErr = e;
      if (!(e instanceof GroqError) || ![400, 404, 413, 429].includes(e.status)) throw e; // 없는 모델 · 한도 초과는 다음 모델로
    }
  }
  throw lastErr;
}

// model: 수업 녹화(/api/admin-lesson-transcribe)는 더 정확한 'whisper-large-v3' — 나머지는 그대로 STT_MODEL
// language: null이면 언어를 정하지 않아요(수업 녹화 — 한국어로 한 말은 한글로 받아써서 쉐도잉에서 빼요)
export async function transcribe(buf, contentType, prompt, model = STT_MODEL, language = 'en') {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: contentType }), 'audio.wav');
  form.append('model', model);
  if (language) form.append('language', language);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', String(prompt).slice(-300));
  return call(STT, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: form }, 25000);
}

// 실패 응답: 사용량 한도(429)면 몇 초 뒤 다시 하라고 알려줘요
export function groqErrorResponse(e, jsonResponse) {
  if (e instanceof GroqError) {
    if (e.status === 500) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);
    if (e.status === 429) return jsonResponse({ error: 'rate_limited', retryAfter: e.retryAfter || 10 }, 429);
    return jsonResponse({ error: e.message }, 502);
  }
  return jsonResponse({ error: e && e.name === 'AbortError' ? 'groq timeout' : 'groq request failed' }, 502);
}
