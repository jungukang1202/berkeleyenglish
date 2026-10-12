// 엔보임 자동 가져오기 관리 — 반드시 관리자 토큰이 필요합니다.
// GET  /api/admin-nvoim                                  → { accounts, pending, map, lastRun }
// POST /api/admin-nvoim { action:'add-account', label, userId, password }   (로그인 확인 후 저장)
// POST /api/admin-nvoim { action:'delete-account', id }
// POST /api/admin-nvoim { action:'run', date? }          → 지금 바로 가져오기 / 특정 날짜 가져오기(finished:false면 다시 호출)
// POST /api/admin-nvoim { action:'assign', key, username } → "회원 선택 필요" 항목 저장 + 연결 기억
// POST /api/admin-nvoim { action:'dismiss', key }        → 저장하지 않고 넘기기
// POST /api/admin-nvoim { action:'unmap', nvoimId }      → 학생↔회원 연결 해제
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import {
  getAccounts, publicAccount, addAccount, deleteAccount, getMemberMap, setMemberMapping,
  listPending, assignPending, dismissPending, syncAll, getLastRun,
} from './_lib/nvoim.mjs';

export default async (req) => {
  const auth = requireAuth(req, 'admin');
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const [accounts, pending, map, lastRun] = await Promise.all([getAccounts(), listPending(), getMemberMap(), getLastRun()]);
    return jsonResponse({ accounts: accounts.map(publicAccount), pending, map, lastRun });
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }

  try {
    switch (body && body.action) {
      case 'add-account':
        return jsonResponse({ account: await addAccount(body) });
      case 'delete-account':
        await deleteAccount(body.id);
        return jsonResponse({ ok: true });
      case 'run': {
        // 일반 함수는 약 10초 제한이 있어서 8초까지만 처리하고, 남은 건 화면이 다시 호출합니다.
        // body.date(YYYY-MM-DD)를 주면 그 날짜만, 없으면 오늘(새벽엔 어제 포함).
        let dates;
        if (body.date) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return jsonResponse({ error: 'invalid_date' }, 400);
          dates = [body.date];
        }
        const summary = await syncAll({ deadlineMs: Date.now() + 8000, dates });
        return jsonResponse({ summary });
      }
      case 'assign':
        if (!body.key || !body.username) return jsonResponse({ error: 'key_and_username_required' }, 400);
        return jsonResponse(await assignPending(body.key, body.username));
      case 'dismiss':
        if (!body.key) return jsonResponse({ error: 'key_required' }, 400);
        await dismissPending(body.key);
        return jsonResponse({ ok: true });
      case 'unmap':
        return jsonResponse({ map: await setMemberMapping(body.nvoimId, '') });
      default:
        return jsonResponse({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: 'error', message: e.message || String(e) }, 400);
  }
};

export const config = { path: '/api/admin-nvoim' };
