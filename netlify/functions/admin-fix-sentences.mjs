// 영상 쉐도잉 — ✨ 틀린 문장 AI로 고치기 (관리자 토큰 필요)
// 자막(특히 YouTube 자동 자막)에서 잘못 들린 단어 · 이름 · 문장부호를 고치고, 여러 문장이 붙은 긴 줄은 나눠요.
//   POST /api/admin-fix-sentences { sentences:["…", …(최대 40)], title, first }
//     → { lines:[["고친 문장", "나눈 문장"…], …](들어온 순서·개수 그대로), intro: 맨 앞에서 제목만 읽어 주는 줄 수(first일 때만) }
// 브라우저(js/video-admin.js)가 원래 문장과 너무 달라진 줄은 버리고 원래 문장을 써요.
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { groqChat, tokensEn } from './_lib/groq.mjs';

const MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];

function parseAnswer(content, n) {
  const m = String(content).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let d; try { d = JSON.parse(m[0]); } catch (e) { return null; }
  const lines = Array.isArray(d.lines) ? d.lines : null;
  if (!lines || lines.length !== n) return null;
  const out = lines.map(x => (Array.isArray(x) ? x : [x]).map(t => String(t == null ? '' : t).trim()).filter(Boolean).slice(0, 6));
  return { lines: out, intro: Math.max(0, Math.min(3, Number(d.intro) || 0)) };
}

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);
  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const sentences = (Array.isArray(body && body.sentences) ? body.sentences : []).slice(0, 40).map(s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 600));
  if (!sentences.length) return jsonResponse({ lines: [], intro: 0 });
  const title = String((body && body.title) || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const first = !!(body && body.first);

  const prompt = [
    'You fix English subtitle lines from a video (automatic captions often mis-hear words). Students will shadow these lines while listening to the audio, so the words must match what is actually SAID.',
    title ? `Video title (context, and correct spelling of names): "${title}"` : '',
    'For each numbered line:',
    '- Fix words that were obviously mis-heard (wrong word that sounds similar, misspelled names from the title), fix punctuation and capitalization.',
    '- If a line contains two or more complete sentences, split it into separate sentences.',
    '- Do NOT add words that were not said, do NOT remove spoken words, do NOT paraphrase or reorder. When unsure, keep the line as it is.',
    first ? '- These are the first lines of the video. Count how many of the very first lines only read out the title / episode name (an intro that is not part of the story); put that count (0-3) in "intro".' : '',
    `Answer ONLY with JSON: {"lines": [[...pieces of line 1], [...pieces of line 2], ...]${first ? ', "intro": 0' : ''}} — exactly ${sentences.length} items, in the same order. Each item is an array of one or more sentences.`,
    '',
    ...sentences.map((s, i) => `${i + 1}. ${s}`),
  ].filter(Boolean).join('\n');

  const r = await groqChat({
    apiKey, models: MODELS, prompt, temperature: 0,
    outTokens: Math.ceil(tokensEn(sentences.join(' ')) * 1.4) + sentences.length * 6 + 30,
    accept: c => parseAnswer(c, sentences.length),
  });
  if (r.ok) return jsonResponse({ ...r.value, model: r.model });
  if (r.rateLimited) return jsonResponse({ error: 'rate_limited', retryAfter: r.retryAfter }, 429);
  return jsonResponse({ error: 'failed' }, 502);
};

export const config = { path: '/api/admin-fix-sentences' };
