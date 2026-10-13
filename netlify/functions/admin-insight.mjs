// 학습 리포트(분석) — 반드시 관리자 토큰이 필요합니다.
// GET  /api/admin-insight?months=1[&username=]                → { months:[{month, saved}] } / 보관된 달 목록
// GET  /api/admin-insight?month=YYYY-MM[&username=]           → { report }  (username 없으면 전체 회원 요약)
// GET  /api/admin-insight?from=YYYY-MM-DD&to=YYYY-MM-DD[&username=] → { report }
// POST /api/admin-insight { action:'save-month', month }       → 그 달 리포트를 지금 다시 만들어 보관
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { studentReport, overviewReport, studentMonths, savedMonths, saveMonthlyReports, todayKst } from './_lib/insight.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const username = url.searchParams.get('username');
      if (url.searchParams.get('months')) {
        if (username) return jsonResponse({ months: await studentMonths(username) });
        const saved = await savedMonths();
        const set = new Set([todayKst().slice(0, 7), ...saved.map(s => s.month)]);
        // 최근 12개월은 항상 고를 수 있게
        const now = todayKst().slice(0, 7);
        for (let i = 1; i < 12; i++) { const d = new Date(Date.UTC(+now.slice(0, 4), +now.slice(5, 7) - 1 - i, 1)); set.add(d.toISOString().slice(0, 7)); }
        return jsonResponse({ months: [...set].sort().reverse().map(m => ({ month: m, saved: saved.some(s => s.month === m) })) });
      }
      const month = url.searchParams.get('month');
      const opts = month ? { month } : { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
      const report = username ? await studentReport(username, opts) : await overviewReport(opts);
      return jsonResponse({ report });
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body.action === 'save-month') return jsonResponse({ result: await saveMonthlyReports(body.month) });
      return jsonResponse({ error: 'unknown_action' }, 400);
    }
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  } catch (e) {
    return jsonResponse({ error: 'error', message: e.message || String(e) }, 400);
  }
};

export const config = { path: '/api/admin-insight' };
