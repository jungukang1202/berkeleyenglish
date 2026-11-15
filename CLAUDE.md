# berkeleyenglish.co.kr — 작업 규칙

버클리원어민영어회화 사이트. 학생 화면 `member.html`·`video.html`, 관리자 화면 `admin.html`, 첫 화면·과정 소개 `index.html`·`courses/*.html`, 서버는 `netlify/functions/*.mjs`(Netlify Functions + Netlify Blobs). 사용자와는 한국어로 이야기해요.

이 규칙과 검사 스크립트는 영클 연세점 사이트(youngcle-yonsei)의 방식을 버클리에 맞게 옮긴 것이에요(2026-11-13). 두 사이트는 같은 뿌리지만 따로 발전해서, 코드를 서로 통째로 복사하면 안 돼요 — 저장 형식(공부 시간·교재 등)이 달라서 학생 기록이 깨질 수 있어요. 한쪽 기능을 가져올 때는 차이를 보고 필요한 부분만 옮겨요.

## 절대 규칙: 지금까지 만든 기능·형식은 바꾸지 않아요

- 운영자가 하나하나 지시해서 만든 기능은, 운영자가 그 기능을 바꾸라고 **직접** 말하지 않는 한 없애거나, 모양(글자 크기·색·위치·순서·문구)을 바꾸거나, 동작을 바꾸지 않아요.
- 고정 기능 목록은 `scripts/check-features.mjs`에 있어요(약 210개 항목). 피드백쉐도잉·교재쉐도잉·영상쉐도잉의 기능 파일은 `scripts/feature-locks.json` 지문으로 잠겨 있어서, 한 글자라도 바뀌면 검사가 ❌를 내고 배포를 멈춰요. 자료를 더할 때 생기는 교재 표지·색 줄과 `?v=`·버전 번호는 지문에서 빠져 있어요.
- 운영자가 기능을 바꾸라고 직접 말했을 때만 코드를 고치고, 같은 작업에서 이 파일과 `scripts/check-features.mjs`의 해당 항목도 고친 뒤 `node scripts/check-features.mjs --relock`으로 지문을 새로 적어요. 다른 일을 하다가 지문이 틀어지면 relock하지 말고 코드를 되돌려요.
- 교재·영상을 추가할 때는 **데이터만** 더해요. 화면 코드(`member.html`·`video.html`·`admin.html`·`js/*.js`)는 표지 등록(`BOOK_COVERS`) 한 줄 말고는 건드리지 않아요.
- 새 기능을 만들 때도 기존 기능이 그대로 동작하는지 확인해요.
- 배포 전에 반드시 `node scripts/check-features.mjs`를 돌려요. 하나라도 ❌이면 배포하지 않고 고쳐요. (배포 스크립트도 이 검사를 먼저 해요)
- 배포는 운영자가 "배포해줘"라고 할 때만 해요. 배포 명령: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1` (검사 → 통과해야 배포)

## 버클리에만 있는 것 (영클 연세점과 다른 점 — 그대로 지켜요)

- 영상 쉐도잉: 듣기 · 쉐도잉 · **에코잉** 세 가지 모드, 「쉬는 시간」 고르기(0.5초·1초·2초 …). 수업영상쉐도잉도 쉬는 시간 뒤에 「● 지금 말하세요!」와 삐.
- 영상 재생 감시(`segCheck`·`realTime`)와 Safari 재생 허락(`unlockMedia`) — 맥·아이폰에서 띵동만 반복되던 문제 해결.
- 교재: 관리자가 직접 교재를 만들고 고치는 「📚 교재 만들기 · 고치기」(`js/book-admin.js`, `/api/admin-books`, 저장소 `textbooks`) + 학생별 넣어주기. 직접 만든 교재는 올린 표지 그림.
- 공부 시간 저장 형식: `study-time` : `${username}/${YYYY-MM}` (월별). 영클 연세점과 형식이 달라요.
- AI 호출(`_lib/groq.mjs` `groqChat`): 한도에 걸리면 다음 모델로, 글 길이에 맞춰 토큰을 잡아요.
- 엔보임 접속: 주소를 잠깐 못 찾는 오류(DNS)는 최대 5번 다시 시도.

## 영클 연세점에서 옮겨 온 것 (2026-11-13)

- 📖 기본 교재 37권(`netlify/functions/_lib/builtin-books.mjs`, 문장 39,050개): 처음 한 번 `_lib/books.mjs`의 `seedBuiltinBooks()`가 교재 저장소에 넣어요. 이미 같은 ID 교재가 있으면 건드리지 않고, 넣고 나면 표시(`textbook-seed` 저장소 `builtin-v1`)를 남겨서 관리자가 지운 교재가 다시 생기지 않아요. 새로 넣는 교재는 '넣어 준 학생만' — 「🎁 학생별 쉐도잉 넣어주기」로 넣어 줘야 보여요.
- 기본 교재 표지 `images/textbooks/*.png` — `textbook-cover.mjs`는 `preferStatic: true`라서 사이트 파일이 있으면 그 파일을, 없으면 저장해 둔 그림을 보내요.
- 엔보임 비밀번호: 사이트 비밀 설정(NVOIM_SECRET·SESSION_SECRET·ADMIN_PASSWORD)이 바뀌어도 예전 열쇠로 풀고, 풀리면 지금 열쇠로 다시 저장(`decryptAny`).
- 서버 받아쓰기(`/api/stt`): 멀리서 작게 말한 목소리도 버리지 않게 — '말 없음 확률'이 0.85 넘거나, 0.6 넘고 받아쓴 내용에 자신이 없을 때만 버려요.
- 고정 기능 검사·배포 스크립트(`scripts/`)와 이 파일. `netlify.toml`이 `/CLAUDE.md`·`/scripts/*`를 사이트에서 숨겨요.
- 첫 화면 검색엔진용 학원 정보(`index.html`의 `application/ld+json`).
- ✂️ 수업영상 하이라이트(영클 연세점 `youngcle.kr/admin#lvhl`, 연세점 운영자 지시 2026-11-06·11-13): 관리자 「✂️ 수업영상 하이라이트」(`js/lesson-highlight.js`)에서 학생을 고르면 💾 저장한 녹화·만든 수업영상이 보이고, 「✂️ 하이라이트 만들기」가 녹화를 받아(ffmpeg 웹 버전) 5초마다 참여 점수(학생 말한 시간·주고받기·웃음/칭찬·목소리 크기)를 매기고, AI(`/api/admin-lesson-highlight`)가 2~4구간(합쳐서 3~6분)을 골라요(못 고르면 점수로 `scorePick`). 영어(흰색)·한글(노란색) 자막을 새겨 한 mp4로 이어 붙이고, 미리 보기·내려받기, 그리고 그 학생 이름으로 저장(`/api/admin-highlights`, 저장소 `lesson-highlights`, 3.5MB 조각). 저장한 녹화(문장이 없는 녹화)는 받아쓰기 + 목소리로 선생님·학생 나누기(`js/lesson-voice.js`). 학생 화면에는 「🎁 학생별 쉐도잉 넣어주기 → ✂️ 수업영상 하이라이트」에서 넣어 준 학생에게만 보여요 — 학생 화면 「✂️ 수업영상 하이라이트」 글상자(`member.html?view=highlight`, `/api/member-highlights`)에서 보기·⬇️ 내려받기(`/api/highlight-stream`, 토큰 필요). 서버 코드(`admin-lesson-highlight`·`admin-highlights`·`member-highlights`·`highlight-stream`·`_lib/highlights.mjs`)는 연세점 사이트에서 받을 수 없어서 같은 동작으로 새로 썼어요. 화면 코드를 고치면 `HL_BUILD`도 올려요(열려 있던 관리자 창이 예전 코드로 만들지 않게).

## 🛡️ 보안 · 로봇/AI 차단 (운영자 지시 2026-11-15)

- `robots.txt`: AI 학습·수집 로봇(GPTBot·ClaudeBot·Perplexity·Bytespider·Google-Extended 등 약 45종)은 사이트 전체 금지. 관리자·회원·영상·쉐도잉·신청 화면과 `/api/`는 모든 로봇 금지. 첫 화면·과정 소개는 네이버·구글 검색 로봇 허용(학원 홍보).
- 엣지 함수 `netlify/edge-functions/bot-guard.js`(모든 주소 앞에서 실행): AI 로봇·AI 에이전트 서명(Signature-Agent)은 어디서든 403. 보호 화면·`/api/`·`/js/`는 사람 브라우저가 아니면(검색 로봇·curl·python·Headless·Playwright·Selenium …, 언어 정보 없는 접속) 403. `robots.txt`는 누구나 읽어요.
- `admin.html`·`shadowing.html` 맨 위: `<meta name="robots" … noai, noimageai>`와 자동 조종 브라우저(`navigator.webdriver`) 막기. (`member.html`·`video.html`은 기능 잠금 파일이라 아직 넣지 않았어요 — 헤더 `X-Robots-Tag`와 엣지 함수가 대신 막아요)
- `netlify.toml` 보안 헤더: X-Frame-Options SAMEORIGIN · nosniff · HSTS · Referrer-Policy · Permissions-Policy(마이크는 이 사이트만) · X-Robots-Tag.
- 로그인 잠금(`_lib/login-guard.mjs`): 같은 IP 15분에 10번, 같은 아이디 15분에 6번 틀리면 15분 잠금(맞는 비밀번호도). 관리자 비밀번호 비교는 시간차가 없게(`timingSafeEqual`).
- 배포는 GitHub(main)에 올리면 Netlify가 자동으로 해요. `scripts/deploy.ps1`로 컴퓨터에서 바로 배포하면 GitHub에 없는 코드가 올라가서, 다음 GitHub 배포 때 사라질 수 있어요 — 컴퓨터에서 고쳤으면 GitHub에도 꼭 올려요.

## 채점: 소리가 같은 단어 (운영자 지시 2026-11-13)

받아쓰기가 다른 철자로 적어도 소리가 같으면 맞은 것으로 채점해요 — 엔진(`js/shadowing-engine.js`)과 쉐도잉 연습장(`shadowing.html`)이 같은 규칙.
- `__HOMO`: 소리가 같은 단어 묶음 (know = no, to = too = two, right = write, here = hear, see = sea = c, you = u, are = r …). 뜻이 달라 잘못 맞을 위험이 큰 것(lead/led, desert/dessert)은 넣지 않았어요.
- `__CHOMO`: 줄임말과 소리가 같은 단어 (your = you're, its = it's, were = we're, whose = who's, there = their = they're, aisle = I'll …). 원문과 받아쓴 말에 같은 소리의 다른 철자가 함께 있을 때만(`__keepHelps`) 한 단어로 묶어 비교한 점수를 써요 — 줄임말을 빼먹고 말했을 때 점수가 오르지 않게.
- 묶음을 더할 때는 두 파일에 똑같이 더해요.

## 관리자 메뉴 (영클 연세점과 같게, 2026-11-13)

위 줄: 📋 기록 ▾ · 📥 가져오기 ▾ · 🛠️ 만들기 ▾ · 📊 학습 리포트 · 🎁 학생별 쉐도잉 넣어주기 · 👤 회원 관리. 묶음 글상자(▾)를 누르면 그 아래에 칸이 열려요(`openMenuGroup`), 지금 보는 화면이 든 묶음은 열린 채로 표시돼요.
- 📋 기록: 💬 피드백쉐도잉 기록 · 📖 교재쉐도잉 기록 · 🎥 수업영상 쉐도잉 기록 · 🎬 영상쉐도잉 기록
- 📥 가져오기: 📥 엔보임 피드백 · 🎥 수업영상(자동 가져오기)
- 🛠️ 만들기: 🎬 영상 쉐도잉 · 🎥 수업영상 쉐도잉 · ✂️ 수업영상 하이라이트
새 메뉴를 더할 때는 알맞은 묶음(`am-sub`) 안에 넣고 `ADMIN_VIEWS`와 `scripts/check-features.mjs`의 메뉴 순서도 함께 고쳐요.

## 교재 추가하는 법

- 보통은 관리자 「📚 교재 만들기 · 고치기」에서 만들어요(코드는 바꾸지 않아요).
- 기본 교재처럼 파일로 넣을 때: `builtin-books.mjs`에 `{ id, title, units:[{ title, sentences:[{ o, x?, ko? }], words? }] }`를 더하고, 표지를 `images/textbooks/`에 넣고 `member.html`의 `BOOK_COVERS`에 한 줄. 이미 한 번 넣은 사이트에는 표시가 있어서 저절로 들어가지 않으니, `SEED_KEY`를 새 이름(`builtin-v2`)으로 바꿔야 새 교재만 더해져요(있는 교재는 그대로).
- 교재 문장은 언제나 한 문장씩: `_lib/books.mjs`가 `_lib/one-sentence.mjs` 규칙으로 . ! ? 뒤 문장을 다음 문장으로 나눠요.
- `node scripts/check-features.mjs`로 확인.

## 영상 추가하는 법

관리자 「🎬 영상 쉐도잉 만들기」에서 올려요(데이터는 Blobs `video-lessons`). 코드는 바꾸지 않아요. 레벨(유아·1-2·3-4·5-6·7-9)을 꼭 고르고, 「🎁 학생별 쉐도잉 넣어주기」에서 학생에게 넣어 줘요.

## 버전

`js/shadowing-engine.js`의 `ENGINE_VERSION`, `version.json`, html의 `shadowing-engine.js?v=`는 셋이 같아야 해요(기기가 최신 코드로 자동 새로고침). 엔진을 고치면 셋 다 올려요.
