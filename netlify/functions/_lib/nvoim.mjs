// 엔보임 플래너(nvoimp.com) 자동 가져오기 — 서버 전용 공용 코드
// ---------------------------------------------------------------------------
// 1) 등록된 엔보임 계정마다 로그인 → 원스톱 관리(날짜별 학생 목록) 읽기
// 2) 학생마다 피드백(문장교정 / 발음교정) 읽기
// 3) 사이트 회원과 연결되어 있으면 회차(세트)로 자동 저장, 아니면 "회원 선택 필요" 목록에 보관
// 엔보임 비밀번호는 AES-256-GCM으로 암호화해서 Netlify Blobs에 저장합니다.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { listMembers, listSets, getSet, createSet, updateSet } from './store.mjs';

const NVOIM_BASE = process.env.NVOIM_BASE_URL || 'https://www.nvoimp.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

function nvoimStore() {
  return getStore({ name: 'nvoim-import', consistency: 'strong' });
}

/* ===================== 비밀번호 암호화 ===================== */

function cryptoKey() {
  const secret = process.env.NVOIM_SECRET || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error('SESSION_SECRET (또는 ADMIN_PASSWORD) 환경변수가 필요합니다.');
  return crypto.createHash('sha256').update('nvoim-import:' + secret).digest();
}

export function encryptText(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptText(enc) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc.data, 'base64')), decipher.final()]).toString('utf8');
}

/* ===================== 날짜(한국 시간) ===================== */

export function kstDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}
function kstHour() {
  return new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
}
export function defaultTitle(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  return m ? `${Number(m[2])}/${Number(m[3])} 수업 피드백` : '수업 피드백';
}

/* ===================== 피드백 텍스트 파싱 (js/shadowing-engine.js와 같은 규칙) ===================== */

const X_PREFIX_RE = /^(?:\[x\]\s*|x\s*(?:[:：\-－]\s*|\s+))/i;
const O_PREFIX_RE = /^(?:\[o\]\s*|o\s*(?:[:：\-－]\s*|\s+))/i;
const W_PREFIX_RE = /^(?:\[w\]\s*|w\s*(?:[:：\-－]\s*|\s+))/i;

function parseFeedbackBlock(text, pairMode) {
  const newSentences = [];
  const newWords = [];
  let pendingX = '';
  let pendingPairX = null;
  String(text || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (X_PREFIX_RE.test(line)) {
      pendingX = line.replace(X_PREFIX_RE, '');
    } else if (O_PREFIX_RE.test(line)) {
      const o = line.replace(O_PREFIX_RE, '');
      if (o) newSentences.push({ x: pendingX, o });
      pendingX = '';
    } else if (W_PREFIX_RE.test(line)) {
      const w = line.replace(W_PREFIX_RE, '');
      if (w) newWords.push(w);
    } else if (pairMode) {
      if (pendingPairX === null) pendingPairX = line;
      else { newSentences.push({ x: pendingPairX, o: line, hideX: true }); pendingPairX = null; }
    } else {
      newSentences.push({ x: pendingX, o: line });
      pendingX = '';
    }
  });
  if (pendingPairX !== null) newSentences.push({ x: '', o: pendingPairX });
  return { newSentences, newWords };
}

// 엔보임 피드백 → { sentences, words }
export function parseNvoimFeedback(sentenceCorrection, mispronouncedWord) {
  const sc = String(sentenceCorrection || '').replace(/\r/g, '');
  // x-/o-/x:/X 같은 접두어가 하나라도 있으면 접두어 방식, 없으면 두 줄씩 짝(틀린/맞는) 방식
  const hasPrefix = sc.split('\n').some(l => /^(?:\[[xo]\]|[xo]\s*[:：\-－]|[xo]\s+)/i.test(l.trim()));
  const { newSentences, newWords } = parseFeedbackBlock(sc, !hasPrefix);
  const words = String(mispronouncedWord || '')
    .replace(/\r/g, '')
    .split(/[,\n]+/).map(w => w.trim())
    // "No mispronounced words", "none", "-", "없음" 같은 '없음' 표시는 단어로 저장하지 않음
    .filter(w => w && !/^(?:no\b.*|none|n\/?a|-+|x|없음.*)$/i.test(w));
  return { sentences: newSentences, words: newWords.concat(words) };
}

