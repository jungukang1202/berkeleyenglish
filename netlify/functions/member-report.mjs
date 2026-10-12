// 회원 본인의 월별 수업 피드백 리포트 — 반드시 회원 토큰이 필요하고, 로그인한 회원 본인 것만 볼 수 있습니다.
// GET /api/member-report?months=1        → { months: [{month, lessons, sentences, words}] }
// GET /api/member-report?month=YYYY-MM   → { report: { username, name, from, to, lessons:[...] } }
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { memberMonths, buildMemberReport, monthRange } from './_lib/report.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('months')) return jsonResponse({ months: await memberMonths(auth.username) });
    const { from, to } = monthRange(url.searchParams.get('month'));
    const report = await buildMemberReport(auth.username, from, to);
    report.month = url.searchParams.get('month');
    return jsonResponse({ report });
  } catch (e) {
    return jsonResponse({ error: 'error', message: e.message || String(e) }, 400);
  }
};

export const config = { path: '/api/member-report' };
