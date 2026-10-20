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
export async function groqChat({ apiKey, models, prompt, outTokens, temperature = 0, timeoutMs = 20000, accept, deadlineMs = 24000 }) {
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
        max_tokens: Math.min(8000, Math.ceil(outTokens * 1.25) + (isReasoning(model) ? 900 : 150)),
      };
      if (isReasoning(model)) body.reasoning_effort = 'low';
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
