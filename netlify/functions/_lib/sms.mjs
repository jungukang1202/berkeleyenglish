// 📱 학원 휴대폰으로 문자 보내기 (운영자 지시 2026-11-28)
// 학원 안드로이드 휴대폰에 「SMS Gateway」 앱(sms-gate.app)을 깔아 두면, 사이트가 그 휴대폰에 "이 번호로 이 문자 보내"라고 시켜요.
// 휴대폰이 진짜 문자로 학생에게 보내요(학원 휴대폰 번호로 감, 문자 무제한 요금제면 무료).
//
// 사이트 설정(Netlify 환경 변수):
//   SMSGATE_USER, SMSGATE_PASS  — 앱의 Cloud Server 칸에 나오는 Username · Password (꼭 필요)
//   SMSGATE_PASSPHRASE          — (선택) 앱 설정 → Encryption에 넣은 암호. 넣으면 번호·내용을 암호화해서 중계 서버도 못 봐요
//   SMSGATE_URL                 — (선택) 기본 https://api.sms-gate.app/3rdparty/v1
//
// 저장소 sms:
//   'phones'          → { 아이디: { phone, on } }        학생 전화번호 · 자동 문자 받기
//   'settings'        → { daily: { on, hour, days, text } }
//   'sent/YYYY-MM-DD' → { 아이디: 보낸 시각 }             (같은 날 두 번 안 보내게)
//   'log'             → [{ at, kind, to, phone, text, id, state }]  (최근 150건)
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { listMembers, memberDisplayName, listSets, getSet, lessonDateOfSet } from './store.mjs';
import { getSummary } from './practice.mjs';
import { getAccess, canSeeVideoWith } from './access.mjs';
import { listLessons } from './videos.mjs';
import { recordingLessonIds } from './nvoim-video.mjs';

const store = () => getStore({ name: 'sms', consistency: 'strong' });
const norm = u => String(u || '').trim().toLowerCase();
export const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
export const kstDate = () => kstNow().toISOString().slice(0, 10);
const API = () => (process.env.SMSGATE_URL || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/+$/, '');

export const DEFAULT_TEXT = '[버클리] #{이름} 학생, #{안내} berkeleyenglish.co.kr/member';
const OLD_DEFAULT_TEXTS = [
  '[버클리] #{이름} 학생, 오늘 쉐도잉 아직 안 했어요! 5분만 해 볼까요? berkeleyenglish.co.kr/member',
  '[버클리] #{이름} 학생, #{수업날짜} 수업 피드백 쉐도잉을 아직 안 했어요! 5분만 복습해 볼까요? berkeleyenglish.co.kr/member',
];
export const LESSON_DAYS = 7; // 최근 며칠 안의 수업을 챙길지
export const DEFAULT_SETTINGS = { daily: { on: false, hour: 20, days: 'all', text: DEFAULT_TEXT, video: true, lessonVideo: true }, notify: { on: false, phone: '' } };
export const NOTIFY_FROM = 9, NOTIFY_TO = 22; // 원장님 알림은 오전 9시 ~ 오후 10시에만 (그 밖의 시간은 모아 두었다가 아침에)

export const configured = () => !!(process.env.SMSGATE_USER && process.env.SMSGATE_PASS);

/* ---------- 전화번호 ---------- */
// 010-1234-5678 · 01012345678 · +82 10 1234 5678 → +821012345678
export function toE164(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('82')) d = '0' + d.slice(2);
  if (!/^01[016789]\d{7,8}$/.test(d)) return '';
  return '+82' + d.slice(1);
}
export const prettyPhone = e => { const d = String(e || '').replace(/^\+82/, '0'); return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d; };

export async function getPhones() { return (await store().get('phones', { type: 'json' })) || {}; }
export async function savePhones(map) {
  const out = {}, bad = [];
  for (const [u, v] of Object.entries(map || {})) {
    const raw = v && typeof v === 'object' ? v.phone : v;
    if (!String(raw || '').trim()) continue;
    const e = toE164(raw);
    if (!e) { bad.push(u); continue; }
    out[norm(u)] = { phone: e, on: !(v && v.on === false) };
  }
  if (bad.length) { const err = new Error(`전화번호가 이상해요: ${bad.join(', ')} (010으로 시작하는 휴대폰 번호만 돼요)`); err.status = 400; throw err; }
  await store().setJSON('phones', out);
  return out;
}

