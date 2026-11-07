// 엔보임 수업영상 자동 가져오기 — 반드시 관리자 토큰이 필요합니다. (js/nvoim-video.js가 사용)
// GET  /api/admin-nvoim-video                                   → { accounts, students, found, lastRun, autoLog }
// GET  /api/admin-nvoim-video?records=회원아이디                 → { recordings:[{ id, title, date, sentenceCount, ... }] }  (🎥 수업영상 쉐도잉 기록)
// GET  /api/admin-nvoim-video?saved=회원아이디                   → { recordings } 「💾 저장」한 녹화 (🎥 수업영상 쉐도잉 만들기)
// POST /api/admin-nvoim-video { action:'save', recording, username } → 찾은 녹화를 그 회원 것으로 저장
// POST /api/admin-nvoim-video { action:'run' }                   → 지금 바로 가져오기: 연결된 학생의 새 녹화 찾기 (finished:false면 다시 호출)
// POST /api/admin-nvoim-video { action:'scan', studentId, accountId?, html? } → { recordings:[{ url, kind, date, label, key, done }], diag, html? }
// POST /api/admin-nvoim-video { action:'start', url, studentId, title, accountId?, referer? } → { lesson, chunks, size, mime }
// POST /api/admin-nvoim-video { action:'chunk', id, n }          → 영상 조각 바이너리 (저장도 함께)
// POST /api/admin-nvoim-video { action:'finish', id, username?, date?, studentId? } → 수업 녹화로 표시 + 그 학생에게 넣어주기 (녹화 파일을 올려 만든 영상도)
// POST /api/admin-nvoim-video { action:'cancel', id }            → 만들던 레슨·조각 지우기
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { getAccounts, publicAccount } from './_lib/nvoim.mjs';
import { scanStudent, listStudents, startTransfer, transferChunk, finishTransfer, cancelTransfer, scanAll, getRunInfo, memberRecordings, saveRecording, savedRecordings } from './_lib/nvoim-video.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);

  if (req.method === 'GET') {
    const who = new URL(req.url).searchParams.get('records');
    if (who != null) return jsonResponse({ recordings: await memberRecordings(who) });
    const savedFor = new URL(req.url).searchParams.get('saved');
    if (savedFor != null) return jsonResponse({ recordings: await savedRecordings(savedFor) });
    const [accounts, students, info] = await Promise.all([getAccounts(), listStudents(), getRunInfo()]);
    return jsonResponse({ accounts: accounts.map(publicAccount), students, ...info });
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  try {
    switch (body && body.action) {
      case 'run':
        // 일반 함수는 약 10초 제한이 있어서 8초까지만 찾고, 남은 학생은 화면이 다시 호출합니다.
        return jsonResponse({ summary: await scanAll({ deadlineMs: Date.now() + 8000 }) });
      case 'save':
        return jsonResponse({ saved: await saveRecording(body.recording, body.username) });
      case 'scan':
        return jsonResponse(await scanStudent(body.studentId, body.accountId, { withHtml: !!body.html }));
      case 'start':
        return jsonResponse(await startTransfer(body));
      case 'chunk': {
        let buf;
        try { buf = await transferChunk(String(body.id || ''), Number(body.n)); }
        catch (e) { if (e.notYet) return jsonResponse({ wait: true, got: e.got }, 202); throw e; }
        return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
      }
      case 'finish':
        return jsonResponse(await finishTransfer(String(body.id || ''), String(body.username || ''), { date: body.date, studentId: body.studentId }));
      case 'cancel':
        await cancelTransfer(String(body.id || ''));
        return jsonResponse({ ok: true });
      default:
        return jsonResponse({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    return jsonResponse({ error: 'error', message: e.message || String(e) }, 400);
  }
};

export const config = { path: '/api/admin-nvoim-video' };