/* ===================== 엔보임 접속 ===================== */

function decodeXml(s) {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  if (cdata) return cdata[1];
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}
function xmlTag(xml, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? decodeXml(m[1]) : '';
}
function decodeHtmlAttr(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

class NvoimSession {
  constructor() { this.cookies = new Map(); }

  _storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  // 네트워크 오류(연결 끊김 등)는 최대 3번까지 다시 시도합니다.
  async request(path, { method = 'GET', form, step = '' } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this._requestOnce(path, { method, form });
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 700));
      }
    }
    const c = lastErr && lastErr.cause;
    const why = (c && (c.code || c.message)) || (lastErr && lastErr.name === 'TimeoutError' ? '응답 시간 초과' : (lastErr && lastErr.message)) || 'unknown';
    throw new Error(`엔보임 접속 오류${step ? ' (' + step + ')' : ''}: ${why}`);
  }

  async _requestOnce(path, { method, form }) {
    const headers = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Referer: NVOIM_BASE + '/Lecture/OneStop.asp' };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) {
      body = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    const res = await fetch(NVOIM_BASE + path, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    this._storeCookies(res);
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location') || '', text };
  }

  async login(userId, password) {
    // 세션 쿠키를 먼저 받기 위해 로그인 페이지를 한 번 엽니다.
    await this.request('/Member/Login.asp', { step: '로그인 페이지' });
    const r = await this.request('/Member/Process/loginProc.asp', { method: 'POST', form: { UserID: userId, Passwd: password }, step: '로그인' });
    const result = xmlTag(r.text, 'Result');
    if (result === 'Complete' || result === 'CompleteNoneCenter') return;
    if (!result) throw new Error(`엔보임 로그인 응답을 읽지 못했어요 (HTTP ${r.status}). 해외 접속이 막혔을 수 있어요.`);
    const reasons = {
      NoneCertificationNRC: '엔보임에서 회원 인증이 필요한 계정이에요.',
      InactiveMember: '휴면 계정이에요. 엔보임에서 먼저 활성화해주세요.',
    };
    throw new Error(reasons[result] || `엔보임 로그인 실패 (${result}) — 아이디/비밀번호를 확인해주세요.`);
  }

  // 날짜별 원스톱 학생 목록: [{ F_STDT_ID, F_STDT_NM, EvaluationSeq, ... }]
  async listLessons(date) {
    const r = await this.request(`/Lecture/OneStop.asp?SearchDate=${encodeURIComponent(date)}&SearchID=`, { step: '원스톱 목록' });
    if (r.status >= 300 && /Login/i.test(r.location)) throw new Error('엔보임 로그인이 유지되지 않았어요.');
    if (/id="UserID"/.test(r.text) && /id="Passwd"/.test(r.text) && !/OneStopList/.test(r.text)) throw new Error('엔보임 로그인이 유지되지 않았어요.');
    const rows = [];
    const blockRe = /<div[^>]*class="DataField[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = blockRe.exec(r.text))) {
      const row = {};
      const liRe = /<li\s+Columnvalue="([^"]*)"\s+ColumnName="([^"]*)"/gi;
      let li;
      while ((li = liRe.exec(m[1]))) row[li[2]] = decodeHtmlAttr(li[1]);
      if (row.F_STDT_ID) rows.push(row);
    }
    return rows;
  }

  async getFeedback(row) {
    const r = await this.request('/Lecture/Process/LectureEvaluationProc.asp', {
      method: 'POST',
      step: '피드백 ' + (row.F_STDT_NM || row.F_STDT_ID),
      form: {
        ActionType: 'getLectureAttendanceList',
        F_STDT_ID: row.F_STDT_ID || '',
        F_PICEDUCCLS_SEQ_PROGRESS: row.F_PICEDUCCLS_SEQ_PROGRESS || '',
        EvaluationSeq: row.EvaluationSeq || '',
        F_PICEDUCCLS_SEQ: row.F_PICEDUCCLS_SEQ || '',
        F_PICEDUCATDC_SEQ: row.F_PICEDUCATDC_SEQ || '',
      },
    });
    if (!/<List[\s>]/i.test(r.text)) throw new Error('피드백 응답을 읽지 못했어요.');
    return {
      sentenceCorrection: xmlTag(r.text, 'SentenceCorrection'),
      mispronouncedWord: xmlTag(r.text, 'MispronouncedWord'),
    };
  }
}