/* ---------- 설정 ---------- */
export async function getSettings() {
  const r = (await store().get('settings', { type: 'json' })) || {};
  const daily = Object.assign({}, DEFAULT_SETTINGS.daily, r.daily || {});
  if (OLD_DEFAULT_TEXTS.includes(daily.text)) daily.text = DEFAULT_TEXT; // 기준이 바뀌어서 예전 기본 문구는 새 기본 문구로
  const notify = Object.assign({}, DEFAULT_SETTINGS.notify, r.notify || {});
  return { daily, notify };
}
export async function saveSettings(b) {
  const cur = await getSettings(), d = (b && b.daily) || {};
  const hour = Math.round(Number(d.hour));
  const n = (b && b.notify) || {};
  let nPhone = cur.notify.phone;
  if (n.phone !== undefined) {
    nPhone = String(n.phone || '').trim() ? toE164(n.phone) : '';
    if (String(n.phone || '').trim() && !nPhone) { const e = new Error('원장님 휴대폰 번호가 이상해요 (010으로 시작하는 번호)'); e.status = 400; throw e; }
  }
  const next = { daily: {
    on: d.on === undefined ? cur.daily.on : !!d.on,
    hour: hour >= 6 && hour <= 23 ? hour : cur.daily.hour,
    days: ['all', 'weekdays', 'mon-sat'].includes(d.days) ? d.days : cur.daily.days,
    text: String(d.text == null ? cur.daily.text : d.text).replace(/\s+/g, ' ').trim().slice(0, 300) || DEFAULT_TEXT,
    video: d.video === undefined ? cur.daily.video : !!d.video,
    lessonVideo: d.lessonVideo === undefined ? cur.daily.lessonVideo : !!d.lessonVideo,
  }, notify: {
    on: n.on === undefined ? cur.notify.on : !!n.on,
    phone: nPhone,
  } };
  if (next.notify.on && !next.notify.phone) { const e = new Error('과제 완료 알림을 받을 원장님 휴대폰 번호를 넣어 주세요.'); e.status = 400; throw e; }
  await store().setJSON('settings', next);
  return next;
}
export function dayAllowed(days, kst = kstNow()) {
  const w = kst.getUTCDay(); // 0=일
  if (days === 'weekdays') return w >= 1 && w <= 5;
  if (days === 'mon-sat') return w >= 1;
  return true;
}

/* ---------- 기록 ---------- */
export async function getLog() { return (await store().get('log', { type: 'json' })) || []; }
async function addLog(items) {
  if (!items.length) return;
  const log = await getLog();
  await store().setJSON('log', items.concat(log).slice(0, 150));
}
async function sentToday(date) { return (await store().get('sent/' + date, { type: 'json' })) || {}; }
async function markSent(date, users) {
  if (!users.length) return;
  const m = await sentToday(date);
  users.forEach(u => { m[u] = new Date().toISOString(); });
  await store().setJSON('sent/' + date, m);
}

