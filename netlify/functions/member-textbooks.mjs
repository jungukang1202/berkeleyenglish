// 회원 — 📖 교재 쉐도잉 (회원 토큰 필요)
// GET /api/member-textbooks           → { books:[{ id, title, cover, color, units:[{ id, title, sentenceCount, practice:{count,spoke,best,last}|null, studied:[문장번호] }] }] }
// GET /api/member-textbooks?id=유닛ID  → { set, counts:{문장번호:연습 횟수}, mic:{문장번호:따라 말한 횟수} }
// 보이는 교재: 관리자가 「🎁 학생별 넣어주기」로 넣어 준 교재 + 공개 범위가 '모든 회원'(또는 이 학생을 고른) 교재
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listBooks, getBook, parseUnitSetId, unitList, unitSet } from './_lib/books.mjs';
import { getSummary, sentenceCounts } from './_lib/practice.mjs';
import { getAccess, canSeeBookWith } from './_lib/access.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const access = await getAccess(auth.username);
  const id = new URL(req.url).searchParams.get('id');

  if (id) {
    const p = parseUnitSetId(id);
    const b = p && await getBook(p.bookId);
    const set = b && canSeeBookWith(b, auth.username, access) ? unitSet(b, p.unit) : null;
    if (!set) return jsonResponse({ error: 'unit_not_found', message: '이 교재는 아직 넣어 주지 않았어요.' }, 404);
    const { counts, mic } = await sentenceCounts(auth.username, set.id);
    return jsonResponse({ set, counts, mic });
  }

  const sum = await getSummary(auth.username);
  const books = (await listBooks()).filter(b => canSeeBookWith(b, auth.username, access)).map(b => ({
    id: b.id, title: b.title, cover: b.cover || '', color: b.color || '',
    units: unitList(b).map(u => {
      const s = sum[u.id];
      const count = s ? (s.listen || 0) + (s.spoke || 0) + (s.failed || 0) : 0;
      return { ...u, practice: count ? { count, spoke: s.spoke || 0, best: s.best || 0, last: s.last || null } : null, studied: (s && Array.isArray(s.sents)) ? s.sents : [] };
    }),
  }));
  return jsonResponse({ books });
};

export const config = { path: '/api/member-textbooks' };
