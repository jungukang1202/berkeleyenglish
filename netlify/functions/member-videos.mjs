// 영상 쉐도잉 목록/상세 — 회원 토큰이 있으면 '회원 공개' + '전체 공개' 영상을, 없으면 '전체 공개' 영상만 보여줍니다.
// GET /api/member-videos            → { lessons:[요약], loggedIn }
// GET /api/member-videos?id=xxx     → { lesson:{...문장 포함}, streamUrl }
import { requireAuth, jsonResponse, signToken } from './_lib/auth.mjs';
import { listLessons, getLesson, summary } from './_lib/videos.mjs';

const STREAM_TTL = 60 * 60 * 12;

export default async (req) => {
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const member = requireAuth(req, 'member');
  const canSee = v => v && v.status === 'ready' && (v.visibility === 'public' || (member && v.visibility === 'members'));
  const id = new URL(req.url).searchParams.get('id');

  if (id) {
    const lesson = await getLesson(id);
    if (!canSee(lesson)) return jsonResponse({ error: member ? 'lesson_not_found' : 'login_required' }, member ? 404 : 401);
    const { sentences, title, duration, mime, partMinutes, description, level, youtubeId, clipStart, clipEnd, watchOnly } = lesson;
    const out = { id, title, duration, mime, partMinutes, description, level, sentences, youtubeId: youtubeId || null, clipStart: clipStart || 0, clipEnd: clipEnd || 0, watchOnly: !!watchOnly };
    if (youtubeId) return jsonResponse({ lesson: out, streamUrl: null });
    const t = signToken({ role: 'video', vid: id }, STREAM_TTL);
    return jsonResponse({ lesson: out, streamUrl: `/api/video-stream?id=${id}&t=${encodeURIComponent(t)}` });
  }

  const lessons = (await listLessons()).filter(canSee).map(summary);
  return jsonResponse({ lessons, loggedIn: !!member, username: member ? member.username : null });
};

export const config = { path: '/api/member-videos' };
