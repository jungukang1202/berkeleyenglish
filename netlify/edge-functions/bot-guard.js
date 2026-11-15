// 🛡️ 로봇·AI 차단 (모든 주소 앞에서 먼저 실행돼요)
//  ① AI 학습·수집 로봇(GPTBot, ClaudeBot, PerplexityBot, Bytespider …)과 AI 에이전트 서명(Signature-Agent)은 사이트 전체 차단
//  ② 관리자·회원·영상·쉐도잉·신청 화면과 서버 주소(/api)는 사람 브라우저가 아닌 모든 접근 차단
//     (검색 로봇, curl·python 같은 프로그램, 자동 조종 브라우저 Headless·Playwright·Selenium …)
//  ③ 첫 화면·과정 소개는 네이버·구글 같은 검색 로봇이 볼 수 있어요(학원 홍보). robots.txt는 누구나 읽을 수 있어요.
const AI_BOTS = /GPTBot|ChatGPT|OAI-SearchBot|OpenAI|ClaudeBot|Claude-|anthropic|GoogleOther|Google-CloudVertexBot|CCBot|PerplexityBot|Perplexity|Bytespider|ByteDance|Amazonbot|meta-external|FacebookBot|cohere|Diffbot|YouBot|AI2Bot|Ai2Bot|DuckAssistBot|MistralAI|Timpibot|omgili|ImagesiftBot|PetalBot|img2dataset|Scrapy|magpie-crawler|VelenPublicWebCrawler|Kangaroo Bot|PanguBot|Brightbot|TikTokSpider|SemrushBot|AhrefsBot|MJ12bot|DotBot|webzio|FirecrawlAgent|Firecrawl|Crawl4AI|Jina|Cotoyogi|QualifiedBot|Novellum|Andibot|bedrockbot|LinerBot|Manus|Devin|Kimi|Qwen|Doubao|ChatGLM|DeepSeek|Sidetrade|ISSCyberRiskCrawler|SeekportBot|Spawning|iaskspider|Factset|wpbot|Awario|DataForSeoBot|BLEXBot|serpstatbot|Barkrowler/i;
const NOT_BROWSER = /bot\b|bot\/|crawl|spider|slurp|curl|wget|python|httpx|aiohttp|axios|node-fetch|undici|^node$|okhttp|java\/|go-http-client|libwww|perl|ruby|php\/|scrapy|headless|phantom|selenium|webdriver|puppeteer|playwright|httpclient|postman|insomnia|http_request|feedfetcher|preview|scrap|fetcher|monitor|uptime|lighthouse|pagespeed|gtmetrix/i;
const PROTECTED = /^\/(admin|member|video|shadowing|apply)(\.html)?\/?$|^\/api\/|^\/\.netlify\/functions\/|^\/js\/|^\/version\.json$/i;

function block(why) {
  return new Response('403 Forbidden — 이 사이트는 로봇·AI의 접근을 허용하지 않아요. (Automated and AI access is not allowed.)', {
    status: 403,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
      'X-Blocked-Reason': why,
    },
  });
}

export default async (request) => {
  const url = new URL(request.url);
  if (url.pathname === '/robots.txt') return; // 규칙은 읽게 해 줘요
  const ua = request.headers.get('user-agent') || '';
  // AI 에이전트가 자기를 밝히는 서명(Web Bot Auth) — 사람 브라우저는 보내지 않아요
  if (request.headers.get('signature-agent') || /web-bot-auth/i.test(request.headers.get('signature-input') || '')) return block('ai-agent');
  if (AI_BOTS.test(ua)) return block('ai-bot');
  if (PROTECTED.test(url.pathname)) {
    if (!ua || ua.length < 20 || NOT_BROWSER.test(ua) || !/Mozilla\/5\.0/.test(ua)) return block('not-browser');
    // 사람 브라우저는 언어 정보를 보내요(프로그램은 대개 안 보내요)
    if (!request.headers.get('accept-language') && request.method === 'GET' && !url.pathname.startsWith('/api/')) return block('no-language');
  }
};

export const config = { path: '/*', excludedPath: ['/videos/*'] };
