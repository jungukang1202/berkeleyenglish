// 30분마다 자동 실행(정각·30분): 등록된 엔보임 계정들의 어제·오늘 피드백을 가져와 회원별 회차로 저장합니다.
// 선생님이 밤 수업 피드백을 다음 날 쓰는 경우도 있어서 항상 어제 날짜까지 함께 확인해요.
// (Netlify Scheduled Function — 배포된 사이트에서만 실행되며, 한 번에 최대 30초)
import { syncAll, kstDate, recordAutoFailure } from './_lib/nvoim.mjs';

export default async () => {
  const started = Date.now();
  try {
    const summary = await syncAll({ deadlineMs: started + 25000, dates: [kstDate(0), kstDate(-1)], source: 'auto' });
    console.log('[nvoim-sync]', JSON.stringify(summary));
  } catch (e) {
    console.error('[nvoim-sync] 실패', e);
    try { await recordAutoFailure(e && e.message); } catch (_) {}
  }
};

export const config = { schedule: '*/30 * * * *' };
