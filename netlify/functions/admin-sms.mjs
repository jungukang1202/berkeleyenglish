// 관리자 — 📱 학원 휴대폰으로 문자 보내기 (관리자 토큰 필요, 운영자 지시 2026-11-28)
// GET  /api/admin-sms → { status, phones, settings, log }
// POST { action:'phones', phones:{ 아이디:{ phone, on } } }      → { phones }
// POST { action:'settings', daily:{ on, hour, days, text } }     → { settings }
// POST { action:'preview' }                                       → { date, targets }   오늘 지금 보내면 받을 학생
// POST { action:'test', phone, text }                             → { ok, fail }        시험 문자 한 통
// POST { action:'send-now' }                                      → { ok, fail, count } 최근 수업 복습 안 한 학생에게 지금 보내기
// POST { action:'refresh' }                                       → { log }             보냄·받음 결과 새로 보기
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { stageNow, deviceStatus, getPhones, savePhones, getSettings, saveSettings, getLog, dailyTargets, sendOne, sendMany, refreshLog, toE164, kstDate, DEFAULT_TEXT } from './_lib/sms.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  try {
    if (req.method === 'GET') {
      const [status, phones, settings, log] = await Promise.all([deviceStatus(), getPhones(), getSettings(), getLog()]);
      return jsonResponse({ status, phones, settings, log, defaultText: DEFAULT_TEXT });
    }
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    let b; try { b = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }

    if (b.action === 'phones') return jsonResponse({ phones: await savePhones(b.phones) });
    if (b.action === 'settings') return jsonResponse({ settings: await saveSettings(b) });
    if (b.action === 'preview') { const stage = b.stage === 1 || b.stage === 2 ? b.stage : stageNow(await getSettings()); return jsonResponse({ date: kstDate(), stage, targets: await dailyTargets(kstDate(), stage) }); }
    if (b.action === 'refresh') return jsonResponse({ log: await refreshLog() });
    if (b.action === 'test') {
      const phone = toE164(b.phone);
      if (!phone) return jsonResponse({ error: 'bad_phone', message: '010으로 시작하는 휴대폰 번호를 넣어 주세요.' }, 400);
      const text = String(b.text || '').trim() || '[버클리] 문자 보내기 시험이에요. 이 문자가 오면 잘 연결된 거예요! 😊';
      return jsonResponse(await sendMany([{ phone, text: text.slice(0, 300) }], 'test'));
    }
    if (b.action === 'send-now') {
      const stage = b.stage === 1 || b.stage === 2 ? b.stage : stageNow(await getSettings());
      const list = (await dailyTargets(kstDate(), stage)).filter(x => x.send);
      if (!list.length) return jsonResponse({ ok: 0, fail: [], count: 0, stage });
      const r = await sendMany(list, 'manual', stage);
      return jsonResponse(Object.assign({ count: list.length, stage }, r));
    }
    return jsonResponse({ error: 'unknown_action' }, 400);
  } catch (e) {
    return jsonResponse({ error: 'failed', message: e.message || 'failed' }, e.status || 500);
  }
};

export const config = { path: '/api/admin-sms' };
