// 수업 피드백 리포트 — 기간별로 모든 회원의 회차(문장/단어)를 모아 정리합니다.
// 매달 1일에는 지난달 리포트를 Netlify Blobs에 따로 보관해서(스냅샷) 나중에 회차가 지워져도 내려받을 수 있습니다.
import { getStore } from '@netlify/blobs';
import { listAllSets, listSetsFull } from './store.mjs';

function reportStore() {
  return getStore({ name: 'feedback-reports', consistency: 'strong' });
}

function kstYmd(iso) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 회차의 수업 날짜: 엔보임에서 가져온 회차는 수업 날짜, 직접 붙여넣은 회차는 등록한 날짜(한국 시간)
export function lessonDateOf(set) {
  const src = set.source || {};
  if (src.date && /^\d{4}-\d{2}-\d{2}$/.test(src.date)) return src.date;
  const m = /\/(\d{4}-\d{2}-\d{2})\//.exec(src.key || '');
  if (m) return m[1];
  return kstYmd(set.createdAt);
}

function clean(s) {
  // 예전 데이터에 남은 x:/o: 접두어 정리
  return String(s || '').trim()
    .replace(/^(?:\[[xow]\]\s*|[xow]\s*[:：\-－]\s*)/i, '')
    .trim();
}

export function toLesson(set) {
  const src = set.source || {};
  return {
    date: lessonDateOf(set),
    username: set.username,
    name: src.name || '',
    nvoimId: src.nvoimId || '',
    title: set.title || '',
    origin: src.type === 'nvoim' ? '엔보임' : '직접 입력',
    sentences: (set.sentences || []).map(s => ({ x: s.hideX ? '' : clean(s.x), o: clean(s.o) })).filter(s => s.o),
    words: (set.words || []).map(clean).filter(Boolean),
  };
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title < b.title ? -1 : 1);

/* ---------- 회원 본인용 ---------- */

// 회원의 월 목록: [{ month, lessons, sentences, words }] (최신 달 먼저)
export async function memberMonths(username) {
  const lessons = (await listSetsFull(username)).map(toLesson).filter(l => l.date);
  const map = new Map();
  lessons.forEach(l => {
    const m = l.date.slice(0, 7);
    const v = map.get(m) || { month: m, lessons: 0, sentences: 0, words: 0 };
    v.lessons++; v.sentences += l.sentences.length; v.words += l.words.length;
    map.set(m, v);
  });
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

// 회원 본인의 기간 리포트
export async function buildMemberReport(username, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('기간을 확인해주세요.');
  const lessons = (await listSetsFull(username)).map(toLesson).filter(l => l.date && l.date >= from && l.date <= to);
  lessons.sort(byDate);
  const name = (lessons.find(l => l.name) || {}).name || '';
  return { username, name, from, to, generatedAt: new Date().toISOString(), lessons };
}

/* ---------- 관리자용(전체) ---------- */

export async function buildReport(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('기간을 확인해주세요.');
  const sets = await listAllSets();
  const lessons = sets.map(toLesson).filter(l => l.date && l.date >= from && l.date <= to);
  // 직접 붙여넣은 회차는 이름이 없으니, 같은 회원의 다른 회차에 있는 이름으로 채움
  const names = {};
  lessons.forEach(l => { if (l.name) names[l.username] = l.name; });
  lessons.forEach(l => { if (!l.name && names[l.username]) l.name = names[l.username]; });
  lessons.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.username < b.username ? -1 : 1));
  return { from, to, generatedAt: new Date().toISOString(), lessons };
}

export function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) throw new Error('월 형식이 올바르지 않아요 (예: 2026-09).');
  const y = Number(m[1]), mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function previousMonthKst() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

// 월별 리포트 보관(스냅샷)
export async function saveMonthlySnapshot(month) {
  const { from, to } = monthRange(month);
  const report = await buildReport(from, to);
  report.month = month;
  await reportStore().setJSON(`monthly/${month}`, report);
  const students = new Set(report.lessons.map(l => l.username)).size;
  const index = (await reportStore().get('index', { type: 'json' })) || {};
  index[month] = { month, generatedAt: report.generatedAt, lessons: report.lessons.length, students };
  await reportStore().setJSON('index', index);
  return index[month];
}

export async function listMonthlySnapshots() {
  const index = (await reportStore().get('index', { type: 'json' })) || {};
  return Object.values(index).sort((a, b) => (a.month < b.month ? 1 : -1));
}

export async function getMonthlySnapshot(month) {
  return await reportStore().get(`monthly/${month}`, { type: 'json' });
}
