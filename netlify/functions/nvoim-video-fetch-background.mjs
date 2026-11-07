// 엔보임 수업 녹화 받기(백그라운드 함수, 최대 15분) — 반드시 관리자 토큰이 필요합니다. (js/nvoim-video.js가 사용)
// POST /.netlify/functions/nvoim-video-fetch-background { id }
// 녹화 서버(boda.saeha.com)가 나눠 받기(Range)를 지원하지 않아서, 파일을 처음부터 끝까지 받아 3.5MB 조각으로 저장해요.
// 관리자 화면은 'chunk'로 조각이 생길 때마다 받아 가요(아직이면 잠시 뒤 다시).
import { requireAuth } from './_lib/auth.mjs';
import { streamTransfer } from './_lib/nvoim-video.mjs';

export default async (req) => {
  if (!requireAuth(req, 'admin')) return new Response('unauthorized', { status: 401 });
  let body = {};
  try { body = await req.json(); } catch (e) {}
  await streamTransfer(String(body.id || ''));
};
