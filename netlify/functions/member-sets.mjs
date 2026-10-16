// 로그인한 회원 본인의 쉐도잉 세트 조회 전용(수정/삭제 불가) — 반드시 회원 토큰이 필요합니다.
// GET /api/member-sets              → { sets: [{id,title,createdAt,...,practice}] }  (본인 세트 목록, 최신순)
//                                       practice: { count, spoke, best, last } | null  — 그 회차를 공부한 기록 요약(없으면 null)
// GET /api/member-sets?id=yyy       → { set: {...} }                        (세트 상세: 문장/단어 포함)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listSets, getSet } from './_lib/store.mjs';
import { getSummary } from './_lib/practice.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);

  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (id) {
    const set = await getSet(auth.username, id);
    if (!set) return jsonResponse({ error: 'set_not_found' }, 404);
    return jsonResponse({ set });
  }

  const [sets, summary] = await Promise.all([
    listSets(auth.username),
    getSummary(auth.username).catch(() => ({})),
  ]);
  // 회차 선택 목록에 "공부함" 표시를 하기 위해 회차별 연습 기록 요약을 붙여 보냅니다.
  sets.forEach(s => {
    const p = summary && summary[s.id];
    const count = p ? (p.listen || 0) + (p.spoke || 0) + (p.failed || 0) : 0;
    s.practice = count ? { count, spoke: p.spoke || 0, best: p.best || 0, last: p.last || null } : null;
  });
  return jsonResponse({ sets });
};

export const config = { path: '/api/member-sets' };
