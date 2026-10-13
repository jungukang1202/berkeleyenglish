// 회원 본인의 학습 리포트(분석) — 반드시 회원 토큰이 필요하고, 로그인한 회원 본인 것만 볼 수 있습니다.
// GET /api/member-insight?months=1                     → { months:[{month, saved}], latestSaved }
// GET /api/member-insight?month=YYYY-MM                → { report }  (지난달 이전은 매달 1일에 보관된 리포트)
// GET /api/member-insight?from=YYYY-MM-DD&to=YYYY-MM-DD → { report }  (기간 정해서 분석)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { studentReport, studentMonths } from './_lib/insight.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'member');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('months')) return jsonResponse({ months: await studentMonths(auth.username) });
    const month = url.searchParams.get('month');
    const report = await studentReport(auth.username, month ? { month } : { from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    return jsonResponse({ report });
  } catch (e) {
    return jsonResponse({ error: 'error', message: e.message || String(e) }, 400);
  }
};

export const config = { path: '/api/member-insight' };
