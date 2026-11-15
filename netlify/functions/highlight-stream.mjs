// ✂️ 수업영상 하이라이트 재생 — GET /api/highlight-stream?u=학생&id=…&t=서명토큰
// 영상은 3.5MB 조각으로 저장돼 있어서, 요청한 위치가 들어 있는 조각 하나만큼만 206으로 돌려줘요(video-stream.mjs와 같은 방식).
// 학생 화면의 「⬇️ 내려받기」는 조각을 차례로 받아 한 파일로 모아요. 토큰은 목록 API(member-highlights · admin-highlights)가 발급해요.
import { verifyToken } from './_lib/auth.mjs';
import { getHighlight, hlStore, chunkKey, HL_CHUNK } from './_lib/highlights.mjs';

export default async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const url = new URL(req.url);
  const u = String(url.searchParams.get('u') || '').toLowerCase(), id = url.searchParams.get('id') || '';
  const tok = verifyToken(url.searchParams.get('t') || '');
  if (!tok || tok.role !== 'hl' || tok.u !== u || tok.id !== id) return new Response('forbidden', { status: 403 });
  const h = await getHighlight(u, id);
  if (!h || h.status !== 'ready') return new Response('not found', { status: 404 });

  let start = 0, end = h.size - 1;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (range) {
    if (range[1] === '' && range[2] !== '') start = Math.max(0, h.size - Number(range[2]));
    else { start = Number(range[1] || 0); if (range[2] !== '') end = Math.min(Number(range[2]), h.size - 1); }
  }
  if (start >= h.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${h.size}` } });
  const n = Math.floor(start / HL_CHUNK), chunkStart = n * HL_CHUNK;
  end = Math.min(end, chunkStart + HL_CHUNK - 1, h.size - 1);
  const headers = {
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${h.size}`, 'Content-Length': String(end - start + 1),
    'Cache-Control': 'private, max-age=43200',
  };
  if (req.method === 'HEAD') return new Response(null, { status: 206, headers });
  const buf = await hlStore().get(chunkKey(u, id, n), { type: 'arrayBuffer' });
  if (!buf) return new Response('chunk missing', { status: 404 });
  return new Response(new Uint8Array(buf).subarray(start - chunkStart, end - chunkStart + 1), { status: 206, headers });
};

export const config = { path: '/api/highlight-stream' };
