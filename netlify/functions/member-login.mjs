// POST /api/member-login   body: { username, password }  →  200 { token, username }  /  401 { error }
import { signToken, jsonResponse } from './_lib/auth.mjs';
import { verifyMemberLogin } from './_lib/store.mjs';
import { clientIp, lockedOut, recordFailure, clearFailures, lockedResponse } from './_lib/login-guard.mjs';

const MEMBER_TOKEN_TTL = 60 * 60 * 24 * 30; // 30일 — 개인 기기에서 계속 로그인 상태 유지

export default async (req, context) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }

  const username = String((body && body.username) || '').trim();
  const password = String((body && body.password) || '');
  if (!username || !password) return jsonResponse({ error: 'missing_fields' }, 400);

  const ip = clientIp(req, context);
  const lock = await lockedOut('member', ip, username);
  if (lock) return lockedResponse(jsonResponse, lock.wait);
  const ok = await verifyMemberLogin(username, password);
  if (!ok) { await recordFailure('member', ip, username); return jsonResponse({ error: 'invalid_credentials' }, 401); }
  await clearFailures('member', ip, username);

  const token = signToken({ role: 'member', username: username.toLowerCase() }, MEMBER_TOKEN_TTL);
  return jsonResponse({ token, username: username.toLowerCase(), expiresIn: MEMBER_TOKEN_TTL });
};

export const config = { path: '/api/member-login' };