/* ===================== 저장소: 계정 / 회원 연결 / 처리 기록 ===================== */

export async function getAccounts() {
  return (await nvoimStore().get('accounts', { type: 'json' })) || [];
}
async function saveAccounts(list) {
  await nvoimStore().setJSON('accounts', list);
}
export function publicAccount(a) {
  return { id: a.id, label: a.label, userId: a.userId, createdAt: a.createdAt, last: a.last || null };
}

export async function addAccount({ label, userId, password }) {
  userId = String(userId || '').trim();
  if (!userId || !password) throw new Error('엔보임 아이디와 비밀번호를 입력해주세요.');
  // 저장하기 전에 실제로 로그인되는지 확인
  const s = new NvoimSession();
  await s.login(userId, String(password));
  const list = await getAccounts();
  const existing = list.find(a => a.userId.toLowerCase() === userId.toLowerCase());
  const account = existing || { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  Object.assign(account, { label: String(label || '').trim() || userId, userId, pw: encryptText(password) });
  if (!existing) list.push(account);
  await saveAccounts(list);
  return publicAccount(account);
}

export async function deleteAccount(id) {
  const list = await getAccounts();
  await saveAccounts(list.filter(a => a.id !== id));
}

async function updateAccountLast(id, last) {
  const list = await getAccounts();
  const a = list.find(x => x.id === id);
  if (!a) return;
  a.last = last;
  await saveAccounts(list);
}

export async function getMemberMap() {
  return (await nvoimStore().get('member-map', { type: 'json' })) || {};
}
export async function setMemberMapping(nvoimId, username) {
  const map = await getMemberMap();
  const key = String(nvoimId).trim().toLowerCase();
  if (username) map[key] = username; else delete map[key];
  await nvoimStore().setJSON('member-map', map);
  return map;
}

function lessonKey(nvoimId, date, row) {
  return `${String(nvoimId).toLowerCase()}/${date}/${row.F_PICEDUCATDC_SEQ || row.EvaluationSeq || '0'}`;
}

export async function listPending() {
  const store = nvoimStore();
  const { blobs } = await store.list({ prefix: 'pending/' });
  const items = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
  return items.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name < b.name ? -1 : 1));
}

/* ===================== 회차 저장 ===================== */

// 회차에 남겨두는 출처 정보(리포트에서 학생 이름/수업 날짜로 사용)
function nvoimSource(item) {
  return { type: 'nvoim', key: item.key, date: item.date, name: item.name, nvoimId: item.nvoimId };
}

// 같은 제목 회차가 이미 있으면: 같은 수업이면 덮어쓰기, 손으로 붙여넣은 회차면 덮어쓰기, 다른 수업이면 "(2)" 붙여서 새로 만들기
async function saveLessonAsSet(username, item) {
  const { sentences, words } = parseNvoimFeedback(item.sentenceCorrection, item.mispronouncedWord);
  if (!sentences.length && !words.length) return null;
  const baseTitle = defaultTitle(item.date);
  const sets = await listSets(username);
  for (let n = 1; n <= 5; n++) {
    const title = n === 1 ? baseTitle : `${baseTitle} (${n})`;
    const same = sets.find(s => s.title === title);
    if (!same) {
      const set = await createSet(username, { title, sentences, words, source: nvoimSource(item) });
      return set.id;
    }
    const full = await getSet(username, same.id);
    const src = full && full.source;
    if (!src || src.key === item.key) {
      await updateSet(username, same.id, { title, sentences, words, source: nvoimSource(item) });
      return same.id;
    }
  }
  const set = await createSet(username, { title: `${baseTitle} (${Date.now() % 1000})`, sentences, words, source: nvoimSource(item) });
  return set.id;
}

