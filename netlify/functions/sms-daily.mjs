// 📱 매일 공부 안내 문자 — 30분마다 깨어나서 (운영자 지시 2026-11-28)
//   1차(기본 오후 5시): 최근 7일 안 수업의 피드백쉐도잉을 아직 안 한 학생에게 「하라고」
//   2차(기본 오후 9시): 그래도 아직 안 했으면 「꼭 하라고」 (2차 때 다시 확인해서 그사이 한 학생은 안 보내요)
// 전화번호를 넣고 「받기」를 켠 학생만 · 수업이 없었으면 안 보내요 · 각 차수 하루 한 번 · 관리자가 자동 문자를 켜 둔 때만.
import { getSettings, dayAllowed, dailyTargets, sendMany, configured, kstNow, kstDate, notifyDone } from './_lib/sms.mjs';

export default async () => {
  // 🔔 과제 완료 알림(원장님 휴대폰) — 30분마다
  try { const r = await notifyDone(); if (r.sent || r.found) console.log('[sms-done]', JSON.stringify(r)); } catch (e) { console.log('[sms-done] 실패', e.message); }

  const st = await getSettings();
  const kst = kstNow(), hour = kst.getUTCHours(), date = kstDate();
  const stage = hour === st.daily.hour ? 1 : st.daily.second && hour === st.daily.hour2 ? 2 : 0;
  if (!st.daily.on || !stage || !dayAllowed(st.daily.days, kst)) return;
  if (!configured()) { console.log('[sms-daily] 휴대폰 열쇠가 없어서 보내지 않았어요'); return; }
  const list = (await dailyTargets(date, stage)).filter(x => x.send);
  if (!list.length) { console.log(`[sms-daily] ${date} ${hour}시 ${stage}차 · 보낼 학생 없음`); return; }
  try {
    const r = await sendMany(list, 'daily', stage);
    console.log(`[sms-daily] ${date} ${hour}시 ${stage}차 · 보냄 ${r.ok}명 · 실패 ${r.fail.length}명`);
  } catch (e) { console.log('[sms-daily] 실패', e.message); }
};

export const config = { schedule: '*/30 * * * *' }; // 매일 문자는 정한 시각에 한 번만(같은 날 두 번 안 보내요), 과제 완료 알림은 30분마다
