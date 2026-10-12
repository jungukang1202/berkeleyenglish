/* =====================================================================
   수업 피드백 리포트 엑셀 만들기 (관리자 페이지 · 회원 페이지 공용)
   ---------------------------------------------------------------------
   FeedbackReport.download(report, { mode })
     - mode 'member' : 회원 한 명 리포트 (요약 · 문장 · 단어)
     - mode 'all'    : 전체 회원 리포트 (요약[회원별] · 문장 · 단어)
   report = { from, to, month?, username?, name?, lessons:[{date, username, name, title, sentences:[{x,o}], words:[]}] }
   ===================================================================== */
(function (global) {
  'use strict';

  let loading = null;
  function loadXlsx() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (!loading) loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(global.XLSX);
      s.onerror = () => { loading = null; reject(new Error('엑셀 도구를 불러오지 못했어요. 인터넷 연결을 확인해주세요.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function periodLabel(report) {
    if (report.month) {
      const [y, m] = report.month.split('-');
      return { file: report.month, text: `${y}년 ${Number(m)}월` };
    }
    return { file: `${report.from}_${report.to}`, text: `${report.from} ~ ${report.to}` };
  }

  function addSheet(XLSX, wb, name, header, rows, widths) {
    const ws = XLSX.utils.aoa_to_sheet([header].concat(rows.map(r => header.map(h => (r[h] == null ? '' : r[h])))));
    ws['!cols'] = widths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  function saveWorkbook(XLSX, wb, filename) {
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function counts(lessons) {
    let sentences = 0, words = 0;
    lessons.forEach(l => { sentences += l.sentences.length; words += l.words.length; });
    return { lessons: lessons.length, sentences, words };
  }

  // 회원 한 명 리포트
  function buildMember(XLSX, report) {
    const lessons = report.lessons || [];
    const period = periodLabel(report);
    const c = counts(lessons);
    const name = report.name || (lessons.find(l => l.name) || {}).name || '';
    const username = report.username || (lessons[0] && lessons[0].username) || '';
    const wb = XLSX.utils.book_new();

    // 요약: 위쪽은 한눈에 보는 숫자, 아래는 수업별 목록
    const top = [
      ['수업 피드백 리포트'],
      [],
      ['기간', period.text],
      ['이름', name],
      ['아이디', username],
      ['수업 횟수', c.lessons],
      ['교정 문장 수', c.sentences],
      ['발음 교정 단어 수', c.words],
      [],
      ['날짜', '회차 제목', '문장 수', '단어 수'],
    ].concat(lessons.map(l => [l.date, l.title, l.sentences.length, l.words.length]));
    const ws = XLSX.utils.aoa_to_sheet(top);
    ws['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, '요약');

    const sRows = [], wRows = [];
    lessons.forEach(l => {
      l.sentences.forEach(s => sRows.push({ 날짜: l.date, '회차 제목': l.title, '틀린 문장': s.x, '고친 문장': s.o }));
      l.words.forEach(w => wRows.push({ 날짜: l.date, 단어: w }));
    });
    addSheet(XLSX, wb, '문장', ['날짜', '회차 제목', '틀린 문장', '고친 문장'], sRows, [11, 18, 45, 55]);
    addSheet(XLSX, wb, '단어', ['날짜', '단어'], wRows, [11, 28]);

    const who = name || username || '회원';
    return { wb, filename: `수업리포트_${who}_${period.file}.xlsx`, stats: { ...c, students: lessons.length ? 1 : 0 } };
  }

  // 전체 회원 리포트
  function buildAll(XLSX, report) {
    const lessons = report.lessons || [];
    const period = periodLabel(report);
    const byUser = new Map();
    lessons.forEach(l => {
      const u = byUser.get(l.username) || { 회원: l.username, 이름: '', '엔보임 아이디': '', '수업 횟수': 0, '문장 수': 0, '단어 수': 0, dates: [] };
      if (l.name) u.이름 = l.name;
      if (l.nvoimId) u['엔보임 아이디'] = l.nvoimId;
      u['수업 횟수'] += 1; u['문장 수'] += l.sentences.length; u['단어 수'] += l.words.length;
      u.dates.push(l.date.slice(5).replace('-', '/'));
      byUser.set(l.username, u);
    });
    const summary = [...byUser.values()].sort((a, b) => (a.회원 < b.회원 ? -1 : 1)).map(u => ({ ...u, '수업 날짜': u.dates.join(', ') }));
    const sRows = [], wRows = [];
    lessons.forEach(l => {
      l.sentences.forEach(s => sRows.push({ 날짜: l.date, 회원: l.username, 이름: l.name, '회차 제목': l.title, '틀린 문장': s.x, '고친 문장': s.o }));
      l.words.forEach(w => wRows.push({ 날짜: l.date, 회원: l.username, 이름: l.name, 단어: w }));
    });
    const wb = XLSX.utils.book_new();
    addSheet(XLSX, wb, '요약', ['회원', '이름', '엔보임 아이디', '수업 횟수', '문장 수', '단어 수', '수업 날짜'], summary, [14, 10, 14, 10, 9, 9, 50]);
    addSheet(XLSX, wb, '문장', ['날짜', '회원', '이름', '회차 제목', '틀린 문장', '고친 문장'], sRows, [11, 14, 10, 18, 45, 55]);
    addSheet(XLSX, wb, '단어', ['날짜', '회원', '이름', '단어'], wRows, [11, 14, 10, 25]);
    return { wb, filename: `수업피드백_전체_${period.file}.xlsx`, stats: { ...counts(lessons), students: byUser.size } };
  }

  async function download(report, { mode = 'all' } = {}) {
    const XLSX = await loadXlsx();
    const built = mode === 'member' ? buildMember(XLSX, report) : buildAll(XLSX, report);
    saveWorkbook(XLSX, built.wb, built.filename);
    return built.stats;
  }

  global.FeedbackReport = { download };
})(window);
