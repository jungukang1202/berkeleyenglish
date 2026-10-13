// 회원 연습 기록 보기 — 반드시 관리자 토큰이 필요합니다.
// GET  /api/admin-practice?username=xxx          → { summary: { [setId]: { listen, spoke, failed, scoreSum, best, last } } }
// GET  /api/admin-practice?username=xxx&id=yyy   → { set, attempts:[...] }
// POST /api/admin-practice { action:'clear', username, id }  → 그 회차 연습 기록 초기화
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getSet } from './_lib/store.mjs';
import { getSummary, getLog, clearPractice } from './_lib/practice.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const username = url.searchParams.get('username');
    const id = url.searchParams.get('id');
    if (!username) return jsonResponse({ error: 'username_required' }, 400);
    if (!id) return jsonResponse({ summary: await getSummary(username) });
    const [set, log] = await Promise.all([getSet(username, id), getLog(username, id)]);
    return jsonResponse({ set, attempts: log.attempts || [] });
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  if (body && body.action === 'clear') {
    if (!body.username || !body.id) return jsonResponse({ error: 'username_and_id_required' }, 400);
    await clearPractice(body.username, String(body.id));
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: 'unknown_action' }, 400);
};

export const config = { path: '/api/admin-practice' };
