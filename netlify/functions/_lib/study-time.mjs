// 공부 시간 기록 — 회원이 실제로 연습한 시간(초)을 날짜별 · 종류별(피드백 쉐도잉 / 영상 쉐도잉)로 쌓아요.
//   study-time : `${username}/${YYYY-MM}` → { days: { 'DD': { feedback: 초, video: 초 } }, updatedAt }
// 날짜는 한국 시간(KST) 기준이에요.
import { getStore } from '@netlify/blobs';
import { getSummary } from './practice.mjs';

export const CATS = ['feedback', 'video'];
const store = () => getStore({ name: 'study-time', consistency: 'strong' });
const norm = u => String(u || '').trim().toLowerCase();
export const kstDate = (t = Date.now()) => new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10); // YYYY-MM-DD

export async function addTime(username, cat, sec) {
  const u = norm(username);
  if (!u || !CATS.includes(cat)) return null;
  sec = Math.max(0, Math.min(900, Math.round(Number(sec) || 0))); // 한 번에 15분까지만 (잘못된 값 방지)
  if (!sec) return null;
  const d = kstDate(), key = `${u}/${d.slice(0, 7)}`, day = d.slice(8, 10);
  const s = store();
  const rec = (await s.get(key, { type: 'json' })) || { days: {} };
  const row = rec.days[day] || (rec.days[day] = {});
  row[cat] = (row[cat] || 0) + sec;
  rec.updatedAt = new Date().toISOString();
  await s.setJSON(key, rec);
  return row;
}

const empty = () => ({ feedback: 0, video: 0, total: 0 });
const addRow = (acc, row) => { CATS.forEach(c => { acc[c] += (row && row[c]) || 0; }); acc.total = acc.feedback + acc.video; return acc; };

// 오늘 · 이번 달 · 최근 7일 공부 시간 + 지금까지 듣기/따라 말하기 횟수(1000번 목표용)
export async function timeSummary(username) {
  const u = norm(username);
  const now = Date.now(), today = kstDate(now), month = today.slice(0, 7);
  const prevMonth = kstDate(now - 7 * 86400000).slice(0, 7);
  const s = store();
  const months = { [month]: (await s.get(`${u}/${month}`, { type: 'json' })) || { days: {} } };
  if (prevMonth !== month) months[prevMonth] = (await s.get(`${u}/${prevMonth}`, { type: 'json' })) || { days: {} };
  const rowOf = date => ((months[date.slice(0, 7)] || { days: {} }).days || {})[date.slice(8, 10)];
  const out = { date: today, today: addRow(empty(), rowOf(today)), month: empty(), week: empty(), days: {} };
  Object.values(months[month].days || {}).forEach(r => addRow(out.month, r));
  for (let k = 0; k < 7; k++) { const d = kstDate(now - k * 86400000); const r = rowOf(d); addRow(out.week, r); out.days[d] = addRow(empty(), r); }
  // 지금까지 듣기 · 따라 말하기 횟수 (피드백 쉐도잉 + 영상 쉐도잉 모두)
  const sum = await getSummary(u);
  out.totals = Object.values(sum || {}).reduce((a, x) => { a.listen += (x && x.listen) || 0; a.speak += ((x && x.spoke) || 0) + ((x && x.failed) || 0); return a; }, { listen: 0, speak: 0 });
  return out;
}
