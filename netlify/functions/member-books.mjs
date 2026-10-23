// 회원 — 📖 교재 쉐도잉 (회원 토큰 필요)
// GET /api/member-books          → { books:[{ id, title, level, desc, cover, color, unitCount, sentenceCount, studiedUnits, pct }] }
// GET /api/member-books?id=교재ID  → { book:{ id, title, units:[{ title, sentences:[{o,ko}], listen, spoke, avg }] } }
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listBooks, getBook, canSeeBook, unitSetId } from './_lib/books.mjs';
import { getSummary } from './_lib/practice.mjs';

// 유닛마다 "문장 수만큼 연습했으면 다 공부한 것"으로 보고 공부한 양(%)을 어림해요
function unitStat(sum, bookId, k, count) {
  const s = sum[unitSetId(bookId, k)] || {};
  const reps = (s.listen || 0) + (s.spoke || 0) + (s.failed || 0);
  return { listen: s.listen || 0, spoke: s.spoke || 0, avg: s.spoke ? Math.round(s.scoreSum / s.spoke) : null, reps, frac: count ? Math.min(1, reps / count) : 0 };
}

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const id = new URL(req.url).searchParams.get('id');
  const sum = await getSummary(auth.username);
  if (id) {
    const b = await getBook(id);
    if (!canSeeBook(b, auth.username)) return jsonResponse({ error: 'book_not_found' }, 404);
    return jsonResponse({ book: { id: b.id, title: b.title, level: b.level || '', desc: b.desc || '', cover: b.cover || '', color: b.color || '',
      units: b.units.map((u, k) => ({ title: u.title, sentences: u.sentences, ...unitStat(sum, b.id, k, u.sentences.length) })) } });
  }
  const books = (await listBooks()).filter(b => canSeeBook(b, auth.username)).map(b => {
    const stats = b.units.map((u, k) => unitStat(sum, b.id, k, u.sentences.length));
    const total = b.units.reduce((a, u) => a + u.sentences.length, 0);
    const doneSent = b.units.reduce((a, u, k) => a + stats[k].frac * u.sentences.length, 0);
    return { id: b.id, title: b.title, level: b.level || '', desc: b.desc || '', cover: b.cover || '', color: b.color || '',
      unitCount: b.units.length, sentenceCount: total, studiedUnits: stats.filter(x => x.reps > 0).length, pct: total ? Math.round(doneSent / total * 100) : 0 };
  });
  return jsonResponse({ books });
};

export const config = { path: '/api/member-books' };
