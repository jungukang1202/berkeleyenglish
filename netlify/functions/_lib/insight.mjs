// 학습 리포트(분석) — 수업 피드백(회차)과 쉐도잉 연습 기록을 모아 기간별로 분석합니다.
//   - 회원 한 명: 수업 횟수·출결 달력·쉐도잉 평균·월별 추이·자주 틀리는 단어·공부한 문장/단어
//   - 전체 회원: 회원별 요약 표
// 매달 1일에는 지난달 리포트를 회원마다 만들어 'learning-reports' 저장소에 보관합니다(나중에 회차가 지워져도 그대로).
import { getStore } from '@netlify/blobs';
import { listAllSets, listSetsFull, listMembers } from './store.mjs';
import { toLesson } from './report.mjs';

const DAY = 86400000;
const MAX_DAYS = 400;

function reportsStore() { return getStore({ name: 'learning-reports', consistency: 'strong' }); }
function logStore() { return getStore({ name: 'practice-log', consistency: 'strong' }); }

/* ---------------- 날짜 도우미 (한국 시간) ---------------- */
export function kstYmd(iso) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function todayKst() { return kstYmd(new Date().toISOString()); }
function addDays(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY) + 1; }
function monthAdd(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!m) throw new Error('월 형식이 올바르지 않아요 (예: 2026-09).');
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
export function previousMonthKst() { return monthAdd(todayKst().slice(0, 7), -1); }
function checkRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw new Error('기간을 확인해주세요.');
  if (daysBetween(from, to) > MAX_DAYS) throw new Error('기간은 최대 1년(약 400일)까지 정할 수 있어요.');
}

/* ---------------- 데이터 모으기 ---------------- */
async function readAllLogs(prefix) {
  const ls = logStore();
  const { blobs } = await ls.list(prefix ? { prefix } : undefined);
  const out = [];
  for (let i = 0; i < blobs.length; i += 50) {
    const chunk = await Promise.all(blobs.slice(i, i + 50).map(b => ls.get(b.key, { type: 'json' })));
    chunk.forEach(rec => {
      if (!rec) return;
      const username = rec.username || String(rec.key || '').split('/')[0];
      (rec.attempts || []).forEach(a => out.push(Object.assign({ username, setId: rec.setId, day: kstYmd(a.at) }, a)));
    });
  }
  return out;
}

// 회원 한 명 분석에 필요한 것 전부(회차 + 연습 기록)
async function loadMember(username) {
  const uname = String(username || '').trim().toLowerCase();
  const [sets, attempts] = await Promise.all([listSetsFull(uname), readAllLogs(`${uname}/`)]);
  return { username: uname, sets, attempts };
}
// 전체 회원 분석용(한 번에 읽어서 회원별로 나눔)
async function loadEveryone() {
  const [members, sets, attempts] = await Promise.all([listMembers(), listAllSets(), readAllLogs('')]);
  const by = new Map();
  members.forEach(m => by.set(m.username, { username: m.username, sets: [], attempts: [] }));
  const get = u => { if (!by.has(u)) by.set(u, { username: u, sets: [], attempts: [] }); return by.get(u); };
  sets.forEach(s => get(s.username).sets.push(s));
  attempts.forEach(a => get(a.username).attempts.push(a));
  return [...by.values()];
}

