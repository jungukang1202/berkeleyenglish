// 📖 교재 쉐도잉 저장소 — 관리자가 등록한 교재(유닛별 문장)
//   textbooks : `${id}` → { id, title, level, desc, cover(작은 그림 data:URL), color,
//                          units:[{ title, sentences:[{ o, ko }] }], visibility('members'|'assigned'|'draft'), assigned:[아이디], createdAt, updatedAt }
// 회원 연습 기록은 피드백 쉐도잉과 같은 곳에 setId = 'book-교재ID-u유닛번호' 로 쌓여요.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const store = () => getStore({ name: 'textbooks', consistency: 'strong' });
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const VIS = ['draft', 'members', 'assigned'];
const cleanUsers = a => [...new Set((Array.isArray(a) ? a : []).map(u => String(u || '').trim().toLowerCase()).filter(u => /^[\w.-]{1,40}$/.test(u)))].slice(0, 500);
export const unitSetId = (bookId, k) => `book-${bookId}-u${k}`;
export const parseUnitSetId = setId => { const m = /^book-([\w-]{2,64})-u(\d{1,4})$/.exec(String(setId || '')); return m ? { bookId: m[1], unit: Number(m[2]) } : null; };

function cleanUnits(units) {
  return (Array.isArray(units) ? units : []).slice(0, 300).map((u, k) => {
    const out = {
      title: clip(u && u.title, 160).trim() || `Unit ${k + 1}`,
      sentences: (Array.isArray(u && u.sentences) ? u.sentences : []).slice(0, 1000)
        .map(x => { const r = { o: clip(x && x.o, 500).trim(), ko: clip(x && x.ko, 500).trim() }; const xx = clip(x && x.x, 500).trim(); if (xx) r.x = xx; return r; }).filter(x => x.o),
    };
    const words = (Array.isArray(u && u.words) ? u.words : []).map(w => clip(w, 80).trim()).filter(Boolean).slice(0, 300);
    if (words.length) out.words = words;
    return out;
  }).filter(u => u.sentences.length);
}
function cleanCover(c) {
  const s = String(c || '');
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 400000 ? s : '';
}

export function bookSummary(b) {
  return {
    id: b.id, title: b.title, level: b.level || '', desc: b.desc || '', cover: b.cover || '', color: b.color || '',
    unitCount: (b.units || []).length, sentenceCount: (b.units || []).reduce((a, u) => a + u.sentences.length, 0),
    units: (b.units || []).map(u => ({ title: u.title, count: u.sentences.length })),
    visibility: b.visibility, assigned: b.assigned || [], createdAt: b.createdAt, updatedAt: b.updatedAt || null,
  };
}

export function canSeeBook(b, username) {
  if (!b || !username) return false;
  if (b.visibility === 'members') return true;
  if (b.visibility === 'assigned') return (b.assigned || []).includes(String(username).toLowerCase());
  return false;
}

export async function listBooks() {
  const s = store();
  const { blobs } = await s.list();
  const recs = await Promise.all(blobs.map(x => s.get(x.key, { type: 'json' })));
  return recs.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
export async function getBook(id) {
  if (!/^[\w-]{2,64}$/.test(String(id || ''))) return null;
  return await store().get(id, { type: 'json' });
}
export async function saveBook(id, data) {
  const now = new Date().toISOString();
  // data.newId: 다른 사이트에서 옮겨 온 교재는 원래 ID(gp, gn …)를 그대로 써요 (표지 · 색이 ID로 정해져서)
  const newId = !id && /^[\w-]{2,64}$/.test(String(data.newId || '')) ? String(data.newId) : null;
  const old = id ? await getBook(id) : newId ? await getBook(newId) : null;
  if (id && !old) throw new Error('book_not_found');
  const rec = old || { id: newId || crypto.randomUUID(), createdAt: now, assigned: [], visibility: 'members' };
  if (data.title != null) rec.title = clip(data.title, 120).trim() || rec.title || '새 교재';
  if (data.level != null) rec.level = clip(data.level, 20);
  if (data.desc != null) rec.desc = clip(data.desc, 300).trim();
  if (data.color != null) rec.color = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color : '';
  if (data.cover != null) rec.cover = cleanCover(data.cover);
  if (data.units != null) {
    const units = cleanUnits(data.units);
    // 「📚 교재 고치기」 글상자에는 단어 목록이 없어서, 같은 이름의 유닛에 있던 단어는 그대로 남겨요
    units.forEach(u => { if (!u.words) { const ou = (rec.units || []).find(x => x.title === u.title); if (ou && ou.words) u.words = ou.words; } });
    rec.units = units;
  }
  if (data.visibility != null && VIS.includes(data.visibility)) rec.visibility = data.visibility;
  if (data.assigned != null) rec.assigned = cleanUsers(data.assigned);
  if (!rec.title) rec.title = '새 교재';
  if (!rec.units) rec.units = [];
  rec.updatedAt = now;
  await store().setJSON(rec.id, rec);
  return rec;
}
export async function deleteBook(id) { await store().delete(id); }

// 📖 교재쉐도잉 화면(유닛 단위) — 유닛 하나가 피드백 회차 하나와 같은 모양이에요
export function unitList(b) {
  return (b.units || []).map((u, k) => ({ id: unitSetId(b.id, k), title: u.title, sentenceCount: u.sentences.length, wordCount: (u.words || []).length }));
}
export function unitSet(b, k) {
  const u = b && b.units && b.units[k];
  return u ? { id: unitSetId(b.id, k), title: `${b.title} ${u.title}`, book: b.id, sentences: u.sentences.map(s => ({ x: s.x || '', o: s.o, ...(s.ko ? { ko: s.ko } : {}) })), words: u.words || [] } : null;
}

// 📖 교재 표지 그림 파일 (/images/textbooks/파일이름 → /api/textbook-cover) — 여러 교재가 같은 표지를 같이 써요
export const coverStore = () => getStore({ name: 'textbook-covers', consistency: 'strong' });
export const okCoverName = n => /^[\w-]{1,60}\.(png|jpe?g|webp)$/i.test(String(n || ''));
