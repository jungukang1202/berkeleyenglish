// 영상 쉐도잉 — 회원별 '공부한 문장'과 '책갈피(마지막으로 공부한 문장)'
//   video-progress : `${username}/${lessonId}` → { done:[문장번호…], last:{ i, at }, updatedAt }
// 휴대폰·컴퓨터 어디서 공부해도 같은 표시가 보이도록 서버에 저장합니다.
import { getStore } from '@netlify/blobs';

export function progressStore() { return getStore({ name: 'video-progress', consistency: 'strong' }); }
const key = (u, id) => `${u}/${id}`;
const cleanDone = a => (Array.isArray(a) ? a : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 5000);
function cleanLast(x) {
  if (!x || typeof x !== 'object') return null;
  const i = Number(x.i); if (!Number.isInteger(i) || i < 0 || i >= 5000) return null;
  const at = Date.parse(x.at); return { i, at: new Date(Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now()).toISOString() };
}

export async function getProgress(username, id) {
  const p = await progressStore().get(key(username, id), { type: 'json' });
  return { done: cleanDone(p && p.done), last: cleanLast(p && p.last), resetAt: (p && p.resetAt) || null };
}

// 받은 표시를 합칩니다: 공부한 문장은 합집합, 책갈피는 더 최근 것
export async function mergeProgress(username, id, { done, last, reset }) {
  const cur = reset ? { done: [], last: null, resetAt: new Date().toISOString() } : await getProgress(username, id);
  const set = new Set(cur.done); cleanDone(done).forEach(n => set.add(n));
  const L = cleanLast(last);
  const next = { done: [...set].sort((a, b) => a - b), last: L && (!cur.last || L.at >= cur.last.at) ? L : cur.last, resetAt: cur.resetAt || null, updatedAt: new Date().toISOString() };
  await progressStore().setJSON(key(username, id), next);
  return { done: next.done, last: next.last, resetAt: next.resetAt };
}

// 목록 카드용 요약 { [lessonId]: { done: 개수, last: 문장번호 } }
export async function progressSummary(username, ids) {
  const out = {};
  await Promise.all(ids.map(async id => {
    try { const p = await getProgress(username, id); if (p.done.length || p.last) out[id] = { done: p.done.length, last: p.last ? p.last.i : null }; } catch (e) {}
  }));
  return out;
}
