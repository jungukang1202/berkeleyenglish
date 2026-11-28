// 📱 매일 공부 안내 문자 — 30분마다 깨어나서, 관리자가 정한 시각(한국 시간)이면
// 전화번호를 넣고 「받기」를 켠 학생 중, 최근 7일 안에 수업이 있었는데 그 수업 피드백쉐도잉을 아직 안 한 학생에게만
// 학원 휴대폰으로 문자를 보내요(수업이 없었으면 안 보내요).
// 한 학생에게 하루 한 번만. 관리자가 자동 문자를 켜 둔 때만 보내요. (운영자 지시 2026-11-28)
import { getSettings, dayAllowed, dailyTargets, sendMany, configured, kstNow, kstDate, notifyDone } from './_lib/sms.mjs';

export default async () => {
  // 🔔 과제 완료 알림(원장님 휴대폰) — 30분마다
  try { const r = await notifyDone(); if (r.sent || r.found) console.log('[sms-done]', JSON.stringify(r)); } catch (e) { console.log('[sms-done] 실패', e.message); }

  const st = await getSettings();
  const kst = kstNow(), hour = kst.getUTCHours(), date = kstDate();
  if (!st.daily.on || hour !== st.daily.hour || !dayAllowed(st.daily.days, kst)) return;
  if (!configured()) { console.log('[sms-daily] 휴대폰 열쇠가 없어서 보내지 않았어요'); return; }
  const list = (await dailyTargets(date)).filter(x => x.send);
  if (!list.length) { console.log(`[sms-daily] ${date} ${hour}시 · 보낼 학생 없음`); return; }
  try {
    const r = await sendMany(list, 'daily');
    console.log(`[sms-daily] ${date} ${hour}시 · 보냄 ${r.ok}명 · 실패 ${r.fail.length}명`);
  } catch (e) { console.log('[sms-daily] 실패', e.message); }
};

export const config = { schedule: '*/30 * * * *' }; // 매일 문자는 정한 시각에 한 번만(같은 날 두 번 안 보내요), 과제 완료 알림은 30분마다
