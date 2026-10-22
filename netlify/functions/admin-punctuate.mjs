// 영상 쉐도잉 — 문장부호 복원 (관리자 토큰 필요)
// YouTube 자동 자막에는 마침표가 없어서 "문장이 어디서 끝나는지" 알 수 없어요.
// 단어 목록을 Groq AI(similar-expressions와 같은 GROQ_API_KEY·모델)에 보내 마침표·쉼표·대문자만 붙여 받습니다.
//   POST /api/admin-punctuate  { text: "so today i want to talk about ..." }  →  { text: "So today I want to talk about ..." }
// 브라우저가 돌려받은 글을 원래 단어(시간 정보)와 하나씩 맞춰 보고, 단어가 바뀐 곳은 버립니다.
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { groqChat, tokensEn } from './_lib/groq.mjs';

// 정확한 순서대로 시도 — 모델마다 Groq 사용 한도가 따로라서, 하나가 한도에 걸리면 다음 모델이 받아요
const EFFORT = 'low'; // 생각 정도 (low · medium)
const MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const MAX_CHARS = 4000;

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);

  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const text = String((body && body.text) || '').replace(/\s+/g, ' ').trim();
  const title = String((body && body.title) || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  if (!text) return jsonResponse({ error: 'empty' }, 400);
  if (text.length > MAX_CHARS) return jsonResponse({ error: 'too_long' }, 413);

  const prompt = [
    'Restore sentence boundaries, punctuation and capitalization in this automatic English speech transcript (often a cartoon, show, lecture or conversation with several speakers).',
    title ? `Video title (for context and correct spelling of names): "${title}"` : '',
    'The mark ‖ shows where the audio has a pause of 0.6 seconds or more. A pause is only a HINT: it often comes between sentences, but speakers also pause in the middle of a sentence (for emphasis, drama or hesitation).',
    'Decide sentence ends by GRAMMAR and MEANING first: a sentence ends only where it is complete. Never leave an unfinished phrase as a sentence.',
    'Examples: "I feel ‖ terrible" → "I feel terrible." (one sentence, the pause is for drama) · "I have a really bad ‖ migraine" → "I have a really bad migraine." · "it costs ‖ ten dollars" → "It costs ten dollars." · but "one adult and two kids ‖ okay here you go" → "One adult and two kids. Okay, here you go." (two complete utterances).',
    'The mark » shows that a different person starts speaking — always start a new sentence there.',
    'The text is often a dialogue (e.g. a patient and a receptionist, a waiter and a customer). End the sentence whenever the speaker changes even without a » mark: e.g. someone answering the phone with a greeting or business name ("I have to call my GP. ‖ Easy English Surgery, how can I help?"), or a question to the other person after a statement ("…on my face. And do you know if you have a fever?").',
    'Short separate utterances like "One adult and two kids." or "Okay." are their own sentences.',
    'Interjections and exclamations said on their own (e.g. "Oh no!", "Hooray!", "Wow!", "Oh, biscuits!", or a character\'s catchphrase) are their own sentence ending with "!", unless they are clearly part of the following sentence. Words that address a different person right after an exclamation (e.g. "Dad, is there...") start a new sentence.',
    'Rules:',
    '- Add periods, question marks, exclamation marks, commas and apostrophes where a native speaker would.',
    '- Capitalize the first word of each sentence, "I", and names.',
    '- Keep every word in the same order. Do not add or remove words.',
    '- The only allowed word change: if a word is obviously a mis-heard name from the title (e.g. a character name), replace it with the correct single word.',
    '- Put each sentence on its own line and remove the ‖ marks.',
    '- Output only the punctuated transcript, nothing else.',
    '',
    'Transcript:',
    text,
  ].filter(Boolean).join('\n');

  const r = await groqChat({
    apiKey, models: MODELS, prompt, temperature: 0,
    effort: ['low', 'medium'].includes(body && body.effort) ? body.effort : EFFORT,
    outTokens: Math.ceil(tokensEn(text) * 1.15) + 20, // 문장부호·대문자만 붙인 같은 글
    accept: c => c,
  });
  if (r.ok) return jsonResponse({ text: r.value, model: r.model });
  if (r.rateLimited) return jsonResponse({ error: 'rate_limited', retryAfter: r.retryAfter }, 429);
  return jsonResponse({ error: 'failed' }, 502);
};

export const config = { path: '/api/admin-punctuate' };
