/* 관리자 — 📖 교재 쉐도잉 (admin.html의 apiFetch · membersCache를 씀)
 *  - 교재 만들기 · 고치기 · 삭제 (표지 그림은 브라우저에서 작게 줄여서 저장)
 *  - 유닛·문장은 글 상자에 붙여넣기: "# 유닛 이름" 줄 → 유닛 시작, 그 아래 한 줄에 한 문장 ("문장 | 뜻")
 *  - 공개 범위 '선택한 학생만'이면 넣어 줄 학생 체크
 *  - 회원을 고르면 교재·유닛별 연습 기록
 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const API = '/api/admin-books';
  const COLORS = ['#3B82C4', '#2E9E6B', '#E08A00', '#D9578A', '#7A5AF8', '#0E9AA7', '#C2410C', '#4F46E5'];
  const VIS = { members: '👥 모든 회원', assigned: '🎯 선택한 학생만', draft: '🔒 비공개' };
  const members = () => { try { return membersCache || []; } catch (e) { return []; } };
  let books = [], editing = null, cover = '';

  const status = (t, cls) => { $('bookStatus').textContent = t || ''; $('bookStatus').className = 'status' + (cls ? ' ' + cls : ''); };

  /* ---------- 유닛 글 ↔ 데이터 ---------- */
  function parseUnits(text) {
    const units = [];
    let cur = null;
    String(text || '').replace(/\r/g, '').split('\n').forEach(line => {
      const l = line.trim();
      if (!l) return;
      const h = l.match(/^#+\s*(.*)$/);
      if (h) { cur = { title: h[1].trim() || `Unit ${units.length + 1}`, sentences: [] }; units.push(cur); return; }
      if (!cur) { cur = { title: 'Unit 1', sentences: [] }; units.push(cur); }
      const [o, ...rest] = l.split('|');
      const en = o.replace(/^\s*(\d+[.)]|[-•*])\s+/, '').trim(); // 앞 번호·글머리표 지우기
      if (en) cur.sentences.push({ o: en, ko: rest.join('|').trim() });
    });
    return units.filter(u => u.sentences.length);
  }
  const unitsToText = units => (units || []).map(u => `# ${u.title}\n` + u.sentences.map(x => x.o + (x.ko ? ' | ' + x.ko : '')).join('\n')).join('\n');
  function countUnits() {
    const u = parseUnits($('bkUnits').value);
    $('bkCount').textContent = u.length ? `유닛 ${u.length}개 · 문장 ${u.reduce((a, x) => a + x.sentences.length, 0)}개` : '아직 유닛이 없어요.';
  }

  /* ---------- 표지 그림: 360×480 안으로 줄여서 JPEG ---------- */
  function readCover(file) {
    return new Promise((ok, no) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 360 / img.width, 480 / img.height);
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); no(new Error('그림을 읽지 못했어요.')); };
      img.src = url;
    });
  }
  function showCoverPrev() {
    const p = $('bkCoverPrev');
    p.style.backgroundImage = cover ? `url("${cover}")` : '';
    p.style.backgroundColor = cover ? '#fff' : $('bkColor').value;
    p.textContent = cover ? '' : ($('bkTitle').value || '표지').slice(0, 12);
  }
  $('bkCoverFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { cover = await readCover(f); showCoverPrev(); } catch (err) { alert(err.message); }
  });
  $('bkCoverClear').addEventListener('click', () => { cover = ''; $('bkCoverFile').value = ''; showCoverPrev(); });
  $('bkColor').addEventListener('input', showCoverPrev);
  $('bkTitle').addEventListener('input', showCoverPrev);
  $('bkUnits').addEventListener('input', countUnits);

  /* ---------- 넣어 줄 학생 ---------- */
  function renderAssign(list) {
    const set = new Set(list || []);
    $('bkAssign').innerHTML = members().length
      ? members().map(m => `<label><input type="checkbox" value="${esc(m.username)}" ${set.has(m.username) ? 'checked' : ''}> ${esc(m.username)}${m.name ? ' (' + esc(m.name) + ')' : ''}</label>`).join('')
      : '<span style="color:var(--muted)">등록된 회원이 없어요.</span>';
  }
  const syncAssignBox = () => $('bkAssignBox').classList.toggle('hidden', $('bkVis').value !== 'assigned');
  $('bkVis').addEventListener('change', syncAssignBox);

  /* ---------- 목록 ---------- */
  async function loadBooks() {
    try {
      books = (await apiFetch(API)).books || [];
      $('bookList').innerHTML = books.length ? books.map((b, k) => `
        <div class="bk-item">
          <div class="cv" style="${b.cover ? `background-image:url('${b.cover}')` : `background:${b.color || COLORS[k % COLORS.length]}`}">${b.cover ? '' : esc(b.title)}</div>
          <b>${esc(b.title)}</b>
          <span class="m">${b.unitCount}유닛 · 문장 ${b.sentenceCount}개${b.level ? ' · ' + esc(b.level) : ''}</span>
          <span class="m">${VIS[b.visibility] || ''}${b.visibility === 'assigned' ? ` (${b.assigned.length}명)` : ''}</span>
          <button class="btn-ghost btn-small" data-edit="${esc(b.id)}">✏️ 고치기</button>
        </div>`).join('') : '<div class="empty">아직 교재가 없어요. 「➕ 새 교재 만들기」로 시작하세요.</div>';
    } catch (e) { $('bookList').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
  }

  /* ---------- 만들기 · 고치기 ---------- */
  function openForm(book) {
    editing = book || null; cover = (book && book.cover) || '';
    $('bookFormTitle').textContent = book ? '✏️ 교재 고치기' : '➕ 새 교재';
    $('bkTitle').value = (book && book.title) || '';
    $('bkLevel').value = (book && book.level) || '';
    $('bkDesc').value = (book && book.desc) || '';
    $('bkVis').value = (book && book.visibility) || 'members';
    $('bkColor').value = (book && book.color) || COLORS[books.length % COLORS.length];
    $('bkCoverFile').value = '';
    $('bkUnits').value = book ? unitsToText(book.units) : '';
    $('bkDelete').classList.toggle('hidden', !book);
    renderAssign(book && book.assigned); syncAssignBox(); showCoverPrev(); countUnits();
    $('bookForm').classList.remove('hidden');
    $('bookForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('bkTitle').focus();
  }
  $('bookNewBtn').addEventListener('click', () => openForm(null));
  $('bkCancel').addEventListener('click', () => { $('bookForm').classList.add('hidden'); editing = null; });
  $('bookList').addEventListener('click', async e => {
    const b = e.target.closest('[data-edit]'); if (!b) return;
    b.disabled = true;
    try { openForm((await apiFetch(API + '?id=' + encodeURIComponent(b.dataset.edit))).book); }
    catch (err) { alert(err.message); }
    b.disabled = false;
  });
  $('bkSave').addEventListener('click', async () => {
    const units = parseUnits($('bkUnits').value);
    if (!$('bkTitle').value.trim()) { status('⚠️ 교재 이름을 넣어 주세요.', 'error'); $('bkTitle').focus(); return; }
    if (!units.length) { status('⚠️ 유닛과 문장을 넣어 주세요. ("# 유닛 이름" 줄 아래에 한 줄에 한 문장)', 'error'); $('bkUnits').focus(); return; }
    const btn = $('bkSave'); btn.disabled = true; status('저장 중…');
    try {
      const assigned = [...$('bkAssign').querySelectorAll('input:checked')].map(x => x.value);
      const d = await apiFetch(API, { method: 'POST', body: JSON.stringify({
        action: 'save', id: editing && editing.id, title: $('bkTitle').value, level: $('bkLevel').value, desc: $('bkDesc').value,
        color: $('bkColor').value, cover, units, visibility: $('bkVis').value, assigned,
      }) });
      status(`✅ "${d.book.title}" 저장했어요 — 유닛 ${d.book.unitCount}개 · 문장 ${d.book.sentenceCount}개`, 'success');
      $('bookForm').classList.add('hidden'); editing = null;
      await loadBooks(); loadRecords();
    } catch (e) { status('⚠️ ' + e.message, 'error'); }
    btn.disabled = false;
  });
  $('bkDelete').addEventListener('click', async () => {
    if (!editing || !confirm(`"${editing.title}" 교재를 삭제할까요? 되돌릴 수 없어요. (학생 연습 기록은 남아요)`)) return;
    try { await apiFetch(API, { method: 'POST', body: JSON.stringify({ action: 'delete', id: editing.id }) }); $('bookForm').classList.add('hidden'); editing = null; status('삭제했어요.'); loadBooks(); }
    catch (e) { alert(e.message); }
  });

  /* ---------- 회원별 연습 기록 ---------- */
  window.fillBookUsers = () => {
    const sel = $('bookUser'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- 선택 --</option>' + members().map(m => `<option value="${esc(m.username)}">${esc(m.username)}${m.name ? ' (' + esc(m.name) + ')' : ''}</option>`).join('');
    if (cur) sel.value = cur;
  };
  async function loadRecords() {
    const user = $('bookUser').value, box = $('bookRecords');
    if (!user) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="empty">불러오는 중…</div>';
    try {
      const d = await apiFetch(API + '?user=' + encodeURIComponent(user));
      box.innerHTML = `<div class="bk-rec">${d.books.length ? d.books.map(b => {
        const studied = b.units.filter(u => u.listen + u.spoke + u.failed > 0).length;
        return `<h3>📖 ${esc(b.title)} <span style="font-weight:400; color:var(--muted); font-size:0.8rem;">${b.canSee ? '' : '(이 학생에게는 안 보여요) '}· ${studied} / ${b.units.length}유닛 공부함</span></h3>
          <div class="vr-wrap"><table class="vr-table"><thead><tr><th>유닛</th><th>문장</th><th>듣기</th><th>따라 말하기</th><th>평균 일치도</th><th>최고</th><th>마지막 연습</th></tr></thead><tbody>
          ${b.units.map(u => `<tr class="${u.listen + u.spoke + u.failed ? '' : 'vr-dim'}"><td class="t">${esc(u.title)}</td><td class="num">${u.count}</td><td class="num">${u.listen}</td><td class="num">${u.spoke + u.failed}${u.failed ? ` <span style="color:var(--muted)">(인식 실패 ${u.failed})</span>` : ''}</td><td class="num">${u.avg == null ? '-' : u.avg + '%'}</td><td class="num">${u.best ? u.best + '%' : '-'}</td><td class="num">${u.last ? new Date(u.last).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '-'}</td></tr>`).join('')}
          </tbody></table></div>`;
      }).join('') : '<div class="empty">교재가 없어요.</div>'}</div>`;
    } catch (e) { box.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; }
  }
  $('bookUser').addEventListener('change', loadRecords);

  window.addEventListener('admintab', e => { if (e.detail === 'book') { window.fillBookUsers(); loadBooks(); if ($('bookUser').value) loadRecords(); } });
})();
