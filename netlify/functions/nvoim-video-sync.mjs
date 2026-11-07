// 30분마다 자동 실행(정각·30분): 연결된 학생들의 엔보임 수강생 페이지에서 새 수업 녹화를 찾아 둡니다.
// 찾은 녹화는 관리자 화면 「🎥 엔보임 수업영상 자동 가져오기」에 🆕 새 녹화로 보이고, 받아쓰기는 관리자 창에서 해요.
// (Netlify Scheduled Function — 배포된 사이트에서만 실행되며, 한 번에 최대 30초)
import { scanAll, recordVideoAutoFailure } from './_lib/nvoim-video.mjs';

export default async () => {
  try {
    const summary = await scanAll({ deadlineMs: Date.now() + 25000, source: 'auto' });
    console.log('[nvoim-video-sync]', JSON.stringify(summary));
  } catch (e) {
    console.error('[nvoim-video-sync] 실패', e);
    try { await recordVideoAutoFailure(e && e.message); } catch (_) {}
  }
};

export const config = { schedule: '*/30 * * * *' };
