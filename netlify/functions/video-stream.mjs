// 영상 재생 — GET /api/video-stream?id=xxx&t=서명토큰   (브라우저 <video>가 Range 요청으로 조금씩 받아갑니다)
// 영상은 3.5MB 조각으로 저장돼 있어서, 요청한 위치가 들어있는 조각 하나만큼만 206 Partial Content로 돌려줍니다.
// <video> 태그는 Authorization 헤더를 못 보내므로, 목록 API가 발급한 짧은 기간용 토큰(t)을 주소에 붙여 확인합니다.
import { verifyToken } from './_lib/auth.mjs';
import { getLesson, chunksStore, chunkKey } from './_lib/videos.mjs';

const metaCache = new Map(); // 같은 함수 인스턴스 안에서 메타 정보를 잠깐 기억(조각마다 다시 읽지 않게)

async function meta(id) {
  const hit = metaCache.get(id);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const v = await getLesson(id);
  if (v) metaCache.set(id, { v: { size: v.size, chunkSize: v.chunkSize, chunks: v.chunks, mime: v.mime }, at: Date.now() });
  return v ? metaCache.get(id).v : null;
}

export default async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';
  const tok = verifyToken(url.searchParams.get('t') || '');
  if (!tok || tok.role !== 'video' || tok.vid !== id) return new Response('forbidden', { status: 403 });

  const m = await meta(id);
  if (!m) return new Response('not found', { status: 404 });

  let start = 0, end = m.size - 1;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (range) {
    if (range[1] === '' && range[2] !== '') { start = Math.max(0, m.size - Number(range[2])); }
    else {
      start = Number(range[1] || 0);
      if (range[2] !== '') end = Math.min(Number(range[2]), m.size - 1);
    }
  }
  if (start >= m.size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${m.size}` } });
  }
  const n = Math.floor(start / m.chunkSize);
  const chunkStart = n * m.chunkSize;
  end = Math.min(end, chunkStart + m.chunkSize - 1, m.size - 1);

  const headers = {
    'Content-Type': m.mime || 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${m.size}`,
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'private, max-age=43200',
  };
  if (req.method === 'HEAD') return new Response(null, { status: 206, headers });

  const buf = await chunksStore().get(chunkKey(id, n), { type: 'arrayBuffer' });
  if (!buf) return new Response('chunk missing', { status: 404 });
  const body = new Uint8Array(buf).subarray(start - chunkStart, end - chunkStart + 1);
  return new Response(body, { status: 206, headers });
};

export const config = { path: '/api/video-stream' };
