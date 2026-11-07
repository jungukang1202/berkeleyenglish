// 엔보임 수업영상(녹화) 가져오기 — 서버 전용 공용 코드
// ---------------------------------------------------------------------------
// 1) 엔보임 피드백 자동 가져오기와 같은 등록 계정·같은 로그인으로 수강생 상세 페이지
//    (/Lecture/StudentManageDetail.asp?F_STDT_ID=…)를 열어 녹화 파일 링크를 찾아요.
//    페이지 모양을 아직 확인하지 못해서, 영상 파일 주소(mp4·m4a·webm…)와 녹화·다시보기로 보이는 링크를
//    넓게 찾고, 찾은 링크와 페이지 HTML을 관리자 화면에서 그대로 볼 수 있게(진단) 돌려줘요.
// 2) 녹화 파일은 서버가 3.5MB씩(Range 요청) 받아서 직접 올린 영상과 같은 조각(video-chunks)으로 저장해요.
//    → 영상 쉐도잉 레슨(video-lessons)이 되어 video.html의 재생·채점·기록을 그대로 써요.
// 엔보임 로그인 쿠키는 15분 동안 암호화해서 보관해요(조각마다 다시 로그인하지 않게).
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { NvoimSession, loginWithAccount, getAccounts, getMemberMap, encryptText, decryptText } from './nvoim.mjs';
import { listMembers } from './store.mjs';
import { CHUNK, createFileLesson, getLesson, putChunk, getChunk, deleteLesson } from './videos.mjs';
import { getAccess, setAccess } from './access.mjs';

const NVOIM_BASE = process.env.NVOIM_BASE_URL || 'https://www.nvoimp.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const COOKIE_TTL = 15 * 60 * 1000;

const store = () => getStore({ name: 'nvoim-import', consistency: 'strong' });
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 20);
const isNvoimHost = u => { try { const h = new URL(u).hostname; return h === new URL(NVOIM_BASE).hostname || /(^|\.)nvoimp\.com$/i.test(h); } catch (e) { return false; } };
const studentPage = id => `/Lecture/StudentManageDetail.asp?F_STDT_ID=${encodeURIComponent(id)}`;

export class LoginLost extends Error { constructor() { super('엔보임 로그인이 유지되지 않았어요.'); this.loginLost = true; } }

/* ===================== 로그인(쿠키 보관) ===================== */

async function pickAccount(accountId) {
  const accounts = await getAccounts();
  if (!accounts.length) throw new Error('등록된 엔보임 계정이 없어요. 「📥 엔보임 피드백」에서 먼저 계정을 추가해 주세요.');
  const a = accountId ? accounts.find(x => x.id === accountId) : accounts[0];
  if (!a) throw new Error('고른 엔보임 계정을 찾지 못했어요.');
  return a;
}

async function openSession(account, fresh) {
  const s = new NvoimSession();
  const key = 'video-cookie/' + account.id;
  if (!fresh) {
    const c = await store().get(key, { type: 'json' });
    if (c && c.exp > Date.now()) {
      try { s.cookies = new Map(JSON.parse(decryptText(c.enc))); return s; } catch (e) { /* 다시 로그인 */ }
    }
  }
  await loginWithAccount(s, account);
  await store().setJSON(key, { exp: Date.now() + COOKIE_TTL, enc: encryptText(JSON.stringify([...s.cookies])) });
  return s;
}

// 보관한 쿠키가 엔보임에서 끊겼으면 한 번 새로 로그인해서 다시 해요.
export async function withSession(accountId, fn) {
  const account = await pickAccount(accountId);
  try { return await fn(await openSession(account, false), account); }
  catch (e) { if (!e.loginLost) throw e; return fn(await openSession(account, true), account); }
}

function cookieHeader(s, url) {
  return isNvoimHost(url) && s.cookies.size ? [...s.cookies].map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
const looksLoggedOut = (r, text) => (r.status >= 300 && r.status < 400 && /Login/i.test(r.headers.get('location') || '')) || (/id="UserID"/.test(text) && /id="Passwd"/.test(text));

async function getPage(s, url) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Referer: NVOIM_BASE + '/Lecture/OneStop.asp' };
  const c = cookieHeader(s, url); if (c) headers.Cookie = c;
  const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(9000) });
  s._storeCookies(r);
  const text = await r.text();
  if (isNvoimHost(url) && looksLoggedOut(r, text)) throw new LoginLost();
  return { status: r.status, text };
}

/* ===================== 녹화 링크 찾기 ===================== */

