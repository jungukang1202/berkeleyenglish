// 수업 피드백 리포트 — 반드시 관리자 토큰이 필요합니다.
// GET  /api/admin-report?from=YYYY-MM-DD&to=YYYY-MM-DD[&username=] → { report }  (지금 바로 정리, username 주면 그 회원만)
// GET  /api/admin-report?list=1                          → { months: [{month, generatedAt, lessons, students}] }
// GET  /api/admin-report?month=YYYY-MM                   → { report }  (보관된 월별 리포트)
// POST /api/admin-report { action:'snapshot', month }    → 그 달 리포트를 지금 다시 만들어 보관
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { buildReport, buildMemberReport, listMonthlySnapshots, getMonthlySnapshot, saveMonthlySnapshot } from './_lib/report.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      if (url.searchParams.get('list')) return jsonResponse({ months: await listMonthlySnapshots() });
      const month = url.searchParams.get('month');
      if (month) {
        const report = await getMonthlySnapshot(month);
        if (!report) return jsonResponse({ error: 'not_found', message: '보관된 리포트가 없어요.' }, 404);
        return jsonResponse({ report });
      }
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      const username = url.searchParams.get('username');
      if (username) return jsonResponse({ report: await buildMemberReport(username, from, to) });
      return jsonResponse({ report: await buildReport(from, to) });
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body.action === 'snapshot') return jsonResponse({ month: await saveMonthlySnapshot(body.month) });
      return jsonResponse({ error: 'unknown_action' }, 400);
    }
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  } catch (e) {
    return jsonResponse({ error: 'error', message: e.message || String(e) }, 400);
  }
};

export const config = { path: '/api/admin-report' };
