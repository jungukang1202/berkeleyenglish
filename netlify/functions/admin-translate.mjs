// 영상 쉐도잉 — 문장 번역 (관리자 토큰 필요)
// 예전에는 관리자 브라우저가 구글 번역 무료 주소에 문장마다 따로 요청했는데, 문장이 수백 개면 차단(429)되어 번역 칸이 비었어요.
// 이제 서버에서 Groq AI(GROQ_API_KEY)로 30문장씩 묶어 번역합니다. 앞뒤 문맥을 함께 보니 대화체 번역도 자연스러워요.
//   POST /api/admin-translate  { sentences: ["Hi.", "How are you?"], title }  →  { ko: ["안녕.", "어떻게 지내?"] }
//   (번역하지 못한 문장은 "" — 브라우저가 구글 번역으로 한 번 더 시도합니다)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const MAX_ITEMS = 40;
const TIMEOUT_MS = 25000;

function parseList(text, n) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  // 1) JSON 배열
  try {
    const m = t.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : t);
    if (Array.isArray(arr)) return arr.map(x => String(x == null ? '' : x).trim());
  } catch (e) {}
  // 2) "1. ..." 번호 목록
  const out = new Array(n).fill('');
  t.split('\n').forEach(line => {
    const m = line.match(/^\s*(\d+)[.)]\s*(.+)$/);
    if (m && +m[1] >= 1 && +m[1] <= n) out[+m[1] - 1] = m[2].trim();
  });
  return out;
}

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);

  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const list = (Array.isArray(body && body.sentences) ? body.sentences : []).slice(0, MAX_ITEMS).map(x => String(x || '').slice(0, 500));
  if (!list.length) return jsonResponse({ error: 'empty' }, 400);
  const title = String((body && body.title) || '').slice(0, 150);

  const prompt = [
    'Translate each English line into natural, conversational Korean for Korean learners of English.',
    title ? `The lines are consecutive subtitles from the video "${title}". Use the surrounding lines as context (who is speaking, tone).` : 'The lines are consecutive subtitles from one video; use the surrounding lines as context.',
    '- Keep names as they sound in Korean (e.g. Bluey → 블루이, Bingo → 빙고).',
    '- Match the tone: casual speech → 반말/구어체, polite speech → 존댓말.',
    '- Translate every line separately. Do not merge or skip lines.',
    `- Reply ONLY with a JSON array of exactly ${list.length} Korean strings, in the same order.`,
    '',
    JSON.stringify(list),
  ].join('\n');

  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 8000, reasoning_effort: 'low' }),
        signal: controller.signal,
      });
      if (r.status === 429) return jsonResponse({ error: 'rate_limited', retryAfter: Number(r.headers.get('retry-after')) || 10 }, 429);
      if (!r.ok) continue;
      const data = await r.json();
      const content = (((data.choices || [])[0] || {}).message || {}).content || '';
      const arr = parseList(content, list.length);
      if (arr.length !== list.length) continue; // 개수가 안 맞으면 다른 모델로
      const ko = arr.map(x => (/[가-힣]/.test(x) ? x : '')); // 한글이 없는 답은 버림
      if (ko.filter(Boolean).length < list.length * 0.5) continue;
      return jsonResponse({ ko, model });
    } catch (e) {
      // 시간 초과 → 다음 모델
    } finally {
      clearTimeout(timer);
    }
  }
  return jsonResponse({ error: 'failed' }, 502);
};

export const config = { path: '/api/admin-translate' };
