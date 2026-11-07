// 교재 쉐도잉 문장은 언제나 한 문장씩 (운영자 지시 2026-10-31)
// 문장부호 . ! ? 뒤에 다음 문장이 이어지면 다음 문장으로 내려요. 교재를 더해도 textbooks.mjs에서 자동으로 이 규칙을 지나요.

// 마침표가 있어도 문장이 끝난 게 아닌 낱말 (Mr. Kim, e.g. …)
const NOT_END = /(?:^|[\s("'“‘―])(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|Mt|Ave|Blvd|Rd|vs|approx|dept|Dept|Corp|Inc|Ltd|Co|e\.g|i\.e|E\.g|I\.e|a\.k\.a|ex|Ex|cf|Nos|Vol|pp|p)\.$/;
// a.m. U.S. D.C. etc. St. 와 이름 첫 글자(B. Johnson) 뒤에는 새 문장 첫 낱말이 올 때만 나눠요
const MAYBE_END = /(?:\b[ap]\.m|\b[AP]\.M|\b[A-Z]\.[A-Z]|\betc|\bSt|(?:^|[\s("'“‘―.])[A-HJ-Z])\.$/;
const STARTER = /^(?:I|I'm|I'll|I've|I'd|We|You|He|She|They|It|It's|That|This|There|The|My|Our|Your|His|Her|Their|Please|What|When|Where|Why|How|Who|In|Don't|Can|Could|Would|Will|Do|Did|Is|Are|Was|Were|So|But|And|Then|Also|However|Thank|Thanks|Let's|See|Yes|No|Okay|OK)\b/;
const CLOSE = `["'”’)\\]]*`;
const BOUNDARY = new RegExp([
  `[.!?]+${CLOSE}\\s+(?=[("'“‘\\[]*[A-Z0-9])`, // 보통: 문장부호 + 띄어쓰기 + 대문자
  `[.!?]{1,3}${CLOSE}(?=[A-Z][a-z])`,          // 띄어쓰기를 빠뜨린 문장: therapy.It's
  `[?!]+\\s+(?=[a-z])`,                        // ? ! 뒤에 소문자로 이어진 문장: ...a pet? and when...
  `(?<=[a-z]{2}|\\d{4})\\.\\s+(?=[a-z])`,      // 마침표 뒤 소문자: Well. that's...
].join('|'), 'g');
const LABEL = /^(?:Adjectives and Adverbs \d|Common patterns II|\(Use percent\)|Cannot\/must not\/shall not . Prohibition|Must\(should\), Might\(may\), Could have \+ p\.p)$/; // 문장 끝에 붙어 온 단원 이름
const upperFirst = s => (/^de /.test(s) ? s : s.replace(/^(["'“‘(\[]*)([a-z])/, (m, q, c) => q + c.toUpperCase()));

export function splitSentences(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return [];
  const parts = []; let start = 0; let m;
  BOUNDARY.lastIndex = 0;
  while ((m = BOUNDARY.exec(s))) {
    const end = m.index + m[0].trimEnd().length;
    const head = s.slice(start, end).replace(/["'”’)\]]+$/, '');
    const rest = s.slice(m.index + m[0].length);
    if (/\.$/.test(head) && !/\.\.$/.test(head)) {
      if (MAYBE_END.test(head)) { if (!STARTER.test(rest)) continue; }
      else if (/\bNo\.$/.test(head)) { if (/^\d/.test(rest)) continue; } // No. 5 는 이어져요, "No. I don't" 는 나눠요
      else if (NOT_END.test(head)) continue;
      else if (/\b(?:etc|vs|ex|cf|approx)\.$/.test(head)) continue;
    }
    parts.push(s.slice(start, end).trim());
    start = m.index + m[0].length;
  }
  parts.push(s.slice(start).trim());
  if (parts.length < 2) return parts;
  return parts.filter(p => /\p{L}/u.test(p) && !/^\(?\d+[.)]$/.test(p) && !LABEL.test(p))
    .map(p => upperFirst(p.replace(/^e\.g\.\s+/i, '')));
}

// 틀린 문장이 있으면(x) 맞는 문장(o)과 짝을 맞춰 나눠요. 그 부분이 틀리지 않았으면 x는 비워요.
export function splitEntry(entry) {
  const parts = splitSentences(entry.o);
  if (parts.length < 2) return [parts.length && parts[0] !== entry.o ? Object.assign({}, entry, { o: parts[0] }) : entry];
  const wrong = entry.x ? splitSentences(entry.x) : [];
  return parts.map((o, i) => {
    const x = wrong.length === parts.length ? (wrong[i] === o ? '' : wrong[i]) : (i === 0 ? String(entry.x || '') : '');
    return Object.assign({}, entry, { x, o });
  });
}
