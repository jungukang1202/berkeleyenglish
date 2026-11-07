// 🎥 수업영상 쉐도잉 — 받아쓴 수업 대화를 말하는 사람(선생님·학생)마다, 문장마다 나눕니다. 관리자 전용. (js/nvoim-video.js가 사용)
// POST /api/admin-lesson-turns { words:[단어...], pauses:[이 단어 뒤 쉰 초...], title }
//   → { items:[{ sp:'T'|'S', from, to, text }] }   from·to = 단어 번호(이어진 범위), text = 고친 문장
// 선생님과 학생이 번갈아 말하는 줄을 한 문장으로 붙이지 않아요. 잘못 들린 단어는 고치되 말한 내용은 바꾸지 않아요.
// 모양이 이상한 답은 화면(js/nvoim-video.js)이 버리고 쉬는 곳에서 나눠요.
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { chat, groqErrorResponse, GroqError } from './_lib/groq.mjs';

const SYSTEM = `You get the automatic speech-recognition transcript of a recorded online English lesson (a video call) between a TEACHER and a STUDENT who take turns speaking. It will be used in a shadowing app where the learner repeats each line exactly as heard.
Input: numbered words "i:word". A mark like [1.2s] after a word means 1.2 seconds of silence after it.
Split the transcript into shadowing lines:
- Each line is a contiguous range of word numbers "from".."to". Lines are in order and do not overlap. Every word belongs to exactly one line (you may leave out only pure filler like "um", "uh").
- A new line MUST start wherever the speaker changes (teacher <-> student). NEVER put words of two different speakers in one line, even a short answer like "Yes." or "Okay." Speaker changes usually come at a pause, after a question, at an answer, a repeat-after-me, or a correction.
- Also start a new line at the end of every sentence: after every . ? or ! the next sentence goes to the next line. One line = exactly one sentence of one speaker. Do not end a line in the middle of a sentence (e.g. "I ate some bananas for" + "breakfast." must stay one line).
- "sp" is "T" for the teacher or "S" for the student (the teacher asks questions, explains, corrects; the student answers, often in simpler English).
- "text" is that line written as a correct English sentence containing EVERY word of its range: fix words the recognizer misheard by REPLACING them with what was really said (use the conversation as context), add capitalization and punctuation (. , ? ! only). Do NOT drop any word, do NOT add words, paraphrase, summarize, reorder or translate. Keep non-English words as they are.
- Parts spoken in KOREAN (Korean letters 한글, or romanized Korean like "ne", "geuraeseo", "aniyo", "mwo") must be their own lines with "sp":"K" — never mix Korean speech into an English line.
Return JSON {"items":[{"sp":"T","from":0,"to":7,"text":"..."}, ...]}.`;

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const words = (Array.isArray(body && body.words) ? body.words : []).slice(0, 400).map(x => String(x || '').slice(0, 60));
  if (!words.length) return jsonResponse({ items: [] });
  const pauses = Array.isArray(body.pauses) ? body.pauses : [];
  const title = String(body.title || '').slice(0, 200);
  const text = words.map((w, i) => `${i}:${w}` + (Number(pauses[i]) >= 0.3 ? ` [${Number(pauses[i]).toFixed(1)}s]` : '')).join(' ');

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: (title ? `Lesson: ${title}\n` : '') + text },
  ];
  try {
    // 더 똑똑한 AI(가장 큰 모델이 깊게 생각하기)로 먼저 — 시간이 너무 걸리면 빠른 설정으로 한 번 더(운영자 지시 2026-11-03)
    let out;
    try { out = await chat(messages, { json: true, effort: 'high', timeoutMs: 16000, models: ['openai/gpt-oss-120b'] }); }
    catch (e) { if (e instanceof GroqError && e.status === 429) throw e; out = await chat(messages, { json: true, timeoutMs: 8000 }); }
    let items = [];
    try { items = JSON.parse(out).items; } catch (e) {}
    if (!Array.isArray(items)) items = [];
    items = items
      .map(x => ({ sp: x && (x.sp === 'S' || x.sp === 'K') ? x.sp : 'T', from: Math.round(Number(x && x.from)), to: Math.round(Number(x && x.to)), text: String((x && x.text) || '').trim().slice(0, 800) }))
      .filter(x => Number.isFinite(x.from) && Number.isFinite(x.to) && x.from >= 0 && x.to >= x.from && x.to < words.length);
    return jsonResponse({ items });
  } catch (e) {
    return groqErrorResponse(e, jsonResponse);
  }
};

export const config = { path: '/api/admin-lesson-turns' };