// "회원 선택 필요" 항목을 회원에게 저장 (같은 학생의 다른 대기 항목도 함께 처리)
export async function assignPending(key, username, { remember = true } = {}) {
  const store = nvoimStore();
  const item = await store.get('pending/' + key, { type: 'json' });
  if (!item) throw new Error('이미 처리된 항목이에요.');
  if (remember) await setMemberMapping(item.nvoimId, username);
  const targets = remember
    ? (await listPending()).filter(p => p.nvoimId.toLowerCase() === item.nvoimId.toLowerCase())
    : [item];
  let saved = 0;
  for (const p of targets) {
    const setId = await saveLessonAsSet(username, p);
    await store.setJSON('done/' + p.key, { username, setId, at: new Date().toISOString() });
    await store.delete('pending/' + p.key);
    if (setId) saved++;
  }
  return { saved };
}

// "회원 선택 필요" 항목을 저장하지 않고 넘기기(회원이 아닌 학생 등)
export async function dismissPending(key) {
  const store = nvoimStore();
  await store.setJSON('done/' + key, { username: null, skipped: true, at: new Date().toISOString() });
  await store.delete('pending/' + key);
}

/* ===================== 동기화(1시간마다 / 지금 실행) ===================== */

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

// deadlineMs까지 가능한 만큼 처리. 못 끝낸 건 다음 실행 때 이어서(이미 처리한 수업은 건너뜀).
export async function syncAll({ deadlineMs, dates } = {}) {
  const deadline = deadlineMs || Date.now() + 20000;
  const store = nvoimStore();
  const accounts = await getAccounts();
  const map = await getMemberMap();
  const members = new Set((await listMembers()).map(m => m.username));
  const runDates = dates || (kstHour() < 3 ? [kstDate(0), kstDate(-1)] : [kstDate(0)]);
  const summary = { saved: 0, pending: 0, waiting: 0, errors: [], finished: true, dates: runDates };

  for (const account of accounts) {
    if (Date.now() > deadline - 3000) { summary.finished = false; break; }
    const last = { at: new Date().toISOString(), saved: 0, pending: 0, waiting: 0, error: null };
    try {
      const session = new NvoimSession();
      await session.login(account.userId, decryptText(account.pw));
      for (const date of runDates) {
        const rows = (await session.listLessons(date)).filter(r => r.EvaluationSeq);
        await mapLimit(rows, 2, async (row) => {
         try {
          if (Date.now() > deadline - 1500) { summary.finished = false; return; }
          const key = lessonKey(row.F_STDT_ID, date, row);
          const [done, pend] = await Promise.all([
            store.get('done/' + key, { type: 'json' }),
            store.get('pending/' + key, { type: 'json' }),
          ]);
          if (done || pend) return;
          const fb = await session.getFeedback(row);
          if (!fb.sentenceCorrection.trim() && !fb.mispronouncedWord.trim()) { last.waiting++; return; } // 아직 피드백 작성 전
          const item = {
            key, date,
            nvoimId: row.F_STDT_ID, name: row.F_STDT_NM || row.F_STDT_ID,
            account: account.label,
            sentenceCorrection: fb.sentenceCorrection, mispronouncedWord: fb.mispronouncedWord,
            fetchedAt: new Date().toISOString(),
          };
          const idLower = row.F_STDT_ID.toLowerCase();
          const username = (map[idLower] && members.has(map[idLower])) ? map[idLower] : (members.has(idLower) ? idLower : '');
          if (username) {
            const setId = await saveLessonAsSet(username, item);
            await store.setJSON('done/' + key, { username, setId, at: item.fetchedAt });
            last.saved++;
          } else {
            await store.setJSON('pending/' + key, item);
            last.pending++;
          }
         } catch (e) {
          // 이 학생만 실패 → 다음 실행 때 다시 시도
          last.rowErrors = (last.rowErrors || 0) + 1;
          if (!last.rowError) last.rowError = e.message || String(e);
         }
        });
      }
    } catch (e) {
      last.error = e.message || String(e);
      summary.errors.push(`${account.label}: ${last.error}`);
    }
    if (last.rowErrors) summary.errors.push(`${account.label}: ${last.rowErrors}명 실패 — ${last.rowError}`);
    summary.saved += last.saved; summary.pending += last.pending; summary.waiting += last.waiting;
    await updateAccountLast(account.id, last);
  }
  await store.setJSON('last-run', { at: new Date().toISOString(), ...summary });
  return summary;
}

export async function getLastRun() {
  return await nvoimStore().get('last-run', { type: 'json' });
}
