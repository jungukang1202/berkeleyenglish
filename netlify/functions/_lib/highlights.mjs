// ✂️ 수업영상 하이라이트 저장소 (영클 연세점에서 옮겨 온 기능, 2026-11-13)
//   관리자 화면(js/lesson-highlight.js)이 수업 녹화를 3~6분으로 편집한 mp4를 3.5MB 조각으로 올려요.
//   lesson-highlights : `m/${학생}/${id}`        → { id, username, title, date, duration, subs, size, chunks, status('uploading'|'ready'), to:[넣어 준 학생], createdAt }
//                       `c/${학생}/${id}/${n}`   → 영상 조각(바이너리)
//   만든 하이라이트는 그 학생 이름으로 저장만 돼요. 학생 화면에는 「🎁 학생별 쉐도잉 넣어주기 → ✂️ 수업영상 하이라이트」에서
//   넣어 준 학생(to)에게만 보여요.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { signToken } from './auth.mjs';

export const HL_CHUNK = 3.5 * 1024 * 1024; // js/lesson-highlight.js의 HL_CHUNK와 같아야 해요
export const HL_MAX = 600 * 1024 * 1024;
const STREAM_TTL = 60 * 60 * 12;

export const hlStore = () => getStore({ name: 'lesson-highlights', consistency: 'strong' });
export const normUser = u => String(u || '').trim().toLowerCase();
export const okUser = u => /^[\w.-]{1,40}$/.test(u);
export const okId = id => /^[a-f0-9]{16}$/.test(String(id || ''));
const metaKey = (u, id) => `m/${u}/${id}`;
export const chunkKey = (u, id, n) => `c/${u}/${id}/${String(n).padStart(5, '0')}`;
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// 학생 화면 · 관리자 화면에서 바로 재생할 주소(<video>는 머리글을 못 보내서 짧은 기간용 토큰을 붙여요)
function withUrl(h) {
  const t = signToken({ role: 'hl', u: h.username, id: h.id }, STREAM_TTL);
  return Object.assign({}, h, { url: `/api/highlight-stream?u=${encodeURIComponent(h.username)}&id=${h.id}&t=${encodeURIComponent(t)}` });
}

export async function getHighlight(u, id) {
  u = normUser(u);
  if (!okUser(u) || !okId(id)) return null;
  return await hlStore().get(metaKey(u, id), { type: 'json' });
}

async function allMetas(prefix = 'm/') {
  const s = hlStore();
  const { blobs } = await s.list({ prefix });
  return (await Promise.all(blobs.map(b => s.get(b.key, { type: 'json' })))).filter(Boolean)
    .sort((a, b) => (String(a.date || a.createdAt) < String(b.date || b.createdAt) ? 1 : -1));
}

// 그 학생 이름으로 저장한 하이라이트 (관리자)
export async function listFor(u) {
  u = normUser(u);
  if (!okUser(u)) return [];
  return (await allMetas(`m/${u}/`)).map(withUrl);
}
// 모든 학생의 하이라이트 (관리자 「🎁 넣어주기」) — 다 올라간 것만
export async function listAll() {
  return (await allMetas()).filter(h => h.status === 'ready').map(withUrl);
}
// 이 학생에게 넣어 준 하이라이트 (학생 화면)
export async function listGivenTo(u) {
  u = normUser(u);
  return (await allMetas()).filter(h => h.status === 'ready' && (h.to || []).includes(u)).map(withUrl);
}

export async function startHighlight(u, info) {
  u = normUser(u);
  if (!okUser(u)) throw new Error('학생을 다시 선택해 주세요.');
  const size = Math.floor(Number(info.size) || 0);
  if (!(size > 0) || size > HL_MAX) throw new Error('하이라이트 파일 크기가 올바르지 않아요.');
  const h = {
    id: crypto.randomBytes(8).toString('hex'), username: u,
    title: clip(info.title, 120).trim() || '수업', date: /^\d{4}-\d{2}-\d{2}$/.test(String(info.date || '')) ? info.date : '',
    duration: Math.max(0, Math.round(Number(info.duration) || 0)), subs: clip(info.subs, 80),
    size, chunks: Math.ceil(size / HL_CHUNK), status: 'uploading', to: [], createdAt: new Date().toISOString(),
  };
  await hlStore().setJSON(metaKey(u, h.id), h);
  return h;
}

export async function putHighlightChunk(u, id, n, buf) {
  const h = await getHighlight(u, id);
  if (!h) throw new Error('highlight_not_found');
  n = Number(n);
  if (!Number.isInteger(n) || n < 0 || n >= h.chunks) throw new Error('bad_chunk');
  const want = n === h.chunks - 1 ? h.size - n * HL_CHUNK : HL_CHUNK;
  if (buf.byteLength !== want) throw new Error(`chunk_size ${buf.byteLength} != ${want}`);
  await hlStore().set(chunkKey(h.username, id, n), buf);
}

export async function finishHighlight(u, id) {
  const h = await getHighlight(u, id);
  if (!h) throw new Error('highlight_not_found');
  const { blobs } = await hlStore().list({ prefix: `c/${h.username}/${id}/` });
  if (blobs.length < h.chunks) throw new Error(`영상 조각이 모두 올라가지 않았어요 (${blobs.length}/${h.chunks}).`);
  h.status = 'ready';
  await hlStore().setJSON(metaKey(h.username, id), h);
  return withUrl(h);
}

// 「🎁 넣어주기」: 이 학생(u)에게 ids 하이라이트만 보이게 (다른 하이라이트에서는 빼요)
export async function giveHighlights(u, ids) {
  u = normUser(u);
  if (!okUser(u)) throw new Error('학생을 다시 선택해 주세요.');
  const want = new Set((Array.isArray(ids) ? ids : []).map(String));
  const s = hlStore();
  let given = 0;
  for (const h of await allMetas()) {
    const has = (h.to || []).includes(u), on = want.has(h.id) && h.status === 'ready';
    if (on) given++;
    if (has === on) continue;
    h.to = (h.to || []).filter(x => x !== u).concat(on ? [u] : []);
    await s.setJSON(metaKey(h.username, h.id), h);
  }
  return given;
}

export async function deleteHighlight(u, id) {
  u = normUser(u);
  if (!okUser(u) || !okId(id)) return;
  const s = hlStore();
  const { blobs } = await s.list({ prefix: `c/${u}/${id}/` });
  await Promise.all(blobs.map(b => s.delete(b.key)));
  await s.delete(metaKey(u, id));
}
