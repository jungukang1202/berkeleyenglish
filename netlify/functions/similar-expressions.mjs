// Netlify Function (v2, ESM) — 브라우저에서는 API 키를 볼 수 없고, 이 함수 안에서만
// Groq API 키(환경변수 GROQ_API_KEY)를 사용합니다. 방문자는 로그인/가입이 전혀 필요 없습니다.
//
// 클라이언트에서 이렇게 호출합니다:
//   POST /api/similar-expressions   body: { "sentence": "Where can I buy a ticket?" }
//   -> 200 { "variants": ["...", "...", "...", "..."] }
//   -> 4xx/5xx { "error": "..." }  (클라이언트는 이 경우 사전 기반 대체 표현을 그대로 씁니다)

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b';
const MAX_SENTENCE_LEN = 300;

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const sentence = String(body && body.sentence || '').trim().slice(0, MAX_SENTENCE_LEN);
  if (!sentence) {
    return jsonResponse({ error: 'sentence_required' }, 400);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // 환경변수가 아직 설정 안 된 상태 — 클라이언트가 사전 기반으로 조용히 대체합니다.
    return jsonResponse({ error: 'not_configured' }, 500);
  }

  const prompt = `Rewrite this English sentence in 4 different natural, everyday ways that keep the exact same meaning, tense, and subject. Each of the 4 rewrites must use noticeably different wording from the original sentence and from each other — do not just repeat the original. Keep each rewrite about the same length as the original. Return ONLY a raw JSON array of exactly 4 strings — no markdown, no code fences, no explanation.

Sentence: "${sentence}"`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1024, // gpt-oss는 추론 모델이라 답변 전에 내부적으로 생각(reasoning)을 소모합니다 —
                           // 너무 낮게 잡으면 추론만 하다 끝나서 실제 답변(content)이 비어버립니다.
        reasoning_effort: 'low', // 굳이 깊게 추론할 필요 없는 단순 패러프레이즈 작업이라 낮게 설정
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) {
      return jsonResponse({ error: `groq_http_${r.status}` }, 502);
    }

    const data = await r.json();
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(match ? match[0] : cleaned);

    if (!Array.isArray(arr) || arr.length < 4) {
      return jsonResponse({ error: 'bad_ai_shape' }, 502);
    }
    const variants = arr.slice(0, 4).map((s) => String(s).trim()).filter(Boolean);
    if (variants.length !== 4) {
      return jsonResponse({ error: 'bad_ai_count' }, 502);
    }

    return jsonResponse({ variants }, 200);
  } catch (e) {
    return jsonResponse({ error: 'ai_failed' }, 502);
  }
};

export const config = { path: '/api/similar-expressions' };
