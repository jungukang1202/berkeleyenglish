// 영상 쉐도잉 관리 — 반드시 관리자 토큰이 필요합니다.
// GET  /api/admin-videos                   → { lessons:[요약] }
// GET  /api/admin-videos?id=xxx            → { lesson:{...문장 포함}, streamUrl }
// POST /api/admin-videos  { action:'create', title, mime, size, duration }   → { lesson }  (업로드 시작)
// PUT  /api/admin-videos?id=xxx&n=3   (본문: 영상 조각 바이너리)                → { ok }
// POST /api/admin-videos  { action:'update', id, title?, sentences?, visibility?, partMinutes?, status? }
// POST /api/admin-videos  { action:'create_youtube', youtubeId, title, duration, sentences, clipStart, clipEnd, ... }  (YouTube 링크형)
// POST /api/admin-videos  { action:'delete', id }
import { requireAuth, jsonResponse, signToken } from './_lib/auth.mjs';
import { listLessons, getLesson, createLesson, createYoutubeLesson, putChunk, updateLesson, deleteLesson, summary } from './_lib/videos.mjs';

const STREAM_TTL = 60 * 60 * 12;

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const lesson = await getLesson(id);
        if (!lesson) return jsonResponse({ error: 'lesson_not_found' }, 404);
        if (lesson.youtubeId) return jsonResponse({ lesson, streamUrl: null });
        const t = signToken({ role: 'video', vid: id }, STREAM_TTL);
        return jsonResponse({ lesson, streamUrl: `/api/video-stream?id=${id}&t=${encodeURIComponent(t)}` });
      }
      const lessons = (await listLessons()).map(summary);
      return jsonResponse({ lessons });
    }

    if (req.method === 'PUT') {
      const id = url.searchParams.get('id');
      const n = url.searchParams.get('n');
      const buf = new Uint8Array(await req.arrayBuffer());
      await putChunk(id, n, buf);
      return jsonResponse({ ok: true });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
      const action = body && body.action;
      if (action === 'create') {
        const lesson = await createLesson(body);
        return jsonResponse({ lesson });
      }
      if (action === 'create_youtube') {
        const lesson = await createYoutubeLesson(body);
        return jsonResponse({ lesson });
      }
      if (!body.id) return jsonResponse({ error: 'id_required' }, 400);
      if (action === 'update') {
        const lesson = await updateLesson(body.id, body);
        return jsonResponse({ lesson: summary(lesson) });
      }
      if (action === 'delete') {
        await deleteLesson(body.id);
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: e.message || 'error' }, 400);
  }
  return jsonResponse({ error: 'method_not_allowed' }, 405);
};

export const config = { path: '/api/admin-videos' };