const MEDIA_RE = /\.(mp4|m4v|m4a|mp3|webm|mov|wav|aac|ogg|m3u8)(?:[?#]|$)/i;
const HINT_RE = /record|recording|rec[_-]|vod|video|movie|replay|download|player|play|녹화|다시보기|영상/i;
const SKIP_RE = /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf)(?:[?#]|$)/i;
const DATE_RE = /(20\d\d)[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/g;

const decode = s => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const stripTags = s => decode(String(s).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function nearDate(html, idx) {
  const before = html.slice(Math.max(0, idx - 1500), idx);
  let m, last = null;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(before))) last = m;
  return last ? `${last[1]}-${last[2].padStart(2, '0')}-${last[3].padStart(2, '0')}` : '';
}
function nearText(html, idx) {
  const end = html.lastIndexOf('<', idx); // 링크가 들어 있는 태그 앞까지만
  const t = stripTags(html.slice(Math.max(0, end - 400), end).replace(/^[^<]*>/, ''));
  return t.slice(-60);
}

// 페이지 HTML에서 녹화 후보 찾기 → [{ url, kind:'file'|'hls'|'page', date, label }]
export function findCandidates(html, pageUrl) {
  const out = new Map();
  const re = /(["'])((?:https?:)?\/\/[^"'\s<>]{4,600}|\/[^"'\s<>]{2,600}|[\w\-./]{1,300}\.(?:mp4|m4v|m4a|mp3|webm|mov|m3u8|asp|aspx|php)(?:\?[^"'\s<>]*)?)\1/gi;
  let m;
  while ((m = re.exec(html))) {
    let raw = decode(m[2]);
    if (SKIP_RE.test(raw) || /^\/\/?$/.test(raw)) continue;
    let url;
    try { url = new URL(raw, pageUrl).href; } catch (e) { continue; }
    if (!/^https?:/i.test(url)) continue;
    const media = MEDIA_RE.exec(url);
    const ctx = html.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200);
    const kind = media ? (media[1].toLowerCase() === 'm3u8' ? 'hls' : 'file') : (HINT_RE.test(url) || /녹화|다시보기|영상/.test(ctx)) && /\.(asp|aspx|php|html?)(?:[?#]|$)|\?/i.test(url) ? 'page' : '';
    if (!kind || url === pageUrl || /Login|Logout|OneStop\.asp|StudentManageDetail\.asp/i.test(url)) continue;
    if (!out.has(url)) out.set(url, { url, kind, date: nearDate(html, m.index), label: nearText(html, m.index) });
  }
  return [...out.values()];
}

// 진단용: 녹화·재생과 관련 있어 보이는 onclick · 링크 글자 · iframe (페이지 모양을 확인할 때 써요)
function diagnose(html) {
  const pick = (re, f) => { const a = []; let m; while ((m = re.exec(html)) && a.length < 30) { const v = f(m); if (v) a.push(v); } return a; };
  return {
    title: stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || ''),
    bytes: html.length,
    onclicks: pick(/onclick\s*=\s*(["'])([\s\S]*?)\1/gi, m => (HINT_RE.test(m[2]) ? decode(m[2]).slice(0, 200) : '')),
    links: pick(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m => { const t = stripTags(m[2]); const href = (/href\s*=\s*["']([^"']*)/i.exec(m[1]) || [])[1] || ''; return (HINT_RE.test(t + ' ' + href + ' ' + m[1])) ? `${t.slice(0, 60)} → ${decode(href).slice(0, 200)}` : ''; }),
    frames: pick(/<(iframe|video|source|embed)\b[^>]*\bsrc\s*=\s*["']([^"']+)/gi, m => `${m[1]}: ${decode(m[2]).slice(0, 200)}`),
  };
}

const recordingKey = (studentId, url) => sha(String(studentId).toLowerCase() + '|' + (MEDIA_RE.test(new URL(url).pathname) ? new URL(url).origin + new URL(url).pathname : url));

/* ===================== 원스톱 관리 「지난수업보기」(보다 녹화) ===================== */
// 원스톱 관리(/Lecture/OneStop.asp) 수업 줄마다 DataField에 ConfCode가 있고, 🎬 지난수업보기 버튼은
// /bodaRecordList.asp(Process=BodaRecordGetAPI, ConfCode='001029_'+ConfCode)로 녹화 목록 JSON
// { totalContents, content:[{ downloadUrl, startDatetime, endDatetime }] }을 받아 boda.saeha.com/+downloadUrl을 내려받아요
// (엔보임 mvapi.nvoim.js와 같은 방식). 다운로드 주소는 바뀔 수 있어서, 가져올 때 ConfCode로 다시 물어봐요.
const BODA_BASE = 'https://boda.saeha.com/';
const BODA_ROOM = '001029_'; // mvapi.nvoim.js: company.code 1029를 6자리로
const SCAN_DAYS = 7;          // 오늘부터 7일 전까지의 수업
const kstDate = back => new Date(Date.now() + 9 * 3600e3 - back * 86400e3).toISOString().slice(0, 10);
const confKey = (studentId, conf, part) => sha(String(studentId).toLowerCase() + '|boda|' + conf + '|' + part);
const hhmm = t => (/^\d{12}/.test(String(t || '')) ? `${String(t).slice(8, 10)}:${String(t).slice(10, 12)}` : '');

// 원스톱 페이지 HTML → 수업 줄 [{ F_STDT_ID, F_STDT_NM, F_EDUC_DATE, ConfCode, ... }]
export function parseOneStopRows(html) {
  const rows = [];
  const blockRe = /<div[^>]*class="DataField[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = blockRe.exec(html))) {
    const row = {};
    const liRe = /<li\s+Columnvalue="([^"]*)"\s+ColumnName="([^"]*)"/gi;
    let li;
    while ((li = liRe.exec(m[1]))) row[li[2]] = decode(li[1]);
    if (row.F_STDT_ID) rows.push(row);
  }
  return rows;
}

async function oneStopRows(s, date, studentId = '') {
  const page = await getPage(s, `${NVOIM_BASE}/Lecture/OneStop.asp?SearchDate=${date}&SearchID=${encodeURIComponent(studentId)}`);
  return parseOneStopRows(page.text).filter(r => r.ConfCode && (!studentId || r.F_STDT_ID.toLowerCase() === studentId.toLowerCase()));
}

// 녹화 목록 JSON → [{ url, part, start, end }]
export function parseBodaRecords(json) {
  const list = (json && Array.isArray(json.content)) ? json.content : [];
  return list.filter(c => c && c.downloadUrl).map((c, part) => ({
    url: /^https?:\/\//i.test(c.downloadUrl) ? c.downloadUrl : BODA_BASE + String(c.downloadUrl).replace(/^\/+/, ''),
    part, start: String(c.startDatetime || ''), end: String(c.endDatetime || ''),
  }));
}

async function bodaRecords(s, conf) {
  const url = NVOIM_BASE + '/bodaRecordList.asp';
  const headers = {
    'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Referer: NVOIM_BASE + '/Lecture/OneStop.asp',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*',
  };
  const c = cookieHeader(s, url); if (c) headers.Cookie = c;
  const r = await fetch(url, { method: 'POST', headers, body: new URLSearchParams({ Process: 'BodaRecordGetAPI', ConfCode: BODA_ROOM + conf }).toString(), redirect: 'manual', signal: AbortSignal.timeout(8000) });
  s._storeCookies(r);
  const text = await r.text();
  if (looksLoggedOut(r, text)) throw new LoginLost();
  let json;
  try { json = JSON.parse(text.trim()); } catch (e) { throw new Error(`녹화 목록 응답을 읽지 못했어요 (HTTP ${r.status}).`); }
  return parseBodaRecords(json);
}

// 수업 줄 하나의 녹화 → 녹화 후보 [{ url, kind:'file', date, label, conf, part, studentId, name }]
async function rowRecordings(s, row) {
  const recs = await bodaRecords(s, row.ConfCode);
  const d = String(row.F_EDUC_DATE || '');
  const date = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
  return recs.map(x => ({
    url: x.url, kind: 'file', date, conf: row.ConfCode, part: x.part, studentId: row.F_STDT_ID, name: row.F_STDT_NM || '',
    label: `${row.F_STDT_NM || row.F_STDT_ID} 수업 녹화${hhmm(x.start) ? ` ${hhmm(x.start)}~${hhmm(x.end)}` : ''}${recs.length > 1 ? ` (${x.part + 1}/${recs.length})` : ''}`,
    key: confKey(row.F_STDT_ID, row.ConfCode, x.part),
  }));
}

// 여러 개를 한 번에 n개씩
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// 한 학생의 녹화 찾기: 최근 7일 원스톱 관리의 「지난수업보기」 녹화 + 수강생 상세 페이지의 녹화 링크
// (녹화 보기 페이지(page) 링크는 6개까지 열어서 그 안의 영상 파일 주소도 찾아요.)
export async function scanStudent(studentId, accountId, { withHtml = false } = {}) {
  studentId = String(studentId || '').trim();
  if (!/^[\w.@-]{1,60}$/.test(studentId)) throw new Error('엔보임 학생 아이디를 확인해 주세요.');
  return withSession(accountId, async (s, account) => {
    const pageUrl = NVOIM_BASE + studentPage(studentId);
    const dayErrors = [];
    const [page, dayRows] = await Promise.all([
      getPage(s, pageUrl),
      Promise.all(Array.from({ length: SCAN_DAYS }, (_, b) => oneStopRows(s, kstDate(b), studentId).catch(e => { if (e.loginLost) throw e; dayErrors.push(e.message); return []; }))),
    ]);
    const lessons = dayRows.flat();
    const boda = (await mapLimit(lessons, 6, r => rowRecordings(s, r).catch(e => { if (e.loginLost) throw e; dayErrors.push(e.message); return []; }))).flat();
    let found = boda.concat(findCandidates(page.text, pageUrl));
    const pages = found.filter(c => c.kind === 'page').slice(0, 6);
    for (const p of pages) {
      try {
        const sub = await getPage(s, p.url);
        const inner = findCandidates(sub.text, p.url).filter(c => c.kind !== 'page');
        if (inner.length) {
          p.resolved = true;
          inner.forEach(c => { if (!found.some(f => f.url === c.url)) found.push(Object.assign(c, { date: c.date || p.date, label: c.label || p.label, via: p.url })); });
        }
      } catch (e) { if (e.loginLost) throw e; p.error = e.message; }
    }
    found = found.filter(c => !(c.kind === 'page' && c.resolved));
    found.forEach(c => { if (!c.key) c.key = recordingKey(studentId, c.url); });
    const done = await Promise.all(found.map(c => store().get('video-done/' + c.key, { type: 'json' })));
    const recordings = await Promise.all(found.map(async (c, i) => {
      const d = done[i];
      const alive = d && d.lessonId ? !!(await getLesson(d.lessonId)) : false;
      return Object.assign(c, { done: alive ? d : null });
    }));
    recordings.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const diag = Object.assign(diagnose(page.text), { oneStop: `최근 ${SCAN_DAYS}일 원스톱 수업 ${lessons.length}개 · 지난수업보기 녹화 ${boda.length}개`, oneStopErrors: [...new Set(dayErrors)].slice(0, 3) });
    const res = { studentId, account: account.label, status: page.status, recordings, diag };
    if (withHtml) res.html = page.text;
    return res;
  });
}

// 녹화를 찾을 학생 목록: 엔보임↔회원 연결 + 엔보임 아이디와 같은 회원 아이디
export async function listStudents() {
  const [map, members] = await Promise.all([getMemberMap(), listMembers()]);
  const names = new Set(members.map(m => m.username));
  const out = new Map();
  for (const [nid, u] of Object.entries(map)) if (names.has(u)) out.set(nid, { nvoimId: nid, username: u });
  for (const m of members) if (!out.has(m.username)) out.set(m.username, { nvoimId: m.username, username: m.username, guess: true });
  return [...out.values()];
}

/* ===================== 녹화 파일 → 영상 쉐도잉 조각 ===================== */

function mimeFor(url, type) {
  type = String(type || '').split(';')[0].trim().toLowerCase();
  if (/^(video|audio)\//.test(type)) return type;
  const ext = (MEDIA_RE.exec(url) || [])[1];
  return { m4a: 'audio/mp4', mp3: 'audio/mpeg', webm: 'video/webm', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', mov: 'video/quicktime' }[String(ext).toLowerCase()] || 'video/mp4';
}

async function rangeFetch(s, url, from, to, referer) {
  const headers = { 'User-Agent': UA, Range: `bytes=${from}-${to}`, Referer: referer || NVOIM_BASE + '/' };
  const c = cookieHeader(s, url); if (c) headers.Cookie = c;
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(8500) });
  if (isNvoimHost(r.url || url) && /text\/html/i.test(r.headers.get('content-type') || '')) {
    const text = await r.text();
    if (looksLoggedOut(r, text)) throw new LoginLost();
    throw new Error('영상 파일이 아니라 웹 페이지가 왔어요. 녹화 보기 페이지 주소일 수 있어요 — 「🔎 진단」에서 영상 파일 주소를 확인해 주세요.');
  }
  return r;
}

// 시작: 파일 크기를 확인하고 레슨(📁, 업로드 미완료)을 만들어요.
// conf·part: 원스톱 「지난수업보기」 녹화 — 다운로드 주소를 그 자리에서 다시 받아요.
export async function startTransfer({ url, accountId, studentId, title, referer, date, conf, part }) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('녹화 파일 주소가 올바르지 않아요.');
  if (/\.m3u8(?:[?#]|$)/i.test(url)) throw new Error('이 녹화는 스트리밍(m3u8) 방식이라 아직 가져올 수 없어요. 「🔎 진단」 내용을 개발자에게 보내 주세요.');
  conf = /^[\w.-]{1,80}$/.test(String(conf || '')) ? String(conf) : '';
  part = Number(part) || 0;
  return withSession(accountId, async (s, account) => {
    if (conf) {
      const rec = (await bodaRecords(s, conf))[part];
      if (!rec) throw new Error('엔보임에서 이 수업 녹화를 찾지 못했어요. 수업 직후라면 잠시 뒤 다시 해 주세요.');
      url = rec.url;
    }
    const r = await rangeFetch(s, url, 0, 0, referer);
    const type = r.headers.get('content-type') || '';
    let size = 0;
    const cr = /\/(\d+)\s*$/.exec(r.headers.get('content-range') || '');
    if (r.status === 206 && cr) size = Number(cr[1]);
    else if (r.ok) size = Number(r.headers.get('content-length') || 0);
    try { await r.body?.cancel(); } catch (e) {}
    if (!r.ok) throw new Error(`녹화 파일을 열지 못했어요 (HTTP ${r.status}).`);
    if (/text\/html|json|xml/i.test(type)) throw new Error('영상 파일이 아니라 웹 페이지가 왔어요. 「🔎 진단」에서 영상 파일 주소를 확인해 주세요.');
    if (!size) throw new Error('녹화 파일 크기를 알 수 없어요.');
    // 나눠 받기(Range)를 지원하지 않는 녹화 서버(boda.saeha.com): 백그라운드 함수가 파일을 처음부터 끝까지 받아 조각으로 저장해요.
    const stream = r.status !== 206 && size > CHUNK;
    if (size > 1024 * 1024 * 1024) throw new Error('1GB가 넘는 녹화는 가져올 수 없어요.');
    const lesson = await createFileLesson({ title: String(title || '엔보임 수업 녹화').slice(0, 200), mime: mimeFor(url, type), size });
    await store().setJSON('video-job/' + lesson.id, {
      url, referer: referer || '', accountId: account.id, studentId: String(studentId || ''), date: /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : '',
      key: conf && studentId ? confKey(studentId, conf, part) : studentId ? recordingKey(studentId, url) : sha(url),
      size, at: new Date().toISOString(), ...(stream ? { mode: 'stream', got: 0, beat: Date.now() } : {}),
    });
    return { lesson, chunks: lesson.chunks, size, mime: lesson.mime, stream };
  });
}

// 조각 n을 받아 저장하고, 같은 바이트를 그대로 돌려줘요(관리자 브라우저가 받아쓰기에 써요).
export async function transferChunk(id, n) {
  const job = await store().get('video-job/' + id, { type: 'json' });
  if (!job) throw new Error('가져오기 작업을 찾지 못했어요. 처음부터 다시 해 주세요.');
  const have = await getChunk(id, n);
  if (have) return have;
  if (job.mode === 'stream') {
    // 백그라운드 함수가 아직 이 조각까지 받지 못했어요 → 화면이 잠시 뒤 다시 물어봐요
    if (job.error) throw new Error(job.error);
    if (Date.now() - (job.beat || 0) > 120000) throw new Error('엔보임 녹화를 받는 일이 멈췄어요. 처음부터 다시 해 주세요.');
    throw Object.assign(new Error('아직 받는 중이에요.'), { notYet: true, got: job.got || 0 });
  }
  const from = n * CHUNK, to = Math.min(job.size, from + CHUNK) - 1;
  if (!(n >= 0) || from >= job.size) throw new Error('bad_chunk');
  const buf = await withSession(job.accountId, async s => {
    const r = await rangeFetch(s, job.url, from, to, job.referer);
    if (!r.ok) throw new Error(`녹화 조각 ${n + 1}을 받지 못했어요 (HTTP ${r.status}).`);
    let b = await r.arrayBuffer();
    if (r.status === 200 && b.byteLength > to - from + 1) b = b.slice(from, to + 1); // 작은 파일: 통째로 왔어요
    return b;
  });
  if (buf.byteLength !== to - from + 1) throw new Error(`녹화 조각 ${n + 1}의 크기가 맞지 않아요. 다시 시도해 주세요.`);
  await putChunk(id, n, buf);
  return buf;
}

// 나눠 받기를 지원하지 않는 녹화: 백그라운드 함수(nvoim-video-fetch-background, 최대 15분)가 한 번에 받아
// 3.5MB가 찰 때마다 조각으로 저장하고, 작업(video-job)에 받은 조각 수(got)와 살아 있는 시각(beat)을 적어요.
export async function streamTransfer(id) {
  const st = store();
  let job = await st.get('video-job/' + id, { type: 'json' });
  if (!job || job.mode !== 'stream') return;
  const fail = async msg => { const j = await st.get('video-job/' + id, { type: 'json' }); if (j) await st.setJSON('video-job/' + id, Object.assign(j, { error: msg, beat: Date.now() })); };
  try {
    await withSession(job.accountId, async s => {
      const headers = { 'User-Agent': UA, Referer: job.referer || NVOIM_BASE + '/' };
      const c = cookieHeader(s, job.url); if (c) headers.Cookie = c;
      const r = await fetch(job.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(14 * 60 * 1000) });
      if (!r.ok || !r.body) throw new Error(`녹화 파일을 받지 못했어요 (HTTP ${r.status}).`);
      const reader = r.body.getReader();
      let buf = new Uint8Array(CHUNK), fill = 0, n = 0, total = 0;
      const flush = async () => {
        await putChunk(id, n, buf.slice(0, fill).buffer);
        n++; fill = 0;
        job = await st.get('video-job/' + id, { type: 'json' });
        if (!job) throw Object.assign(new Error('cancelled'), { stop: true }); // 중지했어요
        await st.setJSON('video-job/' + id, Object.assign(job, { got: n, beat: Date.now() }));
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let off = 0;
        while (off < value.length) {
          const take = Math.min(CHUNK - fill, value.length - off);
          buf.set(value.subarray(off, off + take), fill);
          fill += take; off += take; total += take;
          if (total > job.size) throw new Error('녹화 파일 크기가 처음과 달라요. 다시 해 주세요.');
          if (fill === CHUNK) await flush();
        }
      }
      if (fill) await flush();
      if (total !== job.size) throw new Error('녹화 파일을 끝까지 받지 못했어요. 다시 해 주세요.');
    });
  } catch (e) {
    if (e.stop) return;
    await fail(String(e.message || e).slice(0, 200));
  }
}

// 다 만든 뒤: 만든 녹화로 표시하고, 그 학생에게 바로 넣어 줘요(「🎁 학생별 쉐도잉 넣어주기」와 같은 저장소).
// extra: 📁 녹화 파일로 만든 경우(가져오기 작업이 없음)의 수업일 · 엔보임 아이디
export async function finishTransfer(id, username, extra = {}) {
  const job = await store().get('video-job/' + id, { type: 'json' });
  const lesson = await getLesson(id);
  if (!lesson) throw new Error('lesson_not_found');
  if (job) {
    await store().setJSON('video-done/' + job.key, { lessonId: id, username: username || '', title: lesson.title, date: job.date || '', studentId: job.studentId || '', at: new Date().toISOString() });
    await store().delete('video-job/' + id);
    await store().delete('video-found/' + job.key);
    await store().delete('video-saved/' + job.key);
  } else {
    // 「🎥 수업영상쉐도잉 만들기」에서 녹화 파일을 올려 만든 영상도 수업영상으로 표시해요(학생 화면 🎥 수업영상쉐도잉 · 기록)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(extra.date || '')) ? extra.date : '';
    await store().setJSON('video-done/upload-' + id, { lessonId: id, username: username || '', title: lesson.title, date, studentId: String(extra.studentId || ''), upload: true, at: new Date().toISOString() });
  }
  if (username) {
    const a = await getAccess(username);
    if (!a.videos.includes(id)) await setAccess(username, { books: a.books, videos: a.videos.concat(id) });
  }
  return { ok: true };
}

export async function cancelTransfer(id) {
  await store().delete('video-job/' + id);
  await deleteLesson(id);
}

/* ===================== 💾 저장 (운영자 지시 2026-11-03) ===================== */
// 🎥 수업영상 자동 가져오기에서 찾은 녹화를 「💾 저장」하면 'video-saved/'에 그 회원 것으로 모아 두고,
// 🎥 수업영상 쉐도잉 만들기에서 그 회원을 고르면 보여 줘요(거기서 「🎬 쉐도잉 만들기」).
export async function saveRecording(rec, username) {
  username = String(username || '').trim().toLowerCase();
  if (!username) throw new Error('녹화를 저장할 회원을 골라 주세요.');
  rec = rec || {};
  const url = String(rec.url || '');
  if (!/^https?:\/\//i.test(url)) throw new Error('녹화 파일 주소가 없어요.');
  const studentId = String(rec.studentId || '');
  const key = /^[\w.-]{1,200}$/.test(String(rec.key || '')) ? String(rec.key) : recordingKey(studentId, url);
  const saved = {
    key, url, username, studentId, kind: String(rec.kind || 'file'), date: String(rec.date || ''), label: String(rec.label || ''),
    name: String(rec.name || ''), conf: String(rec.conf || ''), part: Number(rec.part) || 0, savedAt: new Date().toISOString(),
  };
  await store().setJSON('video-saved/' + key, saved);
  return saved;
}

// 한 회원의 저장한 녹화(아직 쉐도잉으로 만들지 않은 것) — 수업일 최신 순
export async function savedRecordings(username) {
  username = String(username || '').trim().toLowerCase();
  const st = store();
  const { blobs } = await st.list({ prefix: 'video-saved/' });
  const all = (await Promise.all(blobs.map(b => st.get(b.key, { type: 'json' })))).filter(x => x && x.username === username);
  const out = [];
  for (const x of all) {
    const d = await st.get('video-done/' + x.key, { type: 'json' });
    if (d && d.lessonId && (await getLesson(d.lessonId))) continue;
    out.push(Object.assign(x, { saved: true, done: null }));
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/* ===================== 지금 바로 가져오기 / 30분마다 자동 ===================== */
// 수강회원 녹화: 최근 7일 원스톱 관리의 수업 줄(수업이 잡힌 수강회원)마다 「지난수업보기」 녹화를 찾아
// 'video-found/'에 모아 둬요(관리자 화면에 🆕 새 녹화로 보여요). 엔보임 아이디가 회원과 연결돼 있으면 그 회원에게 넣어 줘요.
// 받아쓰기는 관리자 창에서 하기 때문에, 자동 실행은 새 녹화 찾기까지 해요.
// deadlineMs까지 가능한 만큼 하고, 못 끝낸 날짜는 다음 호출 때 이어서(video-scan-cursor).
export async function scanAll({ deadlineMs, source } = {}) {
  const deadline = deadlineMs || Date.now() + 8000;
  const st = store();
  const students = await listStudents();
  const userOf = new Map(students.map(x => [x.nvoimId.toLowerCase(), x.username]));
  let cursor = (await st.get('video-scan-cursor', { type: 'json' })) || {};
  if (!(cursor.d >= 0) || cursor.d >= SCAN_DAYS) cursor = { d: 0, lessons: 0, found: 0, errors: [] };
  const summary = { days: SCAN_DAYS, checked: 0, students: 0, found: 0, errors: [], finished: true };
  try {
    await withSession(undefined, async s => {
      while (cursor.d < SCAN_DAYS) {
        if (Date.now() > deadline - 3000) { summary.finished = false; break; }
        const date = kstDate(cursor.d);
        try {
          const rows = await oneStopRows(s, date);
          cursor.lessons += rows.length;
          // 이미 찾았거나 만든 수업은 녹화 목록을 다시 묻지 않아요
          const known = await Promise.all(rows.map(r => Promise.all(['video-done/', 'video-found/'].map(p => st.get(p + confKey(r.F_STDT_ID, r.ConfCode, 0), { type: 'json' })))));
          const ask = rows.filter((r, i) => !known[i][0] && !known[i][1]);
          const recs = (await mapLimit(ask, 6, r => rowRecordings(s, r).catch(e => { if (e.loginLost) throw e; cursor.errors.push(`${r.F_STDT_ID} ${date}: ${e.message}`.slice(0, 200)); return []; }))).flat();
          for (const x of recs) {
            if ((await st.get('video-done/' + x.key, { type: 'json' })) || (await st.get('video-found/' + x.key, { type: 'json' }))) continue;
            await st.setJSON('video-found/' + x.key, {
              studentId: x.studentId, username: userOf.get(x.studentId.toLowerCase()) || '', name: x.name, url: x.url, kind: x.kind,
              date: x.date, label: x.label, key: x.key, conf: x.conf, part: x.part, foundAt: new Date().toISOString(),
            });
            cursor.found++;
          }
        } catch (e) {
          if (e.loginLost) throw e;
          cursor.errors.push(`${date}: ${e.message || e}`.slice(0, 200));
        }
        cursor.d++; summary.checked++;
      }
    });
  } catch (e) {
    cursor.errors.push(String(e.message || e).slice(0, 200));
  }
  summary.students = cursor.lessons; summary.found = cursor.found; summary.errors = cursor.errors.slice(0, 5);
  await st.setJSON('video-scan-cursor', summary.finished ? { d: SCAN_DAYS, lessons: 0, found: 0, errors: [] } : cursor);
  const run = { at: new Date().toISOString(), source: source || 'manual', ...summary };
  await st.setJSON('video-last-run', run);
  if (source === 'auto') {
    const log = (await st.get('video-auto-log', { type: 'json' })) || [];
    log.push({ at: run.at, days: summary.days, checked: summary.checked, students: summary.students, found: summary.found, errors: summary.errors.slice(0, 3), finished: summary.finished });
    await st.setJSON('video-auto-log', log.slice(-48));
  }
  return summary;
}

export async function recordVideoAutoFailure(message) {
  const st = store();
  const log = (await st.get('video-auto-log', { type: 'json' })) || [];
  log.push({ at: new Date().toISOString(), checked: 0, students: 0, found: 0, errors: [String(message || '알 수 없는 오류').slice(0, 200)], finished: false, crashed: true });
  await st.setJSON('video-auto-log', log.slice(-48));
}

// 관리자 화면: 찾아 둔 새 녹화(이미 만든 것은 빼고) · 마지막 실행 · 자동 실행 기록
export async function getRunInfo() {
  const st = store();
  const { blobs } = await st.list({ prefix: 'video-found/' });
  const found = (await Promise.all(blobs.map(b => st.get(b.key, { type: 'json' })))).filter(Boolean);
  const done = await Promise.all(found.map(f => st.get('video-done/' + f.key, { type: 'json' })));
  const fresh = [];
  for (let i = 0; i < found.length; i++) {
    if (done[i] && done[i].lessonId && (await getLesson(done[i].lessonId))) await st.delete('video-found/' + found[i].key);
    else fresh.push(found[i]);
  }
  fresh.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const saved = await Promise.all(fresh.map(f => st.get('video-saved/' + f.key, { type: 'json' })));
  fresh.forEach((f, i) => { if (saved[i]) { f.saved = true; f.savedFor = saved[i].username; } });
  const [lastRun, autoLog] = await Promise.all([st.get('video-last-run', { type: 'json' }), st.get('video-auto-log', { type: 'json' })]);
  return { found: fresh, lastRun, autoLog: autoLog || [] };
}

/* ===================== 🎥 수업영상 쉐도잉 기록 ===================== */
// 한 회원의 수업 녹화 영상 쉐도잉 목록: 그 회원 것으로 만든 녹화 + 다른 학생 녹화라도 그 회원에게 넣어 준 것
// → [{ id, title, date, sentenceCount, createdAt, assigned }] (수업일 최신 순). 연습 기록은 /api/admin-practice의 'video-<id>'를 써요.
export async function memberRecordings(username) {
  username = String(username || '').trim().toLowerCase();
  const st = store();
  const { blobs } = await st.list({ prefix: 'video-done/' });
  const done = (await Promise.all(blobs.map(b => st.get(b.key, { type: 'json' })))).filter(d => d && d.lessonId);
  const access = new Set((await getAccess(username)).videos);
  const mine = done.filter(d => String(d.username || '').toLowerCase() === username || access.has(d.lessonId));
  const seen = new Set();
  const out = [];
  for (const d of mine) {
    if (seen.has(d.lessonId)) continue; seen.add(d.lessonId);
    const l = await getLesson(d.lessonId);
    if (!l) continue;
    let date = d.date || '';
    const m = !date && /^(\d{1,2})\/(\d{1,2}) /.exec(l.title || ''); // 예전 기록: 제목 앞 '11/2'
    if (m) date = `${new Date(l.createdAt || Date.now()).getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    out.push({ id: l.id, title: l.title, date, sentenceCount: (l.sentences || []).length, createdAt: l.createdAt, assigned: access.has(l.id), level: l.level || '' });
  }
  return out.sort((a, b) => ((b.date || b.createdAt || '') > (a.date || a.createdAt || '') ? 1 : -1));
}

// 학생 화면 「🎥 수업영상쉐도잉」: 엔보임 수업 녹화로 만든 영상 ID 전체 (영상쉐도잉 목록과 나누는 데 써요)
export async function recordingLessonIds() {
  const st = store();
  const { blobs } = await st.list({ prefix: 'video-done/' });
  const done = await Promise.all(blobs.map(b => st.get(b.key, { type: 'json' })));
  return [...new Set(done.filter(d => d && d.lessonId).map(d => d.lessonId))];
}
