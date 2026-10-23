// 관리자 — 📖 교재 쉐도잉 (관리자 토큰 필요)
// GET  /api/admin-books              → { books:[요약] }
// GET  /api/admin-books?id=교재ID      → { book }  (유닛·문장 전체)
// GET  /api/admin-books?user=아이디    → { user, books:[{ id, title, canSee, units:[{ title, count, listen, spoke, failed, avg, best, last }] }] }
// POST /api/admin-books { action:'save', id?, title, level, desc, color, cover, units:[{title, sentences:[{o,ko}]}], visibility, assigned }
// POST /api/admin-books { action:'assign', id, user, assign:true|false }
// POST /api/admin-books { action:'delete', id }
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listBooks, getBook, saveBook, deleteBook, bookSummary, canSeeBook, unitSetId } from './_lib/books.mjs';
import { getSummary } from './_lib/practice.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id'), user = String(url.searchParams.get('user') || '').trim().toLowerCase();
      if (id) { const b = await getBook(id); return b ? jsonResponse({ book: b }) : jsonResponse({ error: 'book_not_found' }, 404); }
      const books = await listBooks();
      if (user) {
        if (!/^[\w.-]{1,40}$/.test(user)) return jsonResponse({ error: 'bad_user' }, 400);
        const sum = await getSummary(user);
        return jsonResponse({ user, books: books.map(b => ({
          id: b.id, title: b.title, cover: b.cover || '', color: b.color || '', visibility: b.visibility, canSee: canSeeBook(b, user), assigned: (b.assigned || []).includes(user),
          units: (b.units || []).map((u, k) => { const s = sum[unitSetId(b.id, k)] || {}; return { title: u.title, count: u.sentences.length, listen: s.listen || 0, spoke: s.spoke || 0, failed: s.failed || 0, avg: s.spoke ? Math.round(s.scoreSum / s.spoke) : null, best: s.best || 0, last: s.last || null }; }),
        })) });
      }
      return jsonResponse({ books: books.map(bookSummary) });
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
    if (body.action === 'save') return jsonResponse({ book: bookSummary(await saveBook(body.id || null, body)) });
    if (body.action === 'delete') { await deleteBook(String(body.id || '')); return jsonResponse({ ok: true }); }
    if (body.action === 'assign') {
      const b = await getBook(body.id); if (!b) return jsonResponse({ error: 'book_not_found' }, 404);
      const user = String(body.user || '').trim().toLowerCase();
      if (b.visibility === 'members') return jsonResponse({ error: 'already_visible', message: '이 교재는 모든 회원에게 공개되어 있어서 따로 넣어줄 필요가 없어요.' }, 409);
      const set = new Set(b.assigned || []); if (body.assign) set.add(user); else set.delete(user);
      const rec = await saveBook(b.id, { assigned: [...set], visibility: body.assign && b.visibility === 'draft' ? 'assigned' : b.visibility });
      return jsonResponse({ book: bookSummary(rec) });
    }
    return jsonResponse({ error: 'unknown_action' }, 400);
  } catch (e) {
    return jsonResponse({ error: e.message || 'failed' }, 400);
  }
};

export const config = { path: '/api/admin-books' };