/* ---------- SMS Gateway 앱에 보내기 ---------- */
function enc(value) { // 앱의 암호 모드(AES-256-CBC + PBKDF2-SHA1)
  const pass = process.env.SMSGATE_PASSPHRASE;
  if (!pass) return value;
  const iter = 75000, salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(pass, salt, iter, 32, 'sha1');
  const c = crypto.createCipheriv('aes-256-cbc', key, salt);
  const data = Buffer.concat([c.update(String(value), 'utf8'), c.final()]);
  return `$aes-256-cbc/pbkdf2-sha1$i=${iter}$${salt.toString('base64')}$${data.toString('base64')}`;
}
function authHeader() {
  return 'Basic ' + Buffer.from(`${process.env.SMSGATE_USER}:${process.env.SMSGATE_PASS}`).toString('base64');
}
async function gate(path, opts = {}) {
  if (!configured()) { const e = new Error('아직 휴대폰 열쇠(SMSGATE_USER · SMSGATE_PASS)가 사이트 설정에 없어요.'); e.status = 400; throw e; }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(API() + path, Object.assign({}, opts, { signal: ctl.signal, headers: Object.assign({ Authorization: authHeader(), 'Content-Type': 'application/json' }, opts.headers || {}) }));
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (r.status === 401 || r.status === 403) { const e = new Error('휴대폰 열쇠가 맞지 않아요. 앱의 Username · Password를 다시 확인해 주세요.'); e.status = 400; throw e; }
    if (!r.ok) { const e = new Error(`문자 중계 서버 오류 (${r.status}) ${(j && (j.message || j.error)) || txt.slice(0, 120)}`); e.status = 502; throw e; }
    return j;
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error('문자 중계 서버가 응답하지 않아요. 잠시 뒤 다시 해 주세요.'); x.status = 504; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}
export async function sendOne(phoneE164, text) {
  const encrypted = !!process.env.SMSGATE_PASSPHRASE;
  const body = {
    textMessage: { text: enc(text) },
    phoneNumbers: [enc(phoneE164)],
    withDeliveryReport: true,
    ttl: 3 * 3600, // 휴대폰이 꺼져 있다가 한밤중에 켜져도 3시간 지난 문자는 보내지 않아요
  };
  if (encrypted) body.isEncrypted = true;
  const r = await gate('/messages', { method: 'POST', body: JSON.stringify(body) });
  return { id: r && r.id, state: (r && r.state) || 'Pending' };
}
export async function messageState(id) {
  const r = await gate('/messages/' + encodeURIComponent(id));
  const rec = r && Array.isArray(r.recipients) && r.recipients[0];
  return { state: (r && r.state) || '', error: (rec && rec.error) || '' };
}
export async function deviceStatus() {
  if (!configured()) return { configured: false };
  try {
    const list = await gate('/devices');
    const d = Array.isArray(list) ? list.slice().sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))[0] : null;
    return { configured: true, ok: true, device: d ? { name: d.name || '', lastSeen: d.lastSeen || '' } : null, encrypted: !!process.env.SMSGATE_PASSPHRASE };
  } catch (e) { return { configured: true, ok: false, error: e.message, encrypted: !!process.env.SMSGATE_PASSPHRASE }; }
}

/* ---------- 오늘 공부 시간 (공부 시간 기록을 읽기만 해요) ---------- */
export async function studiedToday(username, date = kstDate()) {
  const rec = await getStore({ name: 'study-time', consistency: 'strong' }).get(`${norm(username)}/${date.slice(0, 7)}`, { type: 'json' });
  const row = rec && rec.days && rec.days[date.slice(8, 10)];
  return row ? Object.values(row).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
}

