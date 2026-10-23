// 영상 쉐도잉 — 공부한 문장 · 책갈피 (회원 토큰 필요, 본인 것만)
// GET  /api/member-video-progress?id=영상ID          → { done:[…], last:{ i, at } }
// POST /api/member-video-progress { id, done:[…], last:{ i, at } }   → 합친 결과
// POST /api/member-video-progress { id, reset:true }               → 표시 모두 지우기
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getLesson, canMemberSee } from './_lib/videos.mjs';
import { getProgress, mergeProgress } from './_lib/video-progress.mjs';

const okId = id => /^[\w-]{8,64}$/.test(String(id || ''));

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id');
    if (!okId(id)) return jsonResponse({ error: 'bad_id' }, 400);
    return jsonResponse(await getProgress(auth.username, id));
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  if (!okId(body && body.id)) return jsonResponse({ error: 'bad_id' }, 400);
  const lesson = await getLesson(body.id);
  if (!canMemberSee(lesson, auth.username)) return jsonResponse({ error: 'video_not_found' }, 404);
  return jsonResponse(await mergeProgress(auth.username, body.id, { done: body.done, last: body.last, reset: !!body.reset }));
};

export const config = { path: '/api/member-video-progress' };
