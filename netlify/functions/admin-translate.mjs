// 영상 쉐도잉 — 문장 번역 (관리자 토큰 필요)
// 예전에는 관리자 브라우저가 구글 번역 무료 주소에 문장마다 따로 요청했는데, 문장이 수백 개면 차단(429)되어 번역 칸이 비었어요.
// 이제 서버에서 Groq AI(GROQ_API_KEY)로 30문장씩 묶어 번역합니다. 앞뒤 문맥을 함께 보니 대화체 번역도 자연스러워요.
//   POST /api/admin-translate  { sentences: ["Hi.", "How are you?"], title }  →  { ko: ["안녕.", "어떻게 지내?"] }
//   (번역하지 못한 문장은 "" — 브라우저가 구글 번역으로 한 번 더 시도합니다)
import { requireAuth, jsonResponse } from './_lib/auth.mjs';
import { groqChat, tokensKo } from './_lib/groq.mjs';

// 모델마다 Groq 사용 한도가 따로 — 하나가 한도에 걸리면 다음 모델이 받아요
const MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];
const MAX_ITEMS = 40;

function parseList(text, n) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  // 1) JSON 배열
  try {
    const m = t.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : t);
    if (Array.isArray(arr)) return arr.map(x => String(x == null ? '' : x).trim());
  } catch (e) {}
  // 2) "1. ..." 번호 목록
  const out = new Array(n).fill('');
  t.split('\n').forEach(line => {
    const m = line.match(/^\s*(\d+)[.)]\s*(.+)$/);
    if (m && +m[1] >= 1 && +m[1] <= n) out[+m[1] - 1] = m[2].trim();
  });
  return out;
}

// 정해 둔 번역(운영자 지시): 영어 낱말 → 꼭 이 한국어로. 다른 말로 번역하면 바꿔 넣어요. 낱말을 더하려면 여기에 한 줄.
const GLOSSARY = [
  // florist → 꽃가게 운영하는 사람 (운영자 지시 2026-11-03) — 사람을 가리키는 다른 번역만 바꿔요(꽃집·꽃가게 같은 가게 이름은 그대로)
  { word: 'florist', en: /\bflorists?\b/i, ko: '꽃가게 운영하는 사람',
    wrong: /플로리스트|(?:꽃집|꽃가게|화원)\s*(?:주인|사장님|사장|운영자|직원|아저씨|아주머니|아줌마)|꽃\s*장수|꽃\s*판매원/g },
];
const glossaryNote = 'Always translate these words exactly like this: ' + GLOSSARY.map(g => `"${g.word}" -> "${g.ko}"`).join(', ') + '.';
// 받침으로 끝나는 말로 바꿨을 때 뒤 조사도 맞춰요(예요→이에요, 가→이, 를→을, 는→은, 와→과, 로→으로, 랑→이랑, 야→이야, 였→이었)
const PARTICLE = [[/^예요/, '이에요'], [/^였/, '이었'], [/^야(?![가-힣])/, '이야'], [/^가(?![가-힣])/, '이'], [/^를/, '을'], [/^는/, '은'], [/^와/, '과'], [/^로/, '으로'], [/^랑/, '이랑'], [/^라고/, '이라고'], [/^라서/, '이라서'], [/^면/, '이면']];
function applyGlossary(en, ko) {
  for (const g of GLOSSARY) {
    if (!g.en.test(en) || ko.includes(g.ko)) continue;
    ko = ko.replace(new RegExp('(?:' + g.wrong.source + ')([가-힣]*)', 'g'), (m, ...rest) => {
      let tail = rest[rest.length - 3] || '';
      for (const [re, to] of PARTICLE) if (re.test(tail)) { tail = tail.replace(re, to); break; }
      return g.ko + tail;
    });
  }
  return ko;
}

export default async (req) => {
  if (!requireAuth(req, 'admin')) return jsonResponse({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'GROQ_API_KEY not configured' }, 500);

  let body; try { body = await req.json(); } catch (e) { return jsonResponse({ error: 'invalid_json' }, 400); }
  const list = (Array.isArray(body && body.sentences) ? body.sentences : []).slice(0, MAX_ITEMS).map(x => String(x || '').slice(0, 500));
  if (!list.length) return jsonResponse({ error: 'empty' }, 400);
  const title = String((body && body.title) || '').slice(0, 150);

  const prompt = [
    'Translate each English line into natural, conversational Korean for Korean learners of English.',
    title ? `The lines are consecutive subtitles from the video "${title}". Use the surrounding lines as context (who is speaking, tone).` : 'The lines are consecutive subtitles from one video; use the surrounding lines as context.',
    '- Keep names as they sound in Korean (e.g. Bluey → 블루이, Bingo → 빙고).',
    '- Match the tone: casual speech → 반말/구어체, polite speech → 존댓말.',
    '- Translate every line separately. Do not merge or skip lines.',
    '- ' + glossaryNote,
    `- Reply ONLY with a JSON array of exactly ${list.length} Korean strings, in the same order.`,
    '',
    JSON.stringify(list),
  ].join('\n');

  const r = await groqChat({
    apiKey, models: MODELS, prompt, temperature: 0.2,
    outTokens: tokensKo(list.join(' ')) / 2.2 + list.length * 6, // 한국어 번역 + JSON 따옴표
    accept: content => {
      const arr = parseList(content, list.length);
      if (arr.length !== list.length) return null; // 개수가 안 맞으면 다른 모델로
      const ko = arr.map((x, i) => (/[가-힣]/.test(x) ? applyGlossary(list[i], x) : '')); // 한글이 없는 답은 버림 · 정해 둔 번역으로
      return ko.filter(Boolean).length >= list.length * 0.5 ? ko : null;
    },
  });
  if (r.ok) return jsonResponse({ ko: r.value, model: r.model });
  if (r.rateLimited) return jsonResponse({ error: 'rate_limited', retryAfter: r.retryAfter }, 429);
  return jsonResponse({ error: 'failed' }, 502);
};

export const config = { path: '/api/admin-translate' };
