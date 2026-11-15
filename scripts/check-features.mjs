// 고정 기능 검사 (버클리원어민영어회화) — 운영자가 지시해서 만든 기능·형식이 그대로 있는지, 교재·영상을 추가해도 형식이 맞는지 확인해요.
//   node scripts/check-features.mjs   → 모두 ✅이면 0, 하나라도 ❌이면 1로 끝나요 (배포 스크립트가 먼저 돌려요)
// 운영자 지시로 고정 기능을 바꿨으면 CLAUDE.md와 이 파일의 해당 항목도 함께 고쳐요.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? '✅' : '❌'} ${what}`); if (!cond) fails++; };
const has = (file, needle, what) => ok(read(file).includes(needle), `${file}: ${what}`);

const member = read('member.html'), video = read('video.html'), admin = read('admin.html'), engine = read('js/shadowing-engine.js');

console.log('— 첫 화면 —');
has('index.html', 'class="header-admin" aria-label="관리자 로그인"', '머리글 관리자 로그인 상자');
has('index.html', 'class="header-admin" aria-label="수강생 로그인"><span class="header-admin-full">수강생 로그인</span><span class="header-admin-short">수강생</span>', '관리자 옆 수강생 로그인 상자 (모든 기기)');

console.log('— 학생 화면 —');
has('member.html', '님, 환영해요!', '환영 문구 아이디(이름)');
has('member.html', '.sub.welcome, .sub.welcome b{color:#1565C0', '환영 문구 파란색');
has('member.html', 'id="goalBanner"', '듣기 1000번 · 따라 말하기 1000번 배너');
has('member.html', '.goal-cheer{font-weight:900; font-size:1.45rem;', '배너 빨간 응원 글자 크게');
has('member.html', "goal.listen++; goal.speak++;", '따라 말하기도 듣기 횟수에 더하기');
for (const k of ['feedback', 'book', 'video', 'lesson']) has('member.html', `data-hub="${k}"`, `쉐도잉 글상자 (${k})`);
has('member.html', 'function setHubShown(key, shown)', '넣어 준 카테고리만 학생 화면에 보이기');
has('member.html', '<b class="hub-name">수업영상쉐도잉</b>', '학생 화면: 🎥 수업영상쉐도잉 글상자');
has('netlify/functions/member-lesson-videos.mjs', "path: '/api/member-lesson-videos'", '서버: 회원에게 넣어 준 수업 녹화 영상');
has('member.html', 'border-radius:16px; border:3px solid;', '쉐도잉 글상자 진한 테두리 3px');
has('member.html', '.hub-tile[data-hub="feedback"]{background:#BBDEFB; border-color:#1565C0;}', '피드백 글상자 색');
has('member.html', '.hub-tile[data-hub="book"]{background:#F8BBD0; border-color:#C2185B;}', '교재 글상자 색');
has('member.html', '.hub-tile[data-hub="video"]{background:#FFE082; border-color:#E65100;}', '영상 글상자 색');
for (const id of ['hubTimeFeedback', 'hubTimeBook', 'hubTimeVideo']) has('member.html', `id="${id}"`, `글상자 오늘 시간 (${id})`);
has('member.html', 'id="studyToday"', '공부 시간 글상자');
ok(/st-box st-month[\s\S]*?st-box st-day/.test(member), 'member.html: 이번 달 누적(위) → 오늘(아래) 순서');
has('member.html', '.study-today .st-month{background:#CDB8F2;', '이번 달 누적 연보라');
has('member.html', '.study-today .st-day{background:#B9F0C9;', '오늘 시간 연두');
has('member.html', '.hub-sticky.compact{position:sticky;', '쉐도잉 중 글상자 · 오늘 시간 위에 고정');
has('member.html', "micCountLabel: '🗣️ 따라 말하기'", '피드백 문장마다 공부 표시 · 따라 말하기 횟수');
has('member.html', 'sentenceMicCounts: mic', '교재 문장마다 공부 표시 · 마이크 횟수');
has('member.html', '📈 공부한 양', '교재 표지 공부한 양 %');
has('member.html', "window.open(`member.html?view=book&book=", '교재 표지 → 새 창');
has('member.html', 'body.book-window #bookShelf{display:none;}', '교재 새 창은 그 교재만');
has('js/shadowing-engine.js', '✅ 공부했어요 · 연습', '문장 공부 표시 문구');
has('js/shadowing-engine.js', '⬜ 아직 공부하지 않았어요', '아직 공부 안 한 문장 표시');
ok(/const SILENCE_MS = 200;/.test(engine), 'js/shadowing-engine.js: 목소리 끝나고 0.2초 뒤 채점');
has('js/shadowing-engine.js', 'extra.relQuiet : 0.12;', '피드백·교재: 목소리가 끊기면(최고점의 1/8 아래) 바로 채점');
has('video.html', "silenceMs: 100, patient, onReady", '영상: 말소리가 끝나면 0.1초 후에 채점 (말하는 도중엔 끊지 않음)');
has('js/shadowing-engine.js', 'function quietNeedMs(', '피드백·교재·영상: 말하는 도중엔 채점으로 넘어가지 않기');
has('js/shadowing-engine.js', 'patient: patientFor(targetText) });', '피드백·교재(서버 받아쓰기): 끝까지 기다리기');
has('js/shadowing-engine.js', 'stopOnSilence = __stopRecognitionOnSilence(recognition, SILENCE_MS, patient);', '피드백·교재(PC): 끝까지 기다리기');
has('js/shadowing-engine.js', 'heardToEnd(opts.target, heard)', '영상: 끝 단어까지 들리면 0.1초 후 채점');
has('video.html', '<div class="big under-video">', '영상: 연습 시작 줄은 영상 바로 아래');
ok(video.indexOf('<div class="big under-video">') > video.indexOf('<video id="v"') && video.indexOf('<div class="big under-video">') < video.indexOf('<div class="now">'), 'video.html: 영상 → 연습 시작 → 지금 문장 순서');
has('js/video-admin.js', 'r.far <= sents.length * 0.1', '영상 만들기: 영상과 시간대가 다른 자막은 쓰지 않기');
has('netlify/functions/_lib/videos.mjs', 'return sortLessons(all);', '영상 목록: 레벨 안에서 짧은 영상부터');
has('member.html', '.sort((a, b) => !!a.practice - !!b.practice);', '공부한 피드백 회차는 맨 뒤로');
has('member.html', 'booksList.slice().sort((a, b) => (bookStudyPercent(a) >= 100)', '다 공부한 교재는 맨 뒤로');
has('member.html', 'book.units.slice().sort((a, b) => practiced(a) - practiced(b))', '공부한 교재 유닛은 맨 뒤로');
has('member.html', '.sort((a, b) => finished(a) - finished(b));', '다 공부한 영상은 맨 뒤로 (학생 첫 화면)');
has('video.html', '.sort((a, b) => finished(a) - finished(b));', '다 공부한 영상은 맨 뒤로 (영상 목록)');
has('netlify/functions/_lib/videos.mjs', 'const id = crypto.randomUUID();', '새 영상은 새 번호로만 저장 (기존 영상을 덮어쓰지 않음)');
// 지문 잠금: 새 영상을 만들거나 영상 만들기를 고쳐도 기존 영상의 재생·채점이 달라지지 않게 (운영자 지시 2026-11-03).
// 운영자가 재생·채점을 바꾸라고 직접 말했을 때만 코드를 고치고, 아래 지문을 새로 적어요.
const print = (file, from, to) => { const t = read(file).replace(/\r\n/g, '\n'); return crypto.createHash('sha256').update(t.slice(t.indexOf(from), t.indexOf(to, t.indexOf(from)))).digest('hex').slice(0, 16); };
ok(print('js/yt-media.js', 'const meet = (a, b)', 'const position = m') + print('js/yt-media.js', 'root.SentenceClip = {', '})(window);') === '3309865fa68ead9048c82eb5d84470a0', '잠금: 영상 재생 규칙 SentenceClip');
ok(print('js/shadowing-engine.js', 'function quietNeedMs(', '// extra(선택)') === 'f998ab6db4e758db', '잠금: 채점 규칙 quietNeedMs');
ok(print('video.html', 'async function listenAndGrade(', 'showScore(s, res);') === '01d4ca188bb75366', '잠금: 영상 채점 호출 listenAndGrade');
// 🎥 수업영상쉐도잉: 영상 문장이 끝나고 0.2초 뒤 「● 지금 말하세요!」와 삐, 마이크도 그때 바로(운영자 지시 2026-11-03, 모든 기기)
has('video.html', "const res = await listenAndGrade(s, null, () => beeped);", '수업영상쉐도잉: 영상 끝나고 0.2초 뒤 지금 말하세요(삐와 함께 마이크)');
ok(/if \(S\.grade && isLessonRec\) \{[\s\S]{0,300}?setPill\('● 지금 말하세요! 🗣', 'rec'\);\s+const beeped = beep\(\);/.test(video), 'video.html: 수업영상쉐도잉은 쉬는 시간 뒤 바로 「● 지금 말하세요!」와 삐');
has('video.html', '<select class="sel" id="gap"', '영상: 쉬는 시간 고르기 (0.5초 · 1초 · 2초 …)');
has('video.html', '<button data-v="echo">에코잉</button>', '영상: 듣기 · 쉐도잉 · 에코잉 세 가지');
has('video.html', "isLessonRec = ((await api('/api/member-lesson-videos', MEMBER_TOKEN)).ids || []).includes(D.id);", '수업영상쉐도잉: 학생 화면에서 수업 녹화 영상 알아보기');
has('js/nvoim-video.js', '&admin=1&lesson=1', '수업영상쉐도잉: 관리자 연습 화면도 0.2초 규칙');
has('js/nvoim-video.js', 'return fitTimes(dropRepeats(joinFragments(kept.filter(x => !romanKorean(x.en)))))', '수업영상 쉐도잉: 같은 문장은 한 번만');
has('netlify/functions/admin-lesson-turns.mjs', "effort: 'high'", '수업영상 쉐도잉: 문장 나누기는 더 똑똑한 AI(깊게 생각하기)');
has('js/nvoim-video.js', 'function fitTimes(list)', '수업영상 쉐도잉: 영상과 문장 시간 맞추기(몰린 단어 시간 바로잡기)');
has('js/nvoim-video.js', '!sameAsKnown(s)', '수업영상 쉐도잉: 빠진 대사 채울 때 같은 말 두 번 넣지 않기');
has('js/nvoim-video.js', 'hangulShare([s]) < 0.7', '수업영상 쉐도잉: 한국어로 한 말은 영어로 번역해 넣지 않기');
has('js/video-admin.js', 'const matched = await matchToSpeech(sentences, videoId, clipStart, clipEnd);', '영상 만들기: 문장을 영상 말소리에 맞추기 (만들 때마다)');
has('js/video-admin.js', 'return matchToSpeech(sents, editing.youtubeId', '영상 편집: 문장을 새로 만들 때도 말소리에 맞추기');
has('js/video-transcript.js', 'function alignToSpeech(', '영상: 스크립트 문장을 단어 시간에 맞추는 규칙');
has('netlify/functions/admin-youtube.mjs', 'async function speechTiming(', '영상: 말소리 단어 시간 가져오기');
has('js/shadowing-engine.js', 'recognition.continuous = !!opts.patient;', '영상(PC Chrome): 짧게 쉬어도 이어 듣기');
has('video.html', '.left > .card:first-child{position:sticky; top:0;', '영상: 휴대폰·태블릿에서도 영상 카드 위에 고정');
has('video.html', "S = Object.assign({ mode: 'shadow', reps: 5,", '영상: 반복 횟수 기본 5회');
has('js/yt-media.js', 'root.SentenceClip = {', '영상: 한 문장을 끝까지, 앞 문장 소리 없이 (공통 규칙)');
has('video.html', 'await SentenceClip.seek(v, clip.start);', '영상: 문장 시작으로 옮겨진 뒤에 재생');
has('video.html', 'SentenceClip.cue(v, clipOf(s).start);', '영상: 같이 말하기 전에 문장 시작으로 미리 옮겨 둠');
has('js/video-transcript.js', 'all = spreadWithPauses(all);', '붙여넣기: 말이 쉬는 곳까지 계산해 문장 경계 잡기 (새로 만드는 영상)');
has('js/video-admin.js', 'SentenceClip.of(S, k)', '관리자 편집기: 학생 화면과 같은 문장 재생');
has('video.html', '🗣️ 따라 말한 횟수 ${n}번', '영상: 스크립트 문장마다 따라 말한 횟수');
has('netlify/functions/member-videos.mjs', "sentenceCounts(member.username, 'video-' + id)", '서버: 영상 문장별 따라 말한 횟수');
has('js/video-transcript.js', 'nextS - c.s <= 1.5 + n * 0.9', '붙여넣기: 단어 시간을 다음 줄 시작까지 고르게 (문장 시간 더 정확히)');
has('js/shadowing-engine.js', 'beepOnReady', '"지금 말씀하세요!"에 삐');
has('js/shadowing-engine.js', "['know', 'no']", '채점: 소리가 같은 단어는 같게 (know = no, to = too = two …)');
has('js/shadowing-engine.js', 'function __keepHelps(target, heard)', '채점: 줄임말과 소리가 같은 단어도 같게 (your = you\'re, its = it\'s, I\'ll = aisle …) — 운영자 지시 2026-11-13');
has('shadowing.html', 'function __keepHelps(target, heard)', '쉐도잉 연습장 채점도 같은 규칙 (your = you\'re …)');
has('js/shadowing-engine.js', 'text = speechText(text);', '원어민 음성: 영어 문장만 읽기(피드백의 한글 메모·화살표·기호는 빼고)');
has('video.html', 'id="todayBar"', '영상 쉐도잉 맨 위 오늘 시간 띠');
has('video.html', '.s .k{color:#1565C0; font-weight:700;', '영상 스크립트 한글 뜻 파란색 굵게');
has('video.html', '.now .ko{color:#1565C0; font-weight:700;', '영상 지금 문장 한글 뜻 파란색 굵게');
has('video.html', 'member.html?view=video', '← 목록은 학생 화면 영상 쉐도잉으로');
for (const f of ['member.html', 'video.html']) has(f, "const LV_ORDER = ['kids', '1-2', '3-4', '5-6', '7-9'];", '영상 전체: 유아 → 1-2 → 3-4 → 5-6 → 7-9 레벨 순서');

console.log('— 관리자 화면 —');
const order = [...admin.matchAll(/class="am-tile" data-go="(\w+)"/g)].map(m => m[1]).join(',');
ok(order === 'report,access,members,sets,book,lvrec,vrec,nvoim,nvvideo,video,lvmake,lvhl', `admin.html: 메뉴 순서 (지금: ${order})`);
// 메뉴 묶음(영클 연세점과 같게, 2026-11-13): 위 줄 📋 기록 ▾ · 📥 가져오기 ▾ · 🛠️ 만들기 ▾ · 📊 학습 리포트 · 🎁 넣어주기 · 👤 회원 관리 — 묶음을 누르면 아래 칸이 열려요
{
  const grps = [...admin.matchAll(/class="am-group" data-grp="(\w+)"/g)].map(m => m[1]).join(',');
  ok(grps === 'rec,get,make', `admin.html: 메뉴 묶음 기록 · 가져오기 · 만들기 (지금: ${grps})`);
  const sub = g => { const a = admin.indexOf(`<div class="am-sub" data-grp="${g}">`), b = admin.indexOf('</div>', a); return a < 0 ? '' : [...admin.slice(a, b).matchAll(/data-go="(\w+)"/g)].map(m => m[1]).join(','); };
  ok(sub('rec') === 'sets,book,lvrec,vrec', `admin.html: 📋 기록 안 (지금: ${sub('rec')})`);
  ok(sub('get') === 'nvoim,nvvideo', `admin.html: 📥 가져오기 안 (지금: ${sub('get')})`);
  ok(sub('make') === 'video,lvmake,lvhl', `admin.html: 🛠️ 만들기 안 (지금: ${sub('make')})`);
  has('admin.html', 'function openMenuGroup(g)', '메뉴 묶음: 누르면 열고 닫기, 지금 화면의 묶음은 열어 두기');
}
has('admin.html', 'font-size:clamp(1.15rem, 5vw, 1.5rem); font-weight:800; color:#4A148C;', '홈으로: 큰 글자 · 진한 보라색');
has('member.html', 'font-size:clamp(1.15rem, 5vw, 1.5rem); font-weight:800; color:#4A148C;', '홈으로: 큰 글자 · 진한 보라색');
has('admin.html', '<b>🎁 학생별 쉐도잉 넣어주기</b>', '메뉴 이름: 학생별 쉐도잉 넣어주기');
has('admin.html', '/mqdefault.jpg`', '학생별 쉐도잉 넣어주기: 영상은 대표 이미지로');
has('admin.html', 'border-radius:14px; border:3px solid;', '메뉴 글상자 진한 테두리 3px');
has('admin.html', '<b>💬 피드백쉐도잉 기록</b>', '메뉴 이름: 피드백쉐도잉 기록');
has('admin.html', '<b>📖 교재쉐도잉 기록</b>', '메뉴 이름: 교재쉐도잉 기록');
has('admin.html', '<b>🎥 수업영상 쉐도잉 기록</b>', '메뉴 이름: 피드백쉐도잉 기록 옆 수업영상 쉐도잉 기록');
has('admin.html', "openPracticeStats(username, sid, v.title)", '수업영상 쉐도잉 기록: 피드백쉐도잉 기록과 같은 📊 연습 기록');
has('admin.html', '<b>🎬 영상쉐도잉 기록</b>', '메뉴 이름: 영상쉐도잉 기록');
has('admin.html', 'function memberLabel(', '수강생 아이디(이름) 표시');
has('admin.html', 'function bookRecordTable(', '교재쉐도잉 기록: 교재별 표 · %');
has('admin.html', 'async function loadVideoRecords(', '영상쉐도잉 기록: 학생별 영상 공부 상황');
has('admin.html', 'const ACC_LEVELS = [', '학생별 넣어주기: 영상 레벨별 색');
has('admin.html', 'function applyAccLevel(', '학생별 넣어주기: 레벨 카테고리를 누르면 그 레벨 영상만');
has('admin.html', "if (!c.closest('.acc-off')) c.checked = !!all;", '학생별 넣어주기: 레벨을 고르면 전체 선택·해제는 보이는 영상만');
has('admin.html', 'const accBookColor = ', '학생별 넣어주기: 교재마다 다른 색');
has('admin.html', 'accBookColor(series.indexOf(accBookSeries(b.title)))', '학생별 넣어주기: 같은 이름의 교재는 같은 색');
has('admin.html', '#accessCard .acc-item{font-size:0.98rem; font-weight:700;', '학생별 넣어주기: 글자 크게 · 굵게');
has('admin.html', 'o.textContent = memberLabel(o.value) + accSummary(o.value);', '학생별 넣어주기: 학생 선택에 아이디(이름)');
has('admin.html', '<label for="vidParts">몇 문장 단위로 나눌까요?</label>', '영상 만들기: 몇 문장 단위로 나눌까요?');
ok(['1', '2', '3', '4', '5'].every(n => admin.includes(`<option value="${n}"${n === '1' ? ' selected' : ''}>${n}문장</option>`)), 'admin.html: 영상 파트 1문장~5문장');
has('video.html', 'for (let k = N; k < sents.length; k += N) cuts.push(sents[k].s);', '영상 파트를 대사 문장 N개씩 나누기');
has('netlify/functions/_lib/videos.mjs', 'rec.partSentences = Math.max(0, Math.min(200', '서버: 몇 문장 단위 저장');
has('netlify/functions/admin-youtube.mjs', 'async function playerResponse(videoId, client)', '영상 만들기: YouTube 앱 방식 자막');
has('admin.html', '<input type="checkbox" id="vidFix" checked>', '영상 만들기: 틀린 문장 AI로 고치기 (기본 켜짐)');
has('admin.html', 'id="vedFix"', '영상 편집: ✨ AI로 틀린 문장 고치기 버튼');
has('js/video-admin.js', 'async function fixSentences(', '영상: 틀린 문장 고치기 단계');
has('js/video-admin.js', '$(\'ytPaste\').addEventListener(\'paste\'', '영상 만들기: 스크립트 붙여넣으면 바로 시작');
has('admin.html', 'id="ytOpenLink"', '영상 만들기: YouTube에서 이 영상 열기 버튼');
has('admin.html', '<div id="ytPasteBox" class="paste-box">', '영상 만들기: 「📋 스크립트 넣기」 글상자 늘 보임');
has('js/video-admin.js', '      if (pasted) {', '영상 만들기: 넣은 스크립트가 있으면 그 스크립트로 바로 만들기');
has('js/video-transcript.js', 'const SPOKEN_TIME = ', '붙여넣기: 한국어 화면의 0초 · 1분 5초 줄 빼기');
has('js/video-transcript.js', 'const LEAD_TIME = ', '붙여넣기: 0:1717초it was… 처럼 붙어서 복사된 스크립트도 읽기');
has('admin.html', 'id="ytStart" placeholder="제목 이후 내용"', '영상 만들기: 시작 칸 「제목 이후 내용」');
has('js/video-admin.js', '{ dropIntro: !$(\'ytStart\').value.trim() }', '영상 만들기: 시작을 비우면 맨 앞 제목 줄 빼기');
has('js/video-admin.js', 'const PARALLEL = 3;', '영상: 번역 · 고치기 3개씩 동시에');
has('js/video-transcript.js', 'await Promise.all([worker(), worker(), worker()]);', '영상: 문장부호 3개씩 동시에');
ok(fs.existsSync(path.join(ROOT, 'netlify/functions/admin-fix-sentences.mjs')), '서버 기능 있음: admin-fix-sentences.mjs');
has('netlify/functions/_lib/nvoim.mjs', 'function decryptAny(', '엔보임: 사이트 비밀 설정이 바뀌어도 예전 열쇠로 비밀번호 열기');
has('admin.html', 'nv-repw', '엔보임: 계정마다 「🔑 비밀번호 다시 넣기」');
{ const i = k => admin.indexOf(k); ok(i('id="nvoimRunBtn"') < i('📅 지난 날짜 한 번에 가져오기') && i('📅 지난 날짜 한 번에 가져오기') < i('🔑 엔보임 계정') && i('🔑 엔보임 계정') < i('⚠️ 회원 선택 필요') && i('⚠️ 회원 선택 필요') < i('id="nvoimSelectAll"'), '엔보임: 지금 바로 가져오기 · 지난 날짜 위, 회원 선택 필요 · 전체 선택 맨 아래'); }
has('netlify/functions/nvoim-sync.mjs', "schedule: '*/30 * * * *'", '엔보임: 30분마다 자동 가져오기');
has('admin.html', '<b>🎥 수업영상</b><span>자동 가져오기</span>', '메뉴: 엔보임 피드백 바로 옆 수업영상(큰 글씨) · 자동 가져오기(작은 글씨, 아래)');
has('netlify/functions/_lib/nvoim-video.mjs', 'await loginWithAccount(s, account);', '엔보임 수업영상: 피드백과 같은 등록 계정·로그인');
has('netlify/functions/_lib/nvoim-video.mjs', 'await putChunk(id, n, buf);', '엔보임 수업영상: 직접 올린 영상과 같은 3.5MB 조각으로 저장');
has('js/nvoim-video.js', "action: 'update', id, sentences: sents,", '엔보임 수업영상: 한 문장씩 스크립트를 붙여 영상 쉐도잉으로 저장');
has('admin.html', '<button class="btn-primary" id="nvvRunBtn">🔄 지금 바로 가져오기</button>', '엔보임 수업영상: 🔄 지금 바로 가져오기 · 마지막 실행');
has('admin.html', '<button type="button" class="am-tile" data-go="lvmake"><b>🎥 수업영상 쉐도잉</b>', '🛠️ 만들기: 영상 쉐도잉 옆 수업영상 쉐도잉');
has('js/nvoim-video.js', 'makeFromFile(', '수업영상 쉐도잉 만들기: 학생 녹화 파일 → 한 문장씩 받아쓰기');
has('netlify/functions/nvoim-video-sync.mjs', "schedule: '*/30 * * * *'", '엔보임 수업영상: 30분마다 자동으로 새 녹화 찾기');
has('js/nvoim-video.js', '자동 실행 기록 보기 (최근 10번)', '엔보임 수업영상: 자동 실행 기록');
has('js/nvoim-video.js', 'data-nvvsave=', '엔보임 수업영상 자동 가져오기: 찾은 녹화는 「💾 저장」');
has('js/nvoim-video.js', '?saved=${encodeURIComponent(u)}', '수업영상 쉐도잉 만들기: 학생을 고르면 저장한 녹화가 보여요');
has('js/nvoim-video.js', 'function toSentences(toks, text)', '수업영상 쉐도잉: . ? ! 뒤 문장은 다음 문장으로(한 줄 = 한 사람의 한 문장)');
has('netlify/functions/admin-translate.mjs', "ko: '꽃가게 운영하는 사람'", '번역: florist → 꽃가게 운영하는 사람');
// 수업영상으로 쉐도잉을 만드는 길은 모두 같은 규칙(운영자 지시 2026-11-03): 녹화 가져오기(makeOne)·📁 녹화 파일(makeFromFile) 둘 다
// transcribe(선생님 얼굴부터 · 빠짐없는 받아쓰기 · 한 사람씩 한 문장씩 · 한국어 빼기 · 조각 합치기)를 거치고, 예전 받아쓰기(/api/admin-transcribe)는 쓰지 않아요.
{
  const nv = read('js/nvoim-video.js');
  ok((nv.match(/await transcribe\(file, duration, \(f, l\) => setBar\(P \+ 'Tr', f \* 0\.8, l\), title\)/g) || []).length === 2, 'js/nvoim-video.js: 수업영상 만들기 두 길(녹화 가져오기 · 녹화 파일) 모두 같은 규칙(transcribe)으로');
  ok(!/VAPI\.transcribe\b/.test(nv), 'js/nvoim-video.js: 수업영상은 예전 받아쓰기(/api/admin-transcribe)를 쓰지 않아요');
}
has('js/nvoim-video.js', 'const gaps = missedSpeech(pcm, from, results);', '수업영상 쉐도잉: 목소리가 있는데 빠진 대사는 다시 받아써서 채우기');
has('js/nvoim-video.js', 'const LESSON_PIECE = 25;', '수업영상 쉐도잉: 약 30초씩 짧게 받아쓰기(대사를 건너뛰지 않게)');
has('js/nvoim-video.js', 'return fitTimes(dropRepeats(joinFragments(kept.filter(x => !romanKorean(x.en)))))', '수업영상 쉐도잉: 「Are.」+「You ready?」처럼 끊긴 조각은 한 문장으로');
has('js/nvoim-video.js', '!HANGUL.test(x.en)', '수업영상 쉐도잉: 한국어로 한 말은 쉐도잉으로 만들지 않기');
has('js/nvoim-video.js', 'function keepsAllWords(orig, text)', '수업영상 쉐도잉: AI가 단어를 빼먹으면 받아쓴 글 그대로');
has('js/nvoim-video.js', 'await askJSON(VAPI.turns,', '수업영상 쉐도잉: 선생님·학생이 번갈아 말하는 줄은 한 사람씩 따로 나누기');
has('netlify/functions/admin-lesson-transcribe.mjs', "'whisper-large-v3'", '수업영상 쉐도잉: 더 정확한 받아쓰기 모델');
has('js/nvoim-video.js', 'const from = await teacherStart(file, onProg);', '수업영상 쉐도잉: 선생님 얼굴이 나오는 곳부터 만들기');
has('admin.html', 'id="nvvPlayerFrame"', '수업영상 자동 가져오기에서 만든 영상도 위에서 재생되며 쉐도잉 연습');
has('admin.html', 'id="lvmPlayerFrame"', '수업영상 쉐도잉 만들기: 만든 수업영상이 위에서 재생되며 쉐도잉 연습');
has('netlify/functions/_lib/groq.mjs', 'export const CHAT_MODELS = [', 'AI 모델: 없어진 모델이면 다음 모델로 (문장부호·번역·고치기)');
has('js/video-admin.js', 'const perSent = pv.startsWith("m:")'.replace(/"/g, "'"), '영상 편집: 파트 수를 학생 화면과 같게');
for (const f of ['admin-video-records.mjs', 'member-study-time.mjs', 'member-textbooks.mjs', 'member-sets.mjs', 'admin-practice.mjs'])
  ok(fs.existsSync(path.join(ROOT, 'netlify/functions', f)), `서버 기능 있음: ${f}`);

console.log('— ✂️ 수업영상 하이라이트 (영클 연세점에서 옮겨 옴 2026-11-13) —');
has('admin.html', '<b>✂️ 수업영상 하이라이트</b><span>참여도 높은 3~6분 편집 · 내려받기</span>', '관리자 메뉴: 수업영상 쉐도잉 만들기 옆 ✂️ 수업영상 하이라이트');
has('admin.html', 'id="hlCard" data-aview="lvhl"', '관리자: 하이라이트 만들기 카드');
has('admin.html', '<script src="js/lesson-highlight.js', '관리자: 하이라이트 화면 코드');
has('admin.html', '<script src="js/lesson-voice.js', '관리자: 목소리로 선생님·학생 나누기');
has('admin.html', "action: 'give', u: username, ids: ids('hl')", '🎁 넣어주기: 체크한 하이라이트만 학생 화면에');
has('admin.html', 'id="accHlLegend"', '🎁 넣어주기: 하이라이트를 만든 학생별 카테고리');
has('js/lesson-highlight.js', 'const MIN_SEC = 180, MAX_SEC = 360', '하이라이트: 합쳐서 3~6분');
has('js/lesson-highlight.js', "apiFetch('/api/admin-lesson-highlight'", '하이라이트: AI가 구간 고르기');
has('js/lesson-highlight.js', 'segs = scorePick(sc, sents, from, to, dur)', '하이라이트: AI가 못 고르면 점수로 고르기');
has('js/lesson-highlight.js', "subtitles=s${k}.ass:fontsdir=/fonts", '하이라이트: 영어·한글 자막을 영상에 새기기');
has('js/lesson-highlight.js', "const HAPI = '/api/admin-highlights', HL_CHUNK = 3.5 * 1024 * 1024;", '하이라이트: 학생 이름으로 3.5MB 조각 저장');
has('netlify/functions/_lib/highlights.mjs', 'export const HL_CHUNK = 3.5 * 1024 * 1024;', '서버: 하이라이트 조각 크기(화면과 같게)');
has('netlify/functions/_lib/highlights.mjs', "h.status === 'ready' && (h.to || []).includes(u)", '서버: 넣어 준 학생에게만 하이라이트');
has('netlify/functions/highlight-stream.mjs', "tok.role !== 'hl'", '서버: 하이라이트 재생은 토큰이 있어야');
for (const f of ['admin-lesson-highlight.mjs', 'admin-highlights.mjs', 'member-highlights.mjs', 'highlight-stream.mjs'])
  ok(fs.existsSync(path.join(ROOT, 'netlify/functions', f)), `서버 기능 있음: ${f}`);
has('member.html', 'data-hub="highlight"', '학생 화면: ✂️ 수업영상 하이라이트 글상자');
has('member.html', "setHubShown('highlight', highlightsCache.length > 0);", '학생 화면: 넣어 준 하이라이트가 있을 때만 글상자');
has('member.html', 'data-hldl=', '학생 화면: 하이라이트 보기 · 내려받기');

console.log('— 버전 —');
const ver = JSON.parse(read('version.json')).version;
ok((engine.match(/const ENGINE_VERSION = '([^']+)'/) || [])[1] === ver, `ENGINE_VERSION = version.json (${ver})`);
const v = ver.replace(/-/g, '');
for (const f of ['member.html', 'video.html', 'admin.html']) has(f, `shadowing-engine.js?v=${v}`, `엔진 ?v=${v}`);

console.log('— 교재 (기본 교재 37권 + 관리자가 만든 교재) —');
const { default: BUILTIN } = await import(pathToFileURL(path.join(ROOT, 'netlify/functions/_lib/builtin-books.mjs')).href);
has('netlify/functions/_lib/books.mjs', 'async function seedBuiltinBooks(', '기본 교재를 처음 한 번 교재 저장소에 넣기 (있는 교재는 그대로)');
has('netlify/functions/_lib/books.mjs', "visibility: 'assigned'", '기본 교재는 넣어 준 학생에게만 보이기');
has('netlify/functions/_lib/books.mjs', '.flatMap(x => splitEntry(x)', '교재 문장은 언제나 한 문장씩 (. ! ? 뒤 문장은 다음 문장으로)');
has('netlify/functions/textbook-cover.mjs', 'preferStatic: true', '기본 교재 표지 그림은 사이트 파일 그대로');
has('member.html', '(b.cover ? { img: b.cover } : {})', '직접 만든 교재는 올린 표지 그림');
const covers = member.slice(member.indexOf('const BOOK_COVERS = {'), member.indexOf('};', member.indexOf('const BOOK_COVERS = {')));
const ids = new Set();
for (const b of BUILTIN) {
  const problems = [];
  if (!/^[\w-]{2,64}$/.test(b.id || '')) problems.push('id 형식');
  if (ids.has(b.id)) problems.push('id 겹침'); ids.add(b.id);
  if (!b.title) problems.push('제목 없음');
  if (!Array.isArray(b.units) || !b.units.length || b.units.length > 300) problems.push('유닛 수');
  (b.units || []).forEach((u, k) => {
    if (!u.title) problems.push(`유닛 ${k + 1} 제목 없음`);
    if (!Array.isArray(u.sentences) || !u.sentences.length || u.sentences.length > 1000) problems.push(`유닛 ${k + 1} 문장 수`);
    (u.sentences || []).forEach((s, i) => { if (typeof s.o !== 'string' || !s.o.trim() || s.o.length > 500) problems.push(`유닛 ${k + 1} 문장 ${i + 1}`); });
  });
  const cover = new RegExp(`\\b${b.id}: \\{ img: '([^']+)'`).exec(covers);
  if (!cover) problems.push('member.html BOOK_COVERS에 표지 없음');
  else if (!fs.existsSync(path.join(ROOT, cover[1]))) problems.push(`표지 그림 없음 ${cover[1]}`);
  ok(!problems.length, `교재 ${b.id} · ${b.title} (${(b.units || []).length}유닛)${problems.length ? ' — ' + problems.slice(0, 5).join(', ') : ''}`);
}

// 전체 잠금: 피드백·교재·영상 쉐도잉의 기능 파일이 한 글자라도 바뀌면 배포를 멈춰요 (운영자 지시 2026-11-03).
// 교재·영상·피드백 자료를 더할 때 바뀌는 것(교재 표지·색 줄, 파일 ?v= 번호, 버전 번호)은 지문에서 빼요 — 그래서 자료를 더해도 그대로 통과해요.
// 운영자가 기능을 바꾸라고 직접 말했을 때만: 코드를 고치고 CLAUDE.md도 고친 뒤 `node scripts/check-features.mjs --relock`으로 지문을 새로 적어요.
console.log('— 기능 파일 잠금 —');
const LOCKED = {
  '수업영상 하이라이트': ['js/lesson-highlight.js', 'js/lesson-voice.js', 'netlify/functions/_lib/highlights.mjs', 'netlify/functions/admin-highlights.mjs', 'netlify/functions/member-highlights.mjs', 'netlify/functions/highlight-stream.mjs', 'netlify/functions/admin-lesson-highlight.mjs'],
  '공통': ['js/shadowing-engine.js', 'js/study-time.js', 'member.html', 'netlify/functions/stt.mjs', 'netlify/functions/tts.mjs', 'netlify/functions/member-study-time.mjs', 'netlify/functions/_lib/study-time.mjs', 'netlify/functions/_lib/practice.mjs', 'netlify/functions/_lib/access.mjs', 'netlify/functions/member-time.mjs'],
  '피드백쉐도잉': ['netlify/functions/member-sets.mjs', 'netlify/functions/member-practice.mjs', 'netlify/functions/admin-sets.mjs', 'netlify/functions/admin-practice.mjs', 'netlify/functions/_lib/store.mjs', 'netlify/functions/similar-expressions.mjs'],
  '교재쉐도잉': ['netlify/functions/member-textbooks.mjs', 'netlify/functions/member-books.mjs', 'netlify/functions/admin-textbooks.mjs', 'netlify/functions/admin-books.mjs', 'netlify/functions/textbook-cover.mjs', 'netlify/functions/_lib/books.mjs', 'netlify/functions/_lib/one-sentence.mjs', 'js/book-admin.js'],
  '영상쉐도잉': ['video.html', 'js/yt-media.js', 'js/video-admin.js', 'js/video-transcript.js', 'netlify/functions/member-videos.mjs', 'netlify/functions/member-video-progress.mjs', 'netlify/functions/admin-videos.mjs', 'netlify/functions/admin-youtube.mjs', 'netlify/functions/admin-video-records.mjs', 'netlify/functions/video-stream.mjs', 'netlify/functions/_lib/videos.mjs', 'js/video-records.js', 'netlify/functions/_lib/video-progress.mjs'],
};
const lockFile = path.join(ROOT, 'scripts/feature-locks.json');
const fingerprint = f => {
  let t = read(f).replace(/\r\n/g, '\n').replace(/\?v=[\w.-]+/g, '?v=').replace(/const ENGINE_VERSION = '[^']+'/, "const ENGINE_VERSION = ''");
  if (f === 'member.html') {
    const a = t.indexOf('const BOOK_COVERS = {'), b = t.indexOf('};', a);
    t = t.slice(0, a) + t.slice(b).split('\n').filter(l => !/\.book-(theme|tile)\[data-book=/.test(l)).join('\n');
    t = t.split('\n').filter(l => !/\.book-(theme|tile)\[data-book=/.test(l)).join('\n');
  }
  return crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
};
const allLocked = Object.values(LOCKED).flat();
if (process.argv.includes('--relock')) {
  fs.writeFileSync(lockFile, JSON.stringify(Object.fromEntries(allLocked.map(f => [f, fingerprint(f)])), null, 2) + '\n');
  console.log('🔒 기능 파일 지문을 새로 적었어요.');
}
const locks = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : {};
for (const [group, files] of Object.entries(LOCKED)) {
  const changed = files.filter(f => locks[f] !== fingerprint(f));
  ok(!changed.length, `잠금: ${group} 기능 파일 ${files.length}개 그대로${changed.length ? ' — 바뀐 파일: ' + changed.join(', ') : ''}`);
}

console.log(fails ? `\n❌ ${fails}개 문제 — 고친 뒤 배포하세요.` : '\n✅ 고정 기능과 교재 형식이 모두 그대로예요.');
process.exit(fails ? 1 : 0);
