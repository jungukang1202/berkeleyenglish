// 1시간마다 자동 실행: 등록된 엔보임 계정들의 오늘 피드백을 가져와 회원별 회차로 저장합니다.
// (Netlify Scheduled Function — 배포된 사이트에서만 실행되며, 한 번에 최대 30초)
import { syncAll } from './_lib/nvoim.mjs';

export default async () => {
  const started = Date.now();
  const summary = await syncAll({ deadlineMs: started + 25000 });
  console.log('[nvoim-sync]', JSON.stringify(summary));
};

export const config = { schedule: '@hourly' };
