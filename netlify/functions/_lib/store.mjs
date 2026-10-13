// Netlify Blobs 기반 저장소 — 회원 계정(아이디/비번)과 회원별 쉐도잉 세트(회차별 문장/단어)를 저장합니다.
// 별도 DB 없이 Netlify가 제공하는 Blobs 스토리지만 사용합니다(같은 사이트에 자동으로 연결됨).
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.mjs';

function membersStore() {
  return getStore({ name: 'shadowing-members', consistency: 'strong' });
}
function setsStore() {
  return getStore({ name: 'shadowing-sets', consistency: 'strong' });
}

function normUsername(u) {
  return String(u || '').trim().toLowerCase();
}

/* ===================== 회원(멤버) ===================== */

export async function listMembers() {
  const store = membersStore();
  const { blobs } = await store.list();
  // ⚠️ Netlify Blobs의 list()는 각 항목의 metadata를 함께 돌려주지 않아서(키/etag만 옴),
  // 회원마다 실제 레코드를 따로 읽어와야 가입일 등을 정확히 알 수 있습니다.
  const records = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  const out = records
    .filter(Boolean)
    .map(r => ({ username: r.username, createdAt: r.createdAt || null }));
  out.sort((a, b) => (a.username < b.username ? -1 : 1));
  return out;
}

export async function getMember(username) {
  const store = membersStore();
  return await store.get(normUsername(username), { type: 'json' });
}

export async function createMember(username, password) {
  const uname = normUsername(username);
  if (!uname) throw new Error('username_required');
  if (!password || String(password).length < 4) throw new Error('password_too_short');
  const store = membersStore();
  const existing = await store.get(uname, { type: 'json' });
  if (existing) throw new Error('username_taken');
  const createdAt = new Date().toISOString();
  await store.setJSON(uname, { username: uname, passwordHash: hashPassword(password), createdAt }, { metadata: { createdAt } });
  return { username: uname, createdAt };
}

export async function resetMemberPassword(username, password) {
  const uname = normUsername(username);
  if (!password || String(password).length < 4) throw new Error('password_too_short');
  const store = membersStore();
  const existing = await store.get(uname, { type: 'json' });
  if (!existing) throw new Error('member_not_found');
  existing.passwordHash = hashPassword(password);
  await store.setJSON(uname, existing, { metadata: { createdAt: existing.createdAt } });
  return { username: uname };
}

export async function deleteMember(username) {
  const uname = normUsername(username);
  const store = membersStore();
  await store.delete(uname);
  // 그 회원의 쉐도잉 세트도 함께 정리합니다.
  const sStore = setsStore();
  const { blobs } = await sStore.list({ prefix: `${uname}/` });
  await Promise.all(blobs.map(b => sStore.delete(b.key)));
}

export async function verifyMemberLogin(username, password) {
  const uname = normUsername(username);
  const store = membersStore();
  const record = await store.get(uname, { type: 'json' });
  if (!record) return false;
  return verifyPassword(password, record.passwordHash);
}

/* ===================== 쉐도잉 세트(회차별 문장/단어) ===================== */

export async function createSet(username, { title, sentences, words, source }) {
  const uname = normUsername(username);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const data = {
    id,
    username: uname,
    title: title && title.trim() ? title.trim() : `${createdAt.slice(0, 10)} 수업`,
    createdAt,
    sentences: Array.isArray(sentences) ? sentences : [],
    words: Array.isArray(words) ? words : [],
  };
  if (source) data.source = source; // 예: { type:'nvoim', key } — 엔보임 자동 가져오기로 만든 회차 표시
  const store = setsStore();
  await store.setJSON(`${uname}/${id}`, data, {
    metadata: { title: data.title, createdAt, sentenceCount: data.sentences.length, wordCount: data.words.length },
  });
  return data;
}

