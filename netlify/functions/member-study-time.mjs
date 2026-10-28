// 회원 — ⏱ 하루 쉐도잉 공부 시간 (회원 토큰 필요, 본인 것만) — js/study-time.js가 1분마다 보내요
// GET  /api/member-study-time                          → { times:{feedback,book,video}(오늘, 초), month:{feedback,book,video}(이번 달, 초) }
// POST /api/member-study-time { add:{feedback?,book?,video?} } → 더한 뒤 같은 모양
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { addTime, timeSummary, CATS } from './_lib/study-time.mjs';

const pick = row => Object.fromEntries(CATS.map(c => [c, (row && row[c]) || 0]));

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
    const add = (body && body.add) || {};
    for (const c of CATS) if (add[c] > 0) await addTime(auth.username, c, add[c]);
  } else if (req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }
  const t = await timeSummary(auth.username);
  return jsonResponse({ times: pick(t.today), month: pick(t.month) });
};

export const config = { path: '/api/member-study-time' };
