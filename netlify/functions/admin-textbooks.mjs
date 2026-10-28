// 관리자 — 📖 교재쉐도잉 기록 화면용 교재 목록 (관리자 토큰 필요)
// 교재는 「📚 교재 만들기」(/api/admin-books)에서 만든 것을 유닛 단위로 보여줘요.
// GET /api/admin-textbooks           → { books:[{ id, title, cover, color, units:[{ id:'book-교재ID-u번호', title, sentenceCount, wordCount }] }] }
// GET /api/admin-textbooks?id=유닛ID  → { set:{ id, title, book, sentences:[{o,ko}], words:[] } }  (미리보기)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listBooks, getBook, parseUnitSetId, unitList, unitSet } from './_lib/books.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const p = parseUnitSetId(id);
    const set = p && unitSet(await getBook(p.bookId), p.unit);
    return set ? jsonResponse({ set }) : jsonResponse({ error: 'unit_not_found', message: '유닛을 찾을 수 없어요.' }, 404);
  }
  const books = (await listBooks()).map(b => ({ id: b.id, title: b.title, cover: b.cover || '', color: b.color || '', units: unitList(b) }));
  return jsonResponse({ books });
};

export const config = { path: '/api/admin-textbooks' };
