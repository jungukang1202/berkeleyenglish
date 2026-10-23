// 영상 쉐도잉 저장소 — 관리자가 올린 영상(조각으로 나눠 저장)과, 자동으로 만든 문장 스크립트를 보관합니다.
//   video-lessons : `${id}`              → { id, title, status, visibility, mime, size, chunkSize, chunks, duration,
//                                             partMinutes, sentences:[{s,e,en,ko}], createdAt, updatedAt }
//   video-chunks  : `${id}/${00000}`     → 영상 파일의 n번째 조각(바이너리, CHUNK_SIZE 바이트)
// Netlify 함수는 한 번에 6MB까지만 주고받을 수 있어서, 영상을 3.5MB 조각으로 나눠 올리고/보냅니다.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const CHUNK_SIZE = 3.5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1GB
// assigned = 선택한 학생만 (관리자 「영상쉐도잉 기록」에서 학생마다 넣어주기)
const VISIBILITY = ['draft', 'members', 'public', 'assigned'];
const cleanUsers = a => [...new Set((Array.isArray(a) ? a : []).map(u => String(u || '').trim().toLowerCase()).filter(u => /^[\w.-]{1,40}$/.test(u)))].slice(0, 500);

// 회원(또는 로그인 안 한 손님)이 이 영상을 볼 수 있는지 — 목록 · 연습 기록 · 공부 표시 모두 같은 규칙
export function canMemberSee(v, username) {
  if (!v || v.status !== 'ready') return false;
  if (v.visibility === 'public') return true;
  if (!username) return false;
  if (v.visibility === 'members') return true;
  if (v.visibility === 'assigned') return (v.assigned || []).includes(String(username).toLowerCase());
  return false;
}
// 레벨: 관리자가 영상마다 정하고, 학생은 자기 레벨만 골라 봅니다. ('' = 레벨 미지정)
// 'kids' = 유아 레벨: 쉐도잉 없이 영상만 보여줘요 (watchOnly)
export const LEVELS = ['kids', '1-2', '3-4', '5-6', '7-9'];
const cleanLevel = x => (LEVELS.includes(String(x)) ? String(x) : '');

export function lessonsStore() { return getStore({ name: 'video-lessons', consistency: 'strong' }); }
export function chunksStore() { return getStore({ name: 'video-chunks', consistency: 'strong' }); }

export function chunkKey(id, n) { return `${id}/${String(n).padStart(5, '0')}`; }

function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }
function num(x, d = 0) { const v = Number(x); return Number.isFinite(v) ? v : d; }

// 브라우저에서 온 문장 목록을 안전한 모양으로 정리
export function cleanSentences(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5000).map(x => ({
    s: Math.max(0, Math.round(num(x && x.s) * 100) / 100),
    e: Math.max(0, Math.round(num(x && x.e) * 100) / 100),
    en: clip(x && x.en, 1000).trim(),
    ko: clip(x && x.ko, 1000).trim(),
  })).filter(x => x.en && x.e > x.s).sort((a, b) => a.s - b.s);
}

// 원래 자막(단어별 시간) 보관 — '문장 다시 나누기'가 자막 서비스(Supadata)를 다시 쓰지 않도록
//   raw: { words:[[단어, 시작, 끝, 표시(1=자막 줄 끝, 2=말하는 사람 바뀜)]…], punctuated, kind }
export function cleanRaw(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.words) || !raw.words.length) return null;
  const words = raw.words.slice(0, 20000).map(x => Array.isArray(x)
    ? [clip(x[0], 60), Math.round(num(x[1]) * 100) / 100, Math.round(num(x[2]) * 100) / 100, Math.max(0, Math.min(3, Math.floor(num(x[3]))))]
    : null).filter(x => x && x[0]);
  if (!words.length) return null;
  return { words, punctuated: !!raw.punctuated, kind: clip(raw.kind, 20) };
}

// 목록에 보여줄 요약
export function summary(v) {
  return {
    id: v.id, title: v.title, status: v.status, visibility: v.visibility,
    duration: v.duration || 0, size: v.size || 0, mime: v.mime,
    sentenceCount: Array.isArray(v.sentences) ? v.sentences.length : 0,
    partMinutes: v.partMinutes ?? 1, partSentences: v.partSentences || 0, createdAt: v.createdAt, updatedAt: v.updatedAt || null,
    level: v.level || '', description: v.description || '',
    youtubeId: v.youtubeId || null, clipStart: v.clipStart || 0, clipEnd: v.clipEnd || 0,
    watchOnly: !!v.watchOnly, // 유아용: 문장·쉐도잉 없이 영상만
    hasRaw: !!(v.raw && v.raw.words && v.raw.words.length), // 원래 자막을 보관하고 있는지
    assigned: v.assigned || [], // visibility가 assigned일 때 볼 수 있는 학생
    caption: (v.captionTrack && v.captionTrack.kind) || '', // human(사람이 만든 자막) · auto(자동 자막) · ai(AI 받아쓰기)
  };
}

