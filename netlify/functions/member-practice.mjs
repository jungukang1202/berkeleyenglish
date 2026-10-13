// 회원 연습 기록 보내기 — 반드시 회원 토큰이 필요합니다(본인 기록만 쌓임).
// POST /api/member-practice { setId, attempts:[{ at, type, idx, target, mode:'mic'|'listen', ok, heard, score, error, rep, of, session }] }
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getSet } from './_lib/store.mjs';
import { addAttempts } from './_lib/practice.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const setId = String((body && body.setId) || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(setId)) return jsonResponse({ error: 'invalid_set' }, 400);

  // 본인 회차가 맞는지 확인(남의 회차나 없는 회차에는 기록하지 않음)
  const set = await getSet(auth.username, setId);
  if (!set) return jsonResponse({ error: 'set_not_found' }, 404);

  const result = await addAttempts(auth.username, setId, body.attempts);
  return jsonResponse({ ok: true, ...result });
};

export const config = { path: '/api/member-practice' };
