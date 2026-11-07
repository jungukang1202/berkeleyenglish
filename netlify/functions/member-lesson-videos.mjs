// 학생 화면 「🎥 수업영상쉐도잉」 — 이 회원에게 넣어 준 영상 중 엔보임 수업 녹화로 만든 영상 ID. (member.html이 사용)
// GET /api/member-lesson-videos → { ids:[영상 ID] }
//   영상 목록·재생은 기존 /api/member-videos · video.html을 그대로 쓰고, member.html이 이 ID로 「🎬 영상 쉐도잉」과 「🎥 수업영상쉐도잉」을 나눠 보여줘요.
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getAccess } from './_lib/access.mjs';
import { recordingLessonIds } from './_lib/nvoim-video.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  const [access, ids] = await Promise.all([getAccess(auth.username), recordingLessonIds()]);
  const mine = new Set(access.videos);
  return jsonResponse({ ids: ids.filter(id => mine.has(id)) });
};

export const config = { path: '/api/member-lesson-videos' };
