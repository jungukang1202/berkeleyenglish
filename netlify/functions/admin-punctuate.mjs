// 영상 쉐도잉 — 문장부호 복원 (관리자 토큰 필요)
// YouTube 자동 자막에는 마침표가 없어서 "문장이 어디서 끝나는지" 알 수 없어요.
// 단어 목록을 Groq AI(similar-expressions와 같은 GROQ_API_KEY·모델)에 보내 마침표·쉼표·대문자만 붙여 받습니다.
//   POST /api/admin-punctuate  { text: "so today i want to talk about ..." }  →  { text: "So today I want to talk about ..." }
// 브라우저가 돌려받은 글을 원래 단어(시간 정보)와 하나씩 맞춰 보고, 단어가 바뀐 곳은 버립니다.
import { requireAuth, jsonResponse } from './_lib/auth.mjs';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b';
const MAX_CHARS = 4000;
const TIMEOUT_MS = 40000;

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);

  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const text = String((body && body.text) || '').replace(/\s+/g, ' ').trim();
  if (!text) return jsonResponse({ error: 'empty' }, 400);
  if (text.length > MAX_CHARS) return jsonResponse({ error: 'too_long' }, 413);

  const prompt = [
    'Restore punctuation and capitalization in this English speech transcript (it may be from a cartoon, lecture or conversation).',
    'Rules:',
    '- Add periods, question marks, exclamation marks, commas and apostrophes where a native speaker would.',
    '- Capitalize the first word of each sentence, "I", and names.',
    '- Do NOT add, remove, reorder, or change any words. Keep every word in the same order.',
    '- Put each sentence on its own line.',
    '- Output only the punctuated transcript, nothing else.',
    '',
    'Transcript:',
    text,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 4096, // 추론 모델이라 답변 전 생각에도 토큰을 씁니다 — 넉넉하게
        reasoning_effort: 'low',
      }),
      signal: controller.signal,
    });
    if (r.status === 429) return jsonResponse({ error: 'rate_limited', retryAfter: Number(r.headers.get('retry-after')) || 10 }, 429);
    if (!r.ok) return jsonResponse({ error: 'groq_http_' + r.status }, 502);
    const data = await r.json();
    const out = (((data.choices || [])[0] || {}).message || {}).content || '';
    if (!out.trim()) return jsonResponse({ error: 'empty_answer' }, 502);
    return jsonResponse({ text: out.trim() });
  } catch (e) {
    return jsonResponse({ error: e && e.name === 'AbortError' ? 'timeout' : 'failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
};

export const config = { path: '/api/admin-punctuate' };
