// 관리자 — ✂️ 수업영상 하이라이트 저장 · 넣어주기 · 지우기 (관리자 토큰 필요) — js/lesson-highlight.js · admin.html 「🎁 넣어주기」가 사용
// GET    /api/admin-highlights?u=학생             → { highlights:[{ id, username, title, date, duration, subs, size, status, to, url }] }
// GET    /api/admin-highlights?all=1              → { highlights } 다 올라간 모든 학생의 하이라이트
// POST   /api/admin-highlights { action:'start', u, size, title, date, duration, subs } → { highlight }
// PUT    /api/admin-highlights?u=학생&id=…&n=조각번호   (본문: 영상 조각 3.5MB)
// POST   /api/admin-highlights { action:'finish', u, id } → { highlight }
// POST   /api/admin-highlights { action:'give', u, ids:[…] } → { given } 이 학생에게 넣어 줄 하이라이트(나머지는 빼요)
// DELETE /api/admin-highlights?u=학생&id=…
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { listFor, listAll, startHighlight, putHighlightChunk, finishHighlight, giveHighlights, deleteHighlight, HL_CHUNK } from './_lib/highlights.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  const url = new URL(req.url), q = k => url.searchParams.get(k) || '';
  try {
    if (req.method === 'GET') {
      if (q('all')) return jsonResponse({ highlights: await listAll() });
      return jsonResponse({ highlights: await listFor(q('u')) });
    }
    if (req.method === 'PUT') {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > HL_CHUNK) return jsonResponse({ error: 'chunk_too_big' }, 413);
      await putHighlightChunk(q('u'), q('id'), q('n'), buf);
      return jsonResponse({ ok: true });
    }
    if (req.method === 'DELETE') {
      await deleteHighlight(q('u'), q('id'));
      return jsonResponse({ ok: true });
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
    if (body.action === 'start') return jsonResponse({ highlight: await startHighlight(body.u, body) });
    if (body.action === 'finish') return jsonResponse({ highlight: await finishHighlight(body.u, body.id) });
    if (body.action === 'give') return jsonResponse({ given: await giveHighlights(body.u, body.ids) });
    return jsonResponse({ error: 'unknown_action' }, 400);
  } catch (e) {
    return jsonResponse({ error: e.message || 'failed', message: e.message }, 400);
  }
};

export const config = { path: '/api/admin-highlights' };
