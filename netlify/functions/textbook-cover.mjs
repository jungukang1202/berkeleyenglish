// 📖 교재 표지 그림 — /images/textbooks/파일이름 으로 들어오면 저장해 둔 그림을 보내요 (로그인 없이)
// GET /api/textbook-cover?name=grammar-n.png
import { coverStore, okCoverName } from './_lib/books.mjs';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export default async (req) => {
  const url = new URL(req.url);
  let name = url.searchParams.get('name') || decodeURIComponent(url.pathname.split('/').pop() || '');
  name = String(name).toLowerCase();
  if (!okCoverName(name)) return new Response('not found', { status: 404 });
  const data = await coverStore().get(name, { type: 'arrayBuffer' });
  if (!data) return new Response('not found', { status: 404 });
  return new Response(data, { headers: { 'Content-Type': TYPES[name.split('.').pop()] || 'image/png', 'Cache-Control': 'public, max-age=86400' } });
};

// preferStatic: 사이트에 들어 있는 기본 교재 표지(images/textbooks/*.png)가 있으면 그 파일을, 없으면 저장해 둔 그림을 보내요
export const config = { path: ['/api/textbook-cover', '/images/textbooks/*'], preferStatic: true };