/* ---------------- 단어 비교 (회원 화면의 일치도 계산과 같은 방식) ---------------- */
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, '').split(/\s+/).filter(Boolean);
const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'i', 'is', 'it', 'in', 'on', 'at', 'and', 'or', 'for', 'you', 'my', 'me', 'be', 'am', 'are', 'was', 'do', 'so', 'we', 'he', 'she', 'they', 'this', 'that', 'with', 'by', 'as', 'if', 'but', 'its', "it's", "i'm"]);
function missedWords(target, heard) {
  const tw = norm(target), hw = norm(heard);
  const dp = Array.from({ length: tw.length + 1 }, () => new Array(hw.length + 1).fill(0));
  for (let i = tw.length - 1; i >= 0; i--)
    for (let j = hw.length - 1; j >= 0; j--)
      dp[i][j] = tw[i] === hw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const missed = []; let i = 0, j = 0;
  while (i < tw.length && j < hw.length) {
    if (tw[i] === hw[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { missed.push(tw[i]); i++; }
    else j++;
  }
  while (i < tw.length) missed.push(tw[i++]);
  return { all: tw, missed };
}

/* ---------------- 통계 ---------------- */
function newAgg() { return { spoke: 0, listen: 0, failed: 0, scoreSum: 0, best: 0, last: null }; }
function addAgg(s, a) {
  if (a.mode === 'listen') s.listen++;
  else if (a.ok) { s.spoke++; s.scoreSum += a.score || 0; if ((a.score || 0) > s.best) s.best = a.score || 0; }
  else s.failed++;
  if (!s.last || a.at > s.last) s.last = a.at;
}
function finishAgg(s) {
  const out = { spoke: s.spoke, listen: s.listen, failed: s.failed, best: s.best, last: s.last, avg: s.spoke ? Math.round(s.scoreSum / s.spoke) : null };
  out.total = s.spoke + s.listen + s.failed;
  return out;
}
const itemKey = (type, text) => `${type === 'word' ? 'word' : 'sentence'}|${String(text || '').trim().toLowerCase()}`;

function lessonsOf(data) {
  return data.sets.map(s => Object.assign(toLesson(s), { id: s.id })).filter(l => l.date);
}

function summarizePeriod(lessons, attempts, from, to) {
  const ls = lessons.filter(l => l.date >= from && l.date <= to);
  const at = attempts.filter(a => a.day >= from && a.day <= to);
  const agg = newAgg(); at.forEach(a => addAgg(agg, a));
  const f = finishAgg(agg);
  return {
    lessons: ls.length,
    lessonDays: new Set(ls.map(l => l.date)).size,
    sentences: ls.reduce((n, l) => n + l.sentences.length, 0),
    words: ls.reduce((n, l) => n + l.words.length, 0),
    practiceDays: new Set(at.map(a => a.day)).size,
    spoke: f.spoke, listen: f.listen, failed: f.failed, avg: f.avg, best: f.best,
    practicedItems: new Set(at.map(a => itemKey(a.type, a.target))).size,
  };
}

// 회원 한 명의 기간 분석
function analyzeStudent(data, from, to) {
  const lessons = lessonsOf(data);
  const attempts = data.attempts;
  const name = (lessons.find(l => l.name) || {}).name || '';

  const kpi = summarizePeriod(lessons, attempts, from, to);
  const n = daysBetween(from, to);
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -n);
  const prev = summarizePeriod(lessons, attempts, prevFrom, prevTo);

  // 문장·단어별 누적 연습(지금까지 전체) + 이 기간 연습
  const cum = new Map(), inPeriod = new Map();
  attempts.forEach(a => {
    if (a.type === 'variant') return;
    const k = itemKey(a.type, a.target);
    if (!cum.has(k)) cum.set(k, newAgg());
    addAgg(cum.get(k), a);
    if (a.day >= from && a.day <= to) { if (!inPeriod.has(k)) inPeriod.set(k, newAgg()); addAgg(inPeriod.get(k), a); }
  });
  const statOf = (type, text) => { const c = cum.get(itemKey(type, text)); return c ? finishAgg(c) : null; };

  const periodLessons = lessons.filter(l => l.date >= from && l.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(l => ({
      date: l.date, title: l.title, origin: l.origin,
      sentences: l.sentences.map(s => ({ x: s.x, o: s.o, practice: statOf('sentence', s.o) })),
      words: l.words.map(w => ({ w, practice: statOf('word', w) })),
    }));

  // 날짜별(출결 달력·일별 그래프)
  const days = {};
  const day = d => (days[d] = days[d] || { lessons: 0, titles: [], spoke: 0, listen: 0, failed: 0, scoreSum: 0 });
  lessons.forEach(l => { if (l.date >= from && l.date <= to) { const d = day(l.date); d.lessons++; d.titles.push(l.title); } });
  attempts.forEach(a => {
    if (a.day < from || a.day > to) return;
    const d = day(a.day);
    if (a.mode === 'listen') d.listen++; else if (a.ok) { d.spoke++; d.scoreSum += a.score || 0; } else d.failed++;
  });
  Object.values(days).forEach(d => { d.avg = d.spoke ? Math.round(d.scoreSum / d.spoke) : null; delete d.scoreSum; });

  // 월별 추이: 기간이 두 달 이하이면 끝 달까지 최근 6개월, 그보다 길면 기간 안의 달들
  const endMonth = to.slice(0, 7), startMonth = from.slice(0, 7);
  let months = [];
  if (monthAdd(startMonth, 1) >= endMonth) for (let i = 5; i >= 0; i--) months.push(monthAdd(endMonth, -i));
  else for (let m = startMonth; m <= endMonth; m = monthAdd(m, 1)) months.push(m);
  const history = months.map(m => {
    const r = monthRange(m);
    const s = summarizePeriod(lessons, attempts, r.from, r.to);
    return { month: m, lessons: s.lessons, practiceDays: s.practiceDays, spoke: s.spoke, avg: s.avg };
  });

  // 자주 놓치는 단어(이 기간 따라 말하기에서 빠뜨린 단어)
  const seen = new Map(), miss = new Map();
  attempts.forEach(a => {
    if (a.day < from || a.day > to || a.mode !== 'mic' || !a.ok) return;
    const { all, missed } = missedWords(a.target, a.heard);
    new Set(all).forEach(w => seen.set(w, (seen.get(w) || 0) + 1));
    missed.forEach(w => miss.set(w, (miss.get(w) || 0) + 1));
  });
  const weakWords = [...miss.entries()]
    .filter(([w]) => !STOP.has(w) && w.length > 1)
    .map(([w, m]) => ({ word: w, missed: m, seen: seen.get(w) || m, rate: Math.round((m / (seen.get(w) || m)) * 100) }))
    .sort((a, b) => b.missed - a.missed || b.rate - a.rate)
    .slice(0, 10);

  // 이 기간 가장 많이 연습한 문장·단어
  const topPracticed = [...inPeriod.entries()].map(([k, s]) => {
    const f = finishAgg(s); const [type] = k.split('|');
    const sample = attempts.find(a => itemKey(a.type, a.target) === k);
    return { type, text: sample ? sample.target : k.slice(k.indexOf('|') + 1), ...f };
  }).sort((a, b) => b.total - a.total).slice(0, 5);

  // 이 기간에 예전 수업 내용을 복습한 횟수
  const lessonDateById = new Map(lessons.map(l => [l.id, l.date]));
  const review = attempts.filter(a => a.day >= from && a.day <= to && (lessonDateById.get(a.setId) || '9999') < from).length;

  // 수업 요일
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  periodLessons.forEach(l => { weekdays[new Date(l.date + 'T00:00:00Z').getUTCDay()]++; });

  return {
    kind: 'student', username: data.username, name, from, to,
    prevFrom, prevTo, generatedAt: new Date().toISOString(), complete: to < todayKst(),
    kpi, prev, days, history, weakWords, topPracticed, review, weekdays, lessons: periodLessons,
  };
}

function analyzeOverview(all, from, to) {
  const rows = all.map(data => {
    const lessons = lessonsOf(data);
    const s = summarizePeriod(lessons, data.attempts, from, to);
    const name = (lessons.find(l => l.name) || {}).name || '';
    const lastAt = data.attempts.filter(a => a.day <= to).reduce((m, a) => (!m || a.at > m ? a.at : m), null);
    return { username: data.username, name, ...s, lastPractice: lastAt };
  });
  rows.sort((a, b) => b.lessons - a.lessons || (a.username < b.username ? -1 : 1));
  const total = rows.reduce((t, r) => ({
    lessons: t.lessons + r.lessons, spoke: t.spoke + r.spoke, scoreSum: t.scoreSum + (r.avg || 0) * r.spoke,
    activeStudents: t.activeStudents + (r.lessons ? 1 : 0), practicingStudents: t.practicingStudents + (r.practiceDays ? 1 : 0),
  }), { lessons: 0, spoke: 0, scoreSum: 0, activeStudents: 0, practicingStudents: 0 });
  total.avg = total.spoke ? Math.round(total.scoreSum / total.spoke) : null; delete total.scoreSum;
  return { kind: 'overview', from, to, generatedAt: new Date().toISOString(), complete: to < todayKst(), total, members: rows };
}

/* ---------------- 공개 함수 ---------------- */

// 회원 본인/관리자: 기간 분석. month가 지난달 이전이고 보관본이 있으면 보관본을 돌려줍니다.
export async function studentReport(username, { month, from, to } = {}) {
  if (month) {
    const saved = await reportsStore().get(`monthly/${month}/${String(username).toLowerCase()}`, { type: 'json' });
    if (saved) return saved;
    ({ from, to } = monthRange(month));
  }
  checkRange(from, to);
  const r = analyzeStudent(await loadMember(username), from, to);
  if (month) r.month = month;
  return r;
}

export async function overviewReport({ month, from, to } = {}) {
  if (month) {
    const saved = await reportsStore().get(`monthly/${month}/_all`, { type: 'json' });
    if (saved) return saved;
    ({ from, to } = monthRange(month));
  }
  checkRange(from, to);
  const r = analyzeOverview(await loadEveryone(), from, to);
  if (month) r.month = month;
  return r;
}

// 고를 수 있는 달 목록(수업이나 연습 기록이 있는 달 + 이번 달), 최신 달 먼저
export async function studentMonths(username) {
  const data = await loadMember(username);
  const set = new Set([todayKst().slice(0, 7)]);
  lessonsOf(data).forEach(l => set.add(l.date.slice(0, 7)));
  data.attempts.forEach(a => a.day && set.add(a.day.slice(0, 7)));
  const index = (await reportsStore().get('index', { type: 'json' })) || {};
  return [...set].sort().reverse().map(m => ({ month: m, saved: !!(index[m] && index[m].students && index[m].students.includes(data.username)) }));
}

export async function savedMonths() {
  const index = (await reportsStore().get('index', { type: 'json' })) || {};
  return Object.values(index).map(v => ({ month: v.month, generatedAt: v.generatedAt, count: (v.students || []).length })).sort((a, b) => (a.month < b.month ? 1 : -1));
}

// 매달 1일: 지난달 리포트를 회원마다 만들어 보관
export async function saveMonthlyReports(month) {
  const { from, to } = monthRange(month);
  const all = await loadEveryone();
  const store = reportsStore();
  const students = [];
  for (const data of all) {
    const r = analyzeStudent(data, from, to);
    if (!r.kpi.lessons && !r.kpi.practiceDays) continue; // 그 달에 수업도 연습도 없으면 건너뜀
    r.month = month; r.saved = true;
    await store.setJSON(`monthly/${month}/${data.username}`, r);
    students.push(data.username);
  }
  const ov = analyzeOverview(all, from, to); ov.month = month; ov.saved = true;
  await store.setJSON(`monthly/${month}/_all`, ov);
  const index = (await store.get('index', { type: 'json' })) || {};
  index[month] = { month, generatedAt: new Date().toISOString(), students };
  await store.setJSON('index', index);
  return { month, students: students.length };
}