export async function fillText(tpl, username, lessonDate = '', guide = '') {
  let name = '';
  try { name = await memberDisplayName(username); } catch (e) {}
  const md = lessonDate ? `${Number(lessonDate.slice(5, 7))}/${Number(lessonDate.slice(8, 10))}` : '지난';
  return String(tpl || DEFAULT_TEXT).replace(/#\{이름\}/g, name || username).replace(/#\{아이디\}/g, username).replace(/#\{수업날짜\}/g, md).replace(/#\{안내\}/g, guide);
}

// 최근 수업(피드백 회차) 중 아직 한 번도 연습하지 않은 회차 — 운영자 지시 2026-11-28
// 「수업을 안 했으면 문자를 보내지 마」: 최근 7일 안에 수업이 없으면 null(보내지 않음)
export async function pendingLesson(username, date = kstDate()) {
  const from = new Date(Date.parse(date + 'T00:00:00Z') - (LESSON_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const sets = (await listSets(username)).filter(x => x.lessonDate && x.lessonDate >= from && x.lessonDate <= date && x.sentenceCount > 0);
  if (!sets.length) return { lesson: null };
  const sum = await getSummary(username);
  const done = id => { const x = sum[id]; return !!(x && ((x.listen || 0) + (x.spoke || 0) + (x.failed || 0)) > 0); };
  const todo = sets.filter(x => !done(x.id)); // 최근 수업이 앞
  return { lesson: sets[0], todo: todo[0] || null, todoCount: todo.length };
}

// 🎬 영상쉐도잉 · 🎥 수업영상쉐도잉 — 이 학생에게 보이는 영상이 있는지, 오늘 했는지 (video-progress 읽기만)
async function videoStatus(username, ctx, date) {
  const u = norm(username);
  const access = await getAccess(u);
  const visible = ctx.lessons.filter(v => canSeeVideoWith(v, u, access));
  const lessonIds = new Set(visible.filter(v => ctx.recIds.has(v.id)).map(v => v.id));
  const hasVideo = visible.some(v => !ctx.recIds.has(v.id)), hasLessonVideo = lessonIds.size > 0;
  let videoToday = false, lessonVideoToday = false;
  const ps = getStore({ name: 'video-progress', consistency: 'strong' });
  const { blobs } = await ps.list({ prefix: `${u}/` });
  await Promise.all(blobs.map(async b => {
    const p = await ps.get(b.key, { type: 'json' }).catch(() => null);
    const t = p && (p.updatedAt || (p.last && p.last.at));
    if (!t || new Date(Date.parse(t) + 9 * 3600 * 1000).toISOString().slice(0, 10) !== date) return;
    const id = b.key.slice(u.length + 1);
    if (ctx.recIds.has(id)) lessonVideoToday = true; else videoToday = true;
  }));
  return { hasVideo, hasLessonVideo, videoToday, lessonVideoToday };
}

// 학생에게 보낼 안내 — 운영자 지시 2026-11-28
//  · 수업 피드백쉐도잉을 안 했으면 「꼭 하라고」
//  · 영상쉐도잉 · 수업영상쉐도잉을 오늘 안 했으면 「해 보라고 권장」
//  · 최근 7일 안에 수업이 없었으면 아무것도 보내지 않아요
function buildGuide(r, v, st) {
  const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const rec = [];
  if (st.daily.video && v.hasVideo && !v.videoToday) rec.push('영상 쉐도잉');
  if (st.daily.lessonVideo && v.hasLessonVideo && !v.lessonVideoToday) rec.push('수업영상 쉐도잉');
  const parts = [];
  if (r.todo) parts.push(`${md(r.todo.lessonDate)} 수업 피드백 쉐도잉을 아직 안 했어요! 꼭 해 주세요.`);
  if (rec.length) parts.push(`${r.todo ? '오늘 ' + rec.join('·') + '도' : '오늘 ' + rec.join('·') + '을 아직 안 했어요.'} 5분만 해 보면 좋아요 🙂`);
  return { guide: parts.join(' '), rec };
}

// 오늘 문자를 받을 학생: 번호가 있고 · 받기 켬 · 지금 회원 · 최근 7일 안에 수업이 있었고 ·
// (그 수업 피드백쉐도잉을 아직 안 함 또는 오늘 영상/수업영상 쉐도잉을 안 함) · 오늘 아직 안 보냄
export async function dailyTargets(date = kstDate()) {
  const [phones, members, sent, st, lessons, recIds] = await Promise.all([getPhones(), listMembers(), sentToday(date), getSettings(), listLessons().catch(() => []), recordingLessonIds().catch(() => [])]);
  const ctx = { lessons, recIds: new Set(recIds) };
  const alive = new Set(members.map(m => norm(m.username)));
  const out = [];
  for (const [u, p] of Object.entries(phones)) {
    if (!p || !p.on || !alive.has(u)) continue;
    const r = await pendingLesson(u, date);
    const v = r.lesson ? await videoStatus(u, ctx, date) : { hasVideo: false, hasLessonVideo: false, videoToday: false, lessonVideoToday: false };
    const g = r.lesson ? buildGuide(r, v, st) : { guide: '', rec: [] };
    const need = !!g.guide;
    out.push({
      username: u, phone: p.phone, already: !!sent[u], send: need && !sent[u],
      lesson: r.lesson ? { date: r.lesson.lessonDate, title: r.lesson.title } : null,
      todo: r.todo ? { date: r.todo.lessonDate, title: r.todo.title } : null,
      todoCount: r.todoCount || 0,
      video: v, rec: g.rec,
      text: need ? await fillText(st.daily.text, u, r.todo ? r.todo.lessonDate : '', g.guide) : '',
    });
  }
  return out.sort((a, b) => (a.username < b.username ? -1 : 1));
}

// 여러 학생에게 보내기 (5명씩 나눠서). kind: daily · manual · test
export async function sendMany(list, kind) {
  const date = kstDate(), logs = [], ok = [], fail = [];
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(list.slice(i, i + 5).map(async x => {
      try {
        const r = await sendOne(x.phone, x.text);
        ok.push(x.username || x.phone);
        logs.push({ at: new Date().toISOString(), kind, to: x.username || '', phone: x.phone, text: x.text, id: r.id, state: r.state });
      } catch (e) {
        fail.push({ to: x.username || x.phone, error: e.message });
        logs.push({ at: new Date().toISOString(), kind, to: x.username || '', phone: x.phone, text: x.text, id: '', state: 'Failed', error: e.message });
        if (e.status === 400) throw e; // 열쇠가 없거나 틀림 — 더 보내 봐야 소용없어요
      }
    }));
  }
  await addLog(logs);
  if (kind === 'daily' || kind === 'manual') await markSent(date, ok.filter(u => !u.startsWith('+')));
  return { ok: ok.length, fail };
}

// 기록에 있는 문자들의 결과(보냄 · 받음 · 실패)를 앱에 물어서 고쳐 둬요
export async function refreshLog(limit = 40) {
  const log = await getLog();
  const todo = log.slice(0, limit).filter(x => x.id && !['Delivered', 'Failed'].includes(x.state));
  await Promise.all(todo.map(async x => {
    try { const s = await messageState(x.id); if (s.state) x.state = s.state; if (s.error) x.error = s.error; } catch (e) {}
  }));
  if (todo.length) await store().setJSON('log', log);
  return log;
}

/* ---------- 🔔 과제 완료 알림 (원장님 휴대폰으로) — 운영자 지시 2026-11-28 ----------
 * 학생이 최근 7일 안 수업의 피드백쉐도잉(회차)을 처음 연습하면 원장님 휴대폰으로 알려요.
 * 연습 기록 코드는 잠긴 파일이라 건드리지 않고, 30분마다 연습 기록(practice-summary)을 읽어서 새로 연습한 회차를 찾아요.
 *   sms : 'done-seen' → { 아이디: { 회차ID: 처음 본 시각 } }   (이미 알린 회차 — 처음 한 번은 지금까지 한 것을 모두 '본 것'으로만 적어요)
 *         'done-queue' → [{ username, date, title, at }]        (밤이라 아직 못 보낸 알림)
 */
async function findNewlyDone() {
  const s = store();
  const seen = (await s.get('done-seen', { type: 'json' })) || null;
  const first = !seen;
  const next = seen || {};
  const today = kstDate();
  const from = new Date(Date.parse(today + 'T00:00:00Z') - (LESSON_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const found = [];
  for (const m of await listMembers()) {
    const u = norm(m.username);
    const sum = await getSummary(u);
    const mine = next[u] || (next[u] = {});
    for (const [id, x] of Object.entries(sum || {})) {
      if (mine[id]) continue;
      const n = ((x && x.listen) || 0) + ((x && x.spoke) || 0) + ((x && x.failed) || 0);
      if (!n) continue;
      mine[id] = new Date().toISOString();
      if (first) continue; // 처음 한 번은 기준만 잡아요(예전에 한 연습까지 한꺼번에 알리지 않게)
      let set = null; try { set = await getSet(u, id); } catch (e) {}
      if (!set) continue; // 피드백 회차가 아닌 기록(교재 등)
      const d = lessonDateOfSet(set);
      if (!d || d < from) continue; // 최근 7일 수업의 과제만
      found.push({ username: u, date: d, title: set.title || '', spoke: (x && x.spoke) || 0, at: new Date().toISOString() });
    }
  }
  await s.setJSON('done-seen', next);
  return found;
}

export async function notifyDone() {
  const st = await getSettings();
  const found = await findNewlyDone(); // 알림을 꺼 둬도 기준은 계속 따라가요(켤 때 예전 것이 한꺼번에 오지 않게)
  if (!st.notify.on || !st.notify.phone || !configured()) return { sent: 0, found: found.length };
  const s = store();
  const queue = ((await s.get('done-queue', { type: 'json' })) || []).concat(found).slice(-60);
  const hour = kstNow().getUTCHours();
  if (!queue.length || hour < NOTIFY_FROM || hour >= NOTIFY_TO) { await s.setJSON('done-queue', queue); return { sent: 0, queued: queue.length }; }
  const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const parts = [];
  for (const q of queue) {
    let name = ''; try { name = await memberDisplayName(q.username); } catch (e) {}
    parts.push(`${name || q.username}(${md(q.date)} 수업${q.spoke ? ', 따라 말하기 ' + q.spoke + '번' : ''})`);
  }
  const text = `[버클리] 과제 완료 ✅ ${parts.join(', ')}`.slice(0, 600);
  try {
    await sendMany([{ phone: st.notify.phone, text }], 'done');
    await s.setJSON('done-queue', []);
    return { sent: queue.length };
  } catch (e) { await s.setJSON('done-queue', queue); throw e; }
}
