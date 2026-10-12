// 매달 1일 오전 9시 30분(한국 시간)에 지난달 피드백 리포트를 만들어 보관합니다.
// (Netlify Scheduled Function — cron은 UTC 기준: 1일 00:30 UTC = 한국 09:30)
import { saveMonthlySnapshot, previousMonthKst } from './_lib/report.mjs';

export default async () => {
  const month = previousMonthKst();
  const info = await saveMonthlySnapshot(month);
  console.log('[monthly-report]', JSON.stringify(info));
};

export const config = { schedule: '30 0 1 * *' };
