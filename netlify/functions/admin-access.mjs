// 관리자 — 🎁 학생별 교재·영상 넣어주기 (관리자 토큰 필요)
// GET  /api/admin-access                               → { access: { [아이디]: { books:[교재ID], videos:[영상ID], updatedAt } } }
// POST /api/admin-access { username, books:[…], videos:[…] } → { access: { books, videos, updatedAt } }  (그 학생 것을 통째로 바꿔요)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getAllAccess, setAccess } from './_lib/access.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  try {
    if (req.method === 'GET') return jsonResponse({ access: await getAllAccess() });
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
    const access = await setAccess(body && body.username, { books: body && body.books, videos: body && body.videos });
    return jsonResponse({ access });
  } catch (e) {
    return jsonResponse({ error: e.message || 'failed', message: e.message === 'bad_user' ? '학생 아이디가 올바르지 않아요.' : e.message }, 400);
  }
};

export const config = { path: '/api/admin-access' };