// YouTube 링크형 레슨: 영상 파일은 저장하지 않고 YouTube 플레이어로 재생합니다.
export async function createYoutubeLesson({ youtubeId, title, duration, sentences, partMinutes, partSentences, visibility, clipStart, clipEnd, description, track, level, watchOnly, raw }) {
  if (!/^[\w-]{11}$/.test(String(youtubeId || ''))) throw new Error('bad_youtube_id');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const rec = {
    id, youtubeId, title: clip(title, 120).trim() || `${now.slice(0, 10)} YouTube`,
    status: 'ready', visibility: VISIBILITY.includes(visibility) ? visibility : 'members',
    mime: 'video/youtube', size: 0, chunks: 0, duration: Math.max(0, num(duration)),
    clipStart: Math.max(0, num(clipStart)), clipEnd: Math.max(0, num(clipEnd)),
    partMinutes: Math.max(0, Math.min(30, num(partMinutes, 1))), sentences: cleanSentences(sentences),
    partSentences: Math.max(0, Math.min(200, Math.floor(num(partSentences, 0)))), // 0이 아니면 '몇 문장씩'으로 파트 나누기
    description: clip(description, 500).trim(), level: cleanLevel(level),
    captionTrack: track && typeof track === 'object' ? { lang: clip(track.lang, 20), kind: clip(track.kind, 20) } : null,
    watchOnly: !!watchOnly, raw: watchOnly ? null : cleanRaw(raw), createdAt: now,
  };
  if (rec.watchOnly) { rec.sentences = []; rec.partMinutes = 0; rec.captionTrack = null; }
  else if (!rec.sentences.length) throw new Error('no_sentences');
  await lessonsStore().setJSON(id, rec);
  return rec;
}

export async function listLessons() {
  const store = lessonsStore();
  const { blobs } = await store.list();
  const recs = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  return recs.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getLesson(id) {
  if (!id || !/^[\w-]{8,64}$/.test(id)) return null;
  return await lessonsStore().get(id, { type: 'json' });
}

export async function createLesson({ title, mime, size, duration }) {
  size = Math.floor(num(size));
  if (!size || size <= 0) throw new Error('size_required');
  if (size > MAX_VIDEO_BYTES) throw new Error('file_too_large');
  mime = clip(mime || 'video/mp4', 80);
  if (!/^(video|audio)\//.test(mime)) throw new Error('unsupported_type');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const rec = {
    id, title: clip(title, 120).trim() || `${now.slice(0, 10)} 영상`,
    status: 'uploading', visibility: 'draft', mime, size,
    chunkSize: CHUNK_SIZE, chunks: Math.ceil(size / CHUNK_SIZE), uploaded: 0,
    duration: Math.max(0, num(duration)), partMinutes: 1, sentences: [],
    level: '', description: '', createdAt: now,
  };
  await lessonsStore().setJSON(id, rec);
  return rec;
}

export async function putChunk(id, n, buf) {
  const rec = await getLesson(id);
  if (!rec) throw new Error('lesson_not_found');
  n = Math.floor(num(n, -1));
  if (n < 0 || n >= rec.chunks) throw new Error('bad_chunk_index');
  const expected = n === rec.chunks - 1 ? rec.size - n * rec.chunkSize : rec.chunkSize;
  if (buf.byteLength !== expected) throw new Error(`bad_chunk_size(${buf.byteLength}/${expected})`);
  await chunksStore().set(chunkKey(id, n), buf);
  return { ok: true };
}

export async function updateLesson(id, patch) {
  const store = lessonsStore();
  const rec = await store.get(id, { type: 'json' });
  if (!rec) throw new Error('lesson_not_found');
  if (patch.title != null) rec.title = clip(patch.title, 120).trim() || rec.title;
  if (patch.description != null) rec.description = clip(patch.description, 500).trim();
  if (patch.level != null) rec.level = cleanLevel(patch.level);
  if (patch.visibility != null && VISIBILITY.includes(patch.visibility)) rec.visibility = patch.visibility;
  if (patch.partMinutes != null) rec.partMinutes = Math.max(0, Math.min(30, num(patch.partMinutes, 1)));
  if (patch.partSentences != null) rec.partSentences = Math.max(0, Math.min(200, Math.floor(num(patch.partSentences, 0))));
  if (patch.duration != null && num(patch.duration) > 0) rec.duration = num(patch.duration);
  if (patch.clipStart != null) rec.clipStart = Math.max(0, num(patch.clipStart));
  if (patch.clipEnd != null) rec.clipEnd = Math.max(0, num(patch.clipEnd));
  if (patch.track && typeof patch.track === 'object') rec.captionTrack = { lang: clip(patch.track.lang, 20), kind: clip(patch.track.kind, 20) };
  if (patch.watchOnly != null) rec.watchOnly = !!patch.watchOnly;
  if (patch.raw != null) rec.raw = cleanRaw(patch.raw);
  if (patch.assigned != null) rec.assigned = cleanUsers(patch.assigned);
  if (patch.sentences != null) rec.sentences = rec.watchOnly ? [] : cleanSentences(patch.sentences);
  if (patch.status === 'ready') {
    // 모든 조각이 올라왔는지 확인한 뒤에만 '준비됨'으로 바꿉니다.
    const { blobs } = await chunksStore().list({ prefix: `${id}/` });
    if (blobs.length < rec.chunks) throw new Error(`upload_incomplete(${blobs.length}/${rec.chunks})`);
    rec.status = 'ready';
  }
  rec.updatedAt = new Date().toISOString();
  await store.setJSON(id, rec);
  return rec;
}

export async function deleteLesson(id) {
  const cs = chunksStore();
  const { blobs } = await cs.list({ prefix: `${id}/` });
  for (let i = 0; i < blobs.length; i += 20) {
    await Promise.all(blobs.slice(i, i + 20).map(b => cs.delete(b.key)));
  }
  await lessonsStore().delete(id);
}
