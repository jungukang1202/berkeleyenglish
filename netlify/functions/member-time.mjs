// 회원 공부 시간 (회원 토큰 필요, 본인 것만)
// GET  /api/member-time                → { today, month, week, days, totals:{listen, speak} }
// POST /api/member-time { cat, sec }    → 오늘 공부 시간에 더하기 (cat: feedback | video)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { addTime, timeSummary } from './_lib/study-time.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method === 'GET') return jsonResponse(await timeSummary(auth.username));
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const row = await addTime(auth.username, String(body && body.cat), body && body.sec);
  return jsonResponse({ ok: !!row, today: row || {} });
};

export const config = { path: '/api/member-time' };
