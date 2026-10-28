// 🎁 학생별 교재·영상 넣어주기 — 관리자가 학생마다 넣어 준 교재와 영상
//   member-access : `${username}` → { books:[교재ID], videos:[영상ID], updatedAt }
// 학생 화면의 📖 교재 쉐도잉 · 🎬 영상 쉐도잉에는 넣어 준 것(그리고 '모든 회원'에게 공개된 것)이 보여요.
import { getStore } from '@netlify/blobs';
import { canSeeBook } from './books.mjs';
import { canMemberSee } from './videos.mjs';

const store = () => getStore({ name: 'member-access', consistency: 'strong' });
const norm = u => String(u || '').trim().toLowerCase();
const cleanIds = a => [...new Set((Array.isArray(a) ? a : []).map(x => String(x || '').trim()).filter(x => /^[\w-]{1,64}$/.test(x)))].slice(0, 1000);
const EMPTY = () => ({ books: [], videos: [], updatedAt: null });

export async function getAccess(username) {
  const u = norm(username);
  if (!u) return EMPTY();
  const r = await store().get(u, { type: 'json' });
  return r ? { books: cleanIds(r.books), videos: cleanIds(r.videos), updatedAt: r.updatedAt || null } : EMPTY();
}

export async function getAllAccess() {
  const s = store();
  const { blobs } = await s.list();
  const out = {};
  await Promise.all(blobs.map(async b => {
    const r = await s.get(b.key, { type: 'json' });
    if (r) out[b.key] = { books: cleanIds(r.books), videos: cleanIds(r.videos), updatedAt: r.updatedAt || null };
  }));
  return out;
}

export async function setAccess(username, { books, videos }) {
  const u = norm(username);
  if (!/^[\w.-]{1,40}$/.test(u)) throw new Error('bad_user');
  const rec = { books: cleanIds(books), videos: cleanIds(videos), updatedAt: new Date().toISOString() };
  await store().setJSON(u, rec);
  return rec;
}

export async function deleteAccess(username) {
  const u = norm(username);
  if (u) await store().delete(u);
}

// 이 학생이 이 교재를 볼 수 있는지: 넣어 준 교재 · 또는 교재 공개 범위가 '모든 회원'/'선택한 학생'에 들어 있으면
export function canSeeBookWith(b, username, access) {
  if (!b || !username) return false;
  if (access && access.books.includes(b.id)) return true;
  return canSeeBook(b, username);
}

// 이 학생이 이 영상을 볼 수 있는지: 영상 공개 범위 규칙 + 넣어 준 영상(🔒 비공개 영상은 넣어 줘도 안 보여요)
export function canSeeVideoWith(v, username, access) {
  if (!v || v.status !== 'ready') return false;
  if (canMemberSee(v, username)) return true;
  return !!(username && access && access.videos.includes(v.id) && v.visibility !== 'draft');
}
