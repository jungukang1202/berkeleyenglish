// POST /api/member-login   body: { username, password }  →  200 { token, username }  /  401 { error }
// 학생이 제대로 쳤는데도 안 되는 흔한 경우를 함께 확인해요(운영자 2026-11-25):
//   ① 휴대폰·PC가 한글 입력 상태라 "tak5677"이 "ㅅ마5677"로 들어감 → 영어 자판 글자로 바꿔서도 확인
//   ② 앞뒤에 띄어쓰기가 붙음(자동 완성·복사) → 띄어쓰기를 뺀 것도 확인
//   ③ 대문자 잠금(Caps Lock)·첫 글자 자동 대문자 → 대소문자를 바꾼 것도 확인
import { signToken, jsonResponse, verifyPassword } from './_lib/auth.mjs';
import { getMember } from './_lib/store.mjs';
import { koToQwerty, hasHangul, swapCase } from './_lib/ko-keys.mjs';
import { clientIp, lockedOut, recordFailure, clearFailures, lockedResponse } from './_lib/login-guard.mjs';

const MEMBER_TOKEN_TTL = 60 * 60 * 24 * 30; // 30일 — 개인 기기에서 계속 로그인 상태 유지
const uniq = a => [...new Set(a.filter(Boolean))];

export default async (req, context) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }

  const typedUser = String((body && body.username) || '').replace(/\s+/g, '');
  const password = String((body && body.password) || '');
  if (!typedUser || !password) return jsonResponse({ error: 'missing_fields' }, 400);

  const users = uniq([typedUser, hasHangul(typedUser) ? koToQwerty(typedUser) : '']).map(u => u.toLowerCase());
  const ip = clientIp(req, context);
  const lock = await lockedOut('member', ip, users[users.length - 1]);
  if (lock) return lockedResponse(jsonResponse, lock.wait);

  let member = null;
  for (const u of users) { member = await getMember(u); if (member) break; }
  if (member) {
    const pw = password.trim();
    const tries = uniq([password, pw, hasHangul(pw) ? koToQwerty(pw) : '', swapCase(pw), hasHangul(pw) ? swapCase(koToQwerty(pw)) : '',
      pw.charAt(0).toLowerCase() + pw.slice(1)]);
    if (tries.some(p => verifyPassword(p, member.passwordHash))) {
      await clearFailures('member', ip, member.username);
      const token = signToken({ role: 'member', username: member.username }, MEMBER_TOKEN_TTL);
      return jsonResponse({ token, username: member.username, expiresIn: MEMBER_TOKEN_TTL });
    }
  }
  console.log(`[member-login] 실패 user=${users.join('|')} reason=${member ? 'wrong_password' : 'no_member'}`);
  await recordFailure('member', ip, member ? member.username : users[users.length - 1]);
  return jsonResponse({
    error: 'invalid_credentials',
    message: member ? '비밀번호가 맞지 않아요. 한글/영어 자판과 대문자를 확인해 주세요.' : '없는 아이디예요. 아이디를 다시 확인해 주세요.',
  }, 401);
};

export const config = { path: '/api/member-login' };
