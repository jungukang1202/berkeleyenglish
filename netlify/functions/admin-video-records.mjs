// 관리자 — 학생별 영상 쉐도잉 공부 현황 · 영상 넣어주기 (관리자 토큰 필요)
// GET  /api/admin-video-records?user=아이디
//   → { user, time:{ today, month, week, days }, videos:[{ id, title, level, visibility, youtubeId, sentenceCount,
//        canSee, assigned, done, last, listen, spoke, failed, avg, best, lastAt }] }
// POST /api/admin-video-records { user, id, assign:true|false }  → 그 학생에게 영상 넣기/빼기
//   (비공개 영상을 넣어주면 '선택한 학생만'으로 바뀌어요. 모든 회원 공개 영상은 바꾸지 않아요)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listLessons, getLesson, updateLesson, canMemberSee } from './_lib/videos.mjs';
import { getProgress } from './_lib/video-progress.mjs';
import { getSummary } from './_lib/practice.mjs';
import { timeSummary } from './_lib/study-time.mjs';

const okUser = u => /^[\w.-]{1,40}$/.test(String(u || ''));

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const user = String(new URL(req.url).searchParams.get('user') || '').trim().toLowerCase();
    if (!okUser(user)) return jsonResponse({ error: 'bad_user' }, 400);
    const [lessons, sum, time] = await Promise.all([listLessons(), getSummary(user), timeSummary(user)]);
    const videos = await Promise.all(lessons.filter(v => v.status === 'ready' && !v.watchOnly).map(async v => {
      const s = sum['video-' + v.id] || {};
      const p = await getProgress(user, v.id).catch(() => ({ done: [], last: null }));
      return {
        id: v.id, title: v.title, level: v.level || '', visibility: v.visibility, youtubeId: v.youtubeId || null,
        sentenceCount: (v.sentences || []).length,
        canSee: canMemberSee(v, user), assigned: (v.assigned || []).includes(user),
        done: p.done.length, last: p.last ? p.last.i : null,
        listen: s.listen || 0, spoke: s.spoke || 0, failed: s.failed || 0,
        avg: s.spoke ? Math.round(s.scoreSum / s.spoke) : null, best: s.best || 0, lastAt: s.last || (p.last && p.last.at) || null,
      };
    }));
    // 공부한 영상 먼저 (최근 순), 그다음 볼 수 있는 영상, 나머지
    videos.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || (b.canSee - a.canSee));
    const { totals, ...t } = time;
    return jsonResponse({ user, time: t, totals, videos });
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const user = String((body && body.user) || '').trim().toLowerCase();
  if (!okUser(user)) return jsonResponse({ error: 'bad_user' }, 400);
  const v = await getLesson(body && body.id);
  if (!v) return jsonResponse({ error: 'lesson_not_found' }, 404);
  // 모든 회원(또는 전체)에게 공개된 영상은 이미 볼 수 있어요 — 바꾸면 다른 학생이 못 보게 되니 건드리지 않아요
  if (['members', 'public'].includes(v.visibility)) return jsonResponse({ error: 'already_visible', message: '이 영상은 모든 회원에게 공개되어 있어서 따로 넣어줄 필요가 없어요.' }, 409);
  const set = new Set(v.assigned || []);
  if (body.assign) set.add(user); else set.delete(user);
  const patch = { assigned: [...set] };
  if (body.assign && v.visibility === 'draft') patch.visibility = 'assigned'; // 비공개 영상을 넣어주면 '선택한 학생만'으로
  const rec = await updateLesson(v.id, patch);
  return jsonResponse({ ok: true, visibility: rec.visibility, assigned: rec.assigned });
};

export const config = { path: '/api/admin-video-records' };
