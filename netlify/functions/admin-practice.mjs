// 회원 연습 기록 보기 — 반드시 관리자 토큰이 필요합니다.
// GET  /api/admin-practice?username=xxx          → { summary: { [setId]: { listen, spoke, failed, scoreSum, best, last } } }
// GET  /api/admin-practice?username=xxx&id=yyy   → { set, attempts:[...] }
// POST /api/admin-practice { action:'clear', username, id }  → 그 회차 연습 기록 초기화
import { getBook, parseUnitSetId } from './_lib/books.mjs';
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getSet } from './_lib/store.mjs';
import { getSummary, getLog, clearPractice } from './_lib/practice.mjs';
import { getLesson } from './_lib/videos.mjs';

// 영상 쉐도잉 기록('video-영상ID')은 영상의 문장을 회차처럼 보여줍니다.
async function setOrVideo(username, id) {
  const bp = parseUnitSetId(id);
  if (bp) { // 📖 교재 유닛
    const b = await getBook(bp.bookId); const u = b && b.units[bp.unit];
    return u ? { id, title: '📖 ' + b.title + ' · ' + u.title, sentences: u.sentences.map(s => ({ o: s.o })), words: [], book: true } : null;
  }
  if (!String(id).startsWith('video-')) return getSet(username, id);
  const v = await getLesson(String(id).slice(6));
  return v ? { id, title: '🎬 ' + v.title, sentences: (v.sentences || []).map(s => ({ o: s.en })), words: [], video: true } : null;
}

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const username = url.searchParams.get('username');
    const id = url.searchParams.get('id');
    if (!username) return jsonResponse({ error: 'username_required' }, 400);
    if (!id) return jsonResponse({ summary: await getSummary(username) });
    const [set, log] = await Promise.all([setOrVideo(username, id), getLog(username, id)]);
    return jsonResponse({ set, attempts: log.attempts || [] });
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  if (body && body.action === 'clear') {
    if (!body.username || !body.id) return jsonResponse({ error: 'username_and_id_required' }, 400);
    await clearPractice(body.username, String(body.id));
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: 'unknown_action' }, 400);
};

export const config = { path: '/api/admin-practice' };
