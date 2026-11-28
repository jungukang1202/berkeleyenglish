// 📱 매일 공부 안내 문자 — 매시 정각에 깨어나서, 관리자가 정한 시각(한국 시간)이면
// 전화번호를 넣고 「받기」를 켠 학생 중 오늘 쉐도잉을 하나도 안 한 학생에게만 학원 휴대폰으로 문자를 보내요.
// 한 학생에게 하루 한 번만. 관리자가 자동 문자를 켜 둔 때만 보내요. (운영자 지시 2026-11-28)
import { getSettings, dayAllowed, dailyTargets, sendMany, configured, kstNow, kstDate } from './_lib/sms.mjs';

export default async () => {
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

export const config = { schedule: '0 * * * *' };