export async function updateSet(username, id, { title, sentences, words, source }) {
  const uname = normUsername(username);
  const store = setsStore();
  const key = `${uname}/${id}`;
  const existing = await store.get(key, { type: 'json' });
  if (!existing) throw new Error('set_not_found');
  const updated = {
    ...existing,
    title: title && title.trim() ? title.trim() : existing.title,
    sentences: Array.isArray(sentences) ? sentences : existing.sentences,
    words: Array.isArray(words) ? words : existing.words,
    updatedAt: new Date().toISOString(),
  };
  if (source) updated.source = source;
  await store.setJSON(key, updated, {
    metadata: { title: updated.title, createdAt: updated.createdAt, sentenceCount: updated.sentences.length, wordCount: updated.words.length },
  });
  return updated;
}

export async function deleteSet(username, id) {
  const uname = normUsername(username);
  const store = setsStore();
  await store.delete(`${uname}/${id}`);
}

// 회차의 수업 날짜(YYYY-MM-DD, 한국 시간): 엔보임에서 가져온 회차는 수업일, 직접 붙여넣은 회차는 등록일
export function lessonDateOfSet(r) {
  const src = (r && r.source) || {};
  if (src.date && /^\d{4}-\d{2}-\d{2}$/.test(src.date)) return src.date;
  const m = /\/(\d{4}-\d{2}-\d{2})\//.exec(src.key || '');
  if (m) return m[1];
  if (!r || !r.createdAt) return '';
  const created = new Date(new Date(r.createdAt).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 손으로 붙여넣은 회차: 제목 앞의 "4/2", "04/02", "4.2" 같은 날짜를 수업일로 봅니다(연도는 등록한 해, 등록일보다 뒤면 작년).
  const t = /^\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?!\d)/.exec(r.title || '');
  if (t) {
    const mo = Number(t[1]), d = Number(t[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let y = Number(created.slice(0, 4));
      let ymd = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (ymd > created) ymd = `${y - 1}-${ymd.slice(5)}`;
      return ymd;
    }
  }
  return created;
}

export async function listSets(username) {
  const uname = normUsername(username);
  const store = setsStore();
  const { blobs } = await store.list({ prefix: `${uname}/` });
  // ⚠️ list()는 metadata를 함께 돌려주지 않으므로, 세트마다 실제 레코드를 따로 읽어서
  // 제목/문장수/단어수/등록일을 정확히 계산합니다.
  const records = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  const out = records
    .filter(Boolean)
    .map(r => ({
      id: r.id,
      title: r.title || '(제목 없음)',
      createdAt: r.createdAt || null,
      sentenceCount: Array.isArray(r.sentences) ? r.sentences.length : 0,
      wordCount: Array.isArray(r.words) ? r.words.length : 0,
      lessonDate: lessonDateOfSet(r),
    }));
  // 최근 수업이 위로: 수업 날짜(엔보임에서 가져온 회차는 실제 수업일) → 같은 날이면 나중에 등록한 것이 위
  out.sort((a, b) => (a.lessonDate < b.lessonDate ? 1 : a.lessonDate > b.lessonDate ? -1 : new Date(b.createdAt) - new Date(a.createdAt)));
  return out;
}

export async function getSet(username, id) {
  const uname = normUsername(username);
  const store = setsStore();
  return await store.get(`${uname}/${id}`, { type: 'json' });
}

// 리포트용: 모든 회원의 회차를 한 번에 읽어옵니다(문장/단어 포함).
export async function listAllSets() {
  const store = setsStore();
  const { blobs } = await store.list();
  const out = [];
  // 한꺼번에 너무 많이 요청하지 않도록 50개씩 나눠서 읽기
  for (let i = 0; i < blobs.length; i += 50) {
    const chunk = await Promise.all(blobs.slice(i, i + 50).map(b => store.get(b.key, { type: 'json' })));
    chunk.forEach(r => { if (r) out.push(r); });
  }
  return out;
}

// 한 회원의 회차 전체(문장/단어 포함)
export async function listSetsFull(username) {
  const uname = normUsername(username);
  const store = setsStore();
  const { blobs } = await store.list({ prefix: `${uname}/` });
  const records = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  return records.filter(Boolean);
}
