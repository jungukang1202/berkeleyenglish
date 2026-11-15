// 회원 — ✂️ 수업영상 하이라이트 (회원 토큰 필요, 본인에게 넣어 준 것만)
// GET /api/member-highlights → { highlights:[{ id, title, date, duration, subs, size, url }] }
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listGivenTo } from './_lib/highlights.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const list = (await listGivenTo(auth.username)).map(h => ({ id: h.id, title: h.title, date: h.date, duration: h.duration, subs: h.subs, size: h.size, url: h.url }));
  return jsonResponse({ highlights: list });
};

export const config = { path: '/api/member-highlights' };
