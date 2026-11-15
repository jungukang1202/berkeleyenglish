// ✂️ 수업영상 하이라이트 — AI가 수업 대사 전체를 보고 하이라이트 구간을 골라요. 관리자 전용. (js/lesson-highlight.js가 사용)
// POST /api/admin-lesson-highlight { title, minSec, maxSec, hints:[{ from, to, score }], lines:[{ t, sp, en }] }
//   → { segments:[{ from, to, why }] }   from·to = lines 번호(그 줄부터 그 줄까지, 이어진 범위), why = 고른 까닭(한국어 짧게)
//   t = 그 줄이 시작하는 녹화 시간(초), sp = 'T'(선생님) · 'S'(학생) · ''(모름). hints = 학생 참여 점수가 높은 60초 구간(초).
// 모양이 이상하거나 고르지 못하면 화면이 점수로 골라요(scorePick).
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { chat, groqErrorResponse, GroqError } from './_lib/groq.mjs';

const SYSTEM = `You edit a highlight reel from a recorded 1:1 online English lesson (video call) between a TEACHER (T) and a STUDENT (S).
Input: numbered transcript lines "i [m:ss] SP: text" (SP = T, S or ? if unknown) and a few "active" time windows where the student talked a lot.
Pick 2 to 4 segments that together last MIN to MAX seconds (use the [m:ss] times). Choose the moments that best show:
- the STUDENT actively speaking English (longer answers, own sentences, trying hard), lively back-and-forth turns,
- the teacher and student enjoying the lesson together (laughing, jokes, praise like "Great job!", excitement),
- clear learning moments (a correction the student then says correctly).
Avoid: waiting, greetings/goodbyes, technical problems ("can you hear me"), long teacher-only explanations, silence, Korean-only talk.
Each segment must start at the beginning of a line and end at the end of a line, cover a complete exchange (don't cut a sentence or a question from its answer), and be at least 30 seconds long. Segments must not overlap and must be in time order.
Return JSON {"segments":[{"from":12,"to":40,"why":"학생이 주말 이야기를 길게 말하고 선생님과 함께 웃음"}]} — from/to are line numbers, why is a short Korean reason (under 40 characters).`;

const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const lines = (Array.isArray(body && body.lines) ? body.lines : []).slice(0, 900).map(x => ({
    t: Math.max(0, Number(x && x.t) || 0), sp: x && (x.sp === 'T' || x.sp === 'S') ? x.sp : '?', en: String((x && x.en) || '').replace(/\s+/g, ' ').trim().slice(0, 160),
  }));
  if (lines.length < 8) return jsonResponse({ segments: [] });
  const minSec = Math.max(60, Math.min(600, Number(body.minSec) || 180)), maxSec = Math.max(minSec, Math.min(900, Number(body.maxSec) || 360));
  const hints = (Array.isArray(body.hints) ? body.hints : []).slice(0, 8)
    .map(h => `${mmss(Number(h.from) || 0)}~${mmss(Number(h.to) || 0)}`).join(', ');
  const title = String(body.title || '').slice(0, 200);
  // 긴 수업은 글자가 많아서, 줄을 짧게 적어 보내요(사용량 한도 안에서)
  const text = lines.map((x, i) => `${i} [${mmss(x.t)}] ${x.sp}: ${x.en}`).join('\n').slice(0, 60000);
  const lastT = lines[lines.length - 1].t;

  const messages = [
    { role: 'system', content: SYSTEM.replace('MIN to MAX', `${minSec} to ${maxSec}`) },
    { role: 'user', content: `${title ? `Lesson: ${title}\n` : ''}Recording length about ${mmss(lastT)}.\nActive windows: ${hints || '(none)'}\n\n${text}` },
  ];
  try {
    let out;
    try { out = await chat(messages, { json: true, effort: 'medium', timeoutMs: 20000 }); }
    catch (e) { if (e instanceof GroqError && e.status === 429) throw e; out = await chat(messages, { json: true, timeoutMs: 8000 }); }
    let segs = [];
    try { segs = JSON.parse(out).segments; } catch (e) {}
    if (!Array.isArray(segs)) segs = [];
    let prevTo = -1;
    segs = segs
      .map(s => ({ from: Math.round(Number(s && s.from)), to: Math.round(Number(s && s.to)), why: String((s && s.why) || '').trim().slice(0, 80) }))
      .filter(s => Number.isFinite(s.from) && Number.isFinite(s.to) && s.from >= 0 && s.to >= s.from && s.to < lines.length)
      .sort((a, b) => a.from - b.from)
      .filter(s => { if (s.from <= prevTo) return false; prevTo = s.to; return true; })
      .slice(0, 6);
    return jsonResponse({ segments: segs });
  } catch (e) {
    return groqErrorResponse(e, jsonResponse);
  }
};

export const config = { path: '/api/admin-lesson-highlight' };
