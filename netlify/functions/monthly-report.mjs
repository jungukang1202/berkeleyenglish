// 매달 1일 오전 9시 30분(한국 시간)에 지난달 학습 리포트를 회원마다 만들어 보관합니다.
// (Netlify Scheduled Function — cron은 UTC 기준: 1일 00:30 UTC = 한국 09:30)
import { saveMonthlyReports, previousMonthKst } from './_lib/insight.mjs';

export default async () => {
  const month = previousMonthKst();
  const info = await saveMonthlyReports(month);
  console.log('[monthly-report]', JSON.stringify(info));
};

export const config = { schedule: '30 0 1 * *' };
