// 회원 연습 기록 저장소 — 회원이 member.html에서 "▶ 연습 시작"으로 반복할 때마다
// 한 번 한 번(듣기만 / 따라 말하기 + 일치도)을 회차별로 쌓아둡니다. 관리자 페이지의 "📊 연습 기록"에서 봅니다.
//   practice-log     : `${username}/${setId}` → { username, setId, attempts:[...] }
//   practice-summary : `${username}`          → { [setId]: { listen, spoke, failed, scoreSum, best, last } }
import { getStore } from '@netlify/blobs';

const MAX_ATTEMPTS_PER_SET = 5000; // 너무 커지지 않게 회차당 최근 5000번까지만 보관
const MAX_PER_REQUEST = 200;

function logStore() { return getStore({ name: 'practice-log', consistency: 'strong' }); }
function summaryStore() { return getStore({ name: 'practice-summary', consistency: 'strong' }); }

function norm(u) { return String(u || '').trim().toLowerCase(); }
function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }

// 브라우저에서 온 기록 한 건을 안전한 모양으로 정리합니다.
export function cleanAttempt(a) {
  if (!a || typeof a !== 'object') return null;
  const mode = a.mode === 'mic' ? 'mic' : a.mode === 'listen' ? 'listen' : null;
  if (!mode) return null;
  const type = ['sentence', 'word', 'variant'].includes(a.type) ? a.type : 'sentence';
  const t = Date.parse(a.at);
  const out = {
    at: Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(),
    type,
    idx: Number.isInteger(a.idx) && a.idx >= 0 && a.idx < 10000 ? a.idx : -1,
    target: clip(a.target, 500),
    mode,
    rep: Number.isInteger(a.rep) ? Math.max(0, Math.min(a.rep, 99)) : 0,
    of: Number.isInteger(a.of) ? Math.max(0, Math.min(a.of, 99)) : 0,
    session: clip(a.session, 20),
  };
  if (mode === 'mic') {
    out.ok = !!a.ok;
    if (out.ok) {
      out.heard = clip(a.heard, 500);
      const s = Number(a.score);
      out.score = Number.isFinite(s) ? Math.max(0, Math.min(100, Math.round(s))) : 0;
    } else {
      out.error = clip(a.error, 40);
    }
  }
  if (!out.target) return null;
  return out;
}

export async function addAttempts(username, setId, rawAttempts) {
  const uname = norm(username);
  const list = (Array.isArray(rawAttempts) ? rawAttempts : []).slice(0, MAX_PER_REQUEST).map(cleanAttempt).filter(Boolean);
  if (!list.length) return { added: 0 };

  const ls = logStore();
  const key = `${uname}/${setId}`;
  const rec = (await ls.get(key, { type: 'json' })) || { username: uname, setId, attempts: [] };
  rec.attempts = rec.attempts.concat(list);
  if (rec.attempts.length > MAX_ATTEMPTS_PER_SET) rec.attempts = rec.attempts.slice(-MAX_ATTEMPTS_PER_SET);
  rec.updatedAt = new Date().toISOString();
  await ls.setJSON(key, rec);

  // 회차 목록 옆 버튼에 숫자를 빨리 보여주기 위한 요약
  const ss = summaryStore();
  const sum = (await ss.get(uname, { type: 'json' })) || {};
  const s = sum[setId] || { listen: 0, spoke: 0, failed: 0, scoreSum: 0, best: 0, last: null };
  const sents = new Set(Array.isArray(s.sents) ? s.sents : []);
  list.forEach(a => {
    if (a.type === 'sentence' && a.idx >= 0) sents.add(a.idx); // 한 번이라도 연습한 문장 번호 (교재 '공부한 양 %')
    if (a.mode === 'listen') s.listen++;
    else if (a.ok) { s.spoke++; s.scoreSum += a.score; if (a.score > s.best) s.best = a.score; }
    else s.failed++;
    if (!s.last || a.at > s.last) s.last = a.at;
  });
  s.sents = [...sents].sort((a, b) => a - b);
  sum[setId] = s;
  await ss.setJSON(uname, sum);
  return { added: list.length };
}

// 문장마다 연습한 횟수 · 따라 말한 횟수 { counts:{번호:n}, mic:{번호:n}, sents:[번호] } — 기록(로그)에서 셉니다
export async function sentenceCounts(username, setId) {
  const log = await getLog(username, setId);
  const counts = {}, mic = {};
  (log.attempts || []).forEach(a => {
    if (a.type !== 'sentence' || !(a.idx >= 0)) return;
    counts[a.idx] = (counts[a.idx] || 0) + 1;
    if (a.mode === 'mic') mic[a.idx] = (mic[a.idx] || 0) + 1;
  });
  return { counts, mic, sents: Object.keys(counts).map(Number).sort((a, b) => a - b) };
}

// 지금까지 듣기 · 따라 말하기 횟수 (🔥 1000번 목표 배너) — 따라 말하기도 원어민 문장을 먼저 들으니 듣기에 더해요
export function practiceTotals(summary) {
  return Object.values(summary || {}).reduce((t, x) => {
    const speak = ((x && x.spoke) || 0) + ((x && x.failed) || 0);
    t.listen += ((x && x.listen) || 0) + speak; t.speak += speak; return t;
  }, { listen: 0, speak: 0 });
}

export async function getSummary(username) {
  return (await summaryStore().get(norm(username), { type: 'json' })) || {};
}

export async function getLog(username, setId) {
  const uname = norm(username);
  return (await logStore().get(`${uname}/${setId}`, { type: 'json' })) || { username: uname, setId, attempts: [] };
}

export async function clearPractice(username, setId) {
  const uname = norm(username);
  await logStore().delete(`${uname}/${setId}`);
  const ss = summaryStore();
  const sum = await ss.get(uname, { type: 'json' });
  if (sum && sum[setId]) { delete sum[setId]; await ss.setJSON(uname, sum); }
}

export async function clearMemberPractice(username) {
  const uname = norm(username);
  const ls = logStore();
  const { blobs } = await ls.list({ prefix: `${uname}/` });
  await Promise.all(blobs.map(b => ls.delete(b.key)));
  await summaryStore().delete(uname);
}
