// 🔐 로그인 막기: 비밀번호를 계속 바꿔 넣어 보는 로봇·사람을 막아요.
//   같은 인터넷 주소(IP)에서 15분 동안 40번 틀리면 → 15분 동안 그 주소의 로그인을 막아요.
//     (학원처럼 여러 학생이 같은 와이파이를 쓰면 IP가 같아서, 예전 10번은 다른 학생까지 막혔어요 — 2026-11-25)
//   같은 아이디로 15분 동안 10번 틀리면 → 15분 동안 그 아이디의 로그인을 막아요 (학생 비밀번호 맞히기 방지).
//   관리자가 「👤 회원 관리」에서 비밀번호를 바꾸면 그 아이디의 잠금은 바로 풀려요.
//   로그인에 성공하면 그 주소·아이디의 틀린 기록을 지워요.
import { getStore } from '@netlify/blobs';

const WINDOW = 15 * 60 * 1000;
const LIMIT = { ip: 40, user: 10 };
const store = () => getStore({ name: 'login-guard', consistency: 'strong' });
const safeKey = s => String(s || '').toLowerCase().replace(/[^\w.:@-]/g, '_').slice(0, 120);

export function clientIp(req, context) {
  return (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

async function recent(key) {
  try {
    const r = await store().get(key, { type: 'json' });
    const now = Date.now();
    return (r && Array.isArray(r.fails) ? r.fails : []).filter(t => now - t < WINDOW);
  } catch (e) { return []; }
}

// 막혀 있으면 { wait: 남은 초 }, 아니면 null
export async function lockedOut(kind, ip, username) {
  const checks = [[`${kind}:ip:${safeKey(ip)}`, LIMIT.ip]];
  if (username) checks.push([`${kind}:user:${safeKey(username)}`, LIMIT.user]);
  for (const [key, limit] of checks) {
    const f = await recent(key);
    if (f.length >= limit) return { wait: Math.max(1, Math.ceil((f[0] + WINDOW - Date.now()) / 1000)) };
  }
  return null;
}

export async function recordFailure(kind, ip, username) {
  const keys = [`${kind}:ip:${safeKey(ip)}`];
  if (username) keys.push(`${kind}:user:${safeKey(username)}`);
  await Promise.all(keys.map(async key => {
    const f = await recent(key);
    f.push(Date.now());
    try { await store().setJSON(key, { fails: f.slice(-50) }); } catch (e) {}
  }));
  await new Promise(r => setTimeout(r, 600)); // 틀리면 조금 늦게 답해서 빠르게 맞혀 보기 어렵게
}

export async function clearFailures(kind, ip, username) {
  const keys = [`${kind}:ip:${safeKey(ip)}`];
  if (username) keys.push(`${kind}:user:${safeKey(username)}`);
  await Promise.all(keys.map(k => store().delete(k).catch(() => {})));
}

export function lockedResponse(jsonResponse, wait) {
  const min = Math.ceil(wait / 60);
  return jsonResponse({ error: 'too_many_attempts', retryAfter: wait, message: `비밀번호를 여러 번 틀려서 잠시 로그인을 막았어요. 약 ${min}분 뒤에 다시 해 주세요.` }, 429);
}

// 관리자가 비밀번호를 바꿔 주면 그 아이디의 잠금을 바로 풀어요
export async function clearUserLock(kind, username) {
  try { await store().delete(`${kind}:user:${safeKey(username)}`); } catch (e) {}
}
