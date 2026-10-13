/* =====================================================================
   학습 리포트 화면 (회원 페이지 · 관리자 페이지 공용)
   ---------------------------------------------------------------------
   LearningReport.renderStudent(container, report, { periodWord })  — 회원 한 명 분석
   LearningReport.renderOverview(container, report, { onPick })     — 전체 회원 요약
   LearningReport.printReport(container, title)                     — 인쇄 / PDF 저장
   서버: /api/member-insight, /api/admin-insight (netlify/functions/_lib/insight.mjs)
   ===================================================================== */
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  const CSS = `
  .lr{--lr-ink:#1B2A4E; --lr-bar:#2F4A7A; --lr-bar-soft:#C9D3E6; --lr-gold:#C9A227; --lr-grid:#EEE7D4; --lr-good:#1E8E5A; --lr-mid:#B9790A; --lr-bad:#C4453A; color:var(--body-text,#3C4257);}
  .lr *{box-sizing:border-box;}
  .lr-head{display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin:6px 0 12px;}
  .lr-title{font-size:1.15rem; font-weight:800; color:var(--lr-ink); margin:0;}
  .lr-period{font-size:0.82rem; color:var(--muted,#7C7566); margin-top:3px;}
  .lr-tag{display:inline-block; font-size:0.72rem; font-weight:800; padding:2px 8px; border-radius:999px; margin-left:6px; vertical-align:2px; background:#E4F5EC; color:var(--lr-good);}
  .lr-tag.live{background:#FBF1DC; color:var(--lr-mid);}
  .lr-comment{background:#FFFBEF; border:1px solid #F0E2B4; border-left:4px solid var(--lr-gold); border-radius:12px; padding:12px 14px; margin-bottom:14px; font-size:0.9rem; line-height:1.65; color:var(--lr-ink);}
  .lr-comment ul{margin:0; padding-left:18px;}
  .lr-tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; margin-bottom:14px;}
  .lr-tile{background:var(--panel,#fff); border:1px solid var(--border,#EAE1C8); border-radius:12px; padding:10px 12px;}
  .lr-tile .l{font-size:0.74rem; color:var(--muted,#7C7566); font-weight:700;}
  .lr-tile .n{font-size:1.45rem; font-weight:800; color:var(--lr-ink); line-height:1.25; font-variant-numeric:tabular-nums;}
  .lr-tile .n small{font-size:0.8rem; font-weight:700; color:var(--muted,#7C7566); margin-left:2px;}
  .lr-tile .d{font-size:0.74rem; font-weight:700; color:var(--muted,#7C7566);}
  .lr-tile .d.up{color:var(--lr-good);} .lr-tile .d.down{color:var(--lr-bad);}
  .lr-sec{background:var(--panel,#fff); border:1px solid var(--border,#EAE1C8); border-radius:12px; padding:14px; margin-bottom:14px;}
  .lr-sec h3{margin:0 0 2px; font-size:0.97rem; font-weight:800; color:var(--lr-ink);}
  .lr-sec .lr-desc{font-size:0.78rem; color:var(--muted,#7C7566); margin-bottom:10px;}
  .lr-grid2{display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px;}
  .lr-grid2 > .lr-sec{margin-bottom:0;}
  .lr-svg{width:100%; height:auto; display:block; overflow:visible;}
  .lr-svg text{font-family:inherit;}
  .lr-svg .hit{fill:transparent; cursor:default;}
  .lr-svg .hit:hover + .mark, .lr-svg .mark:hover{opacity:0.8;}
  .lr-months{display:flex; flex-wrap:wrap; gap:16px;}
  .lr-cal{flex:1 1 260px; max-width:360px;}
  .lr-cal .cap{font-size:0.82rem; font-weight:800; color:var(--lr-ink); margin-bottom:4px;}
  .lr-cal table{width:100%; border-collapse:separate; border-spacing:3px; table-layout:fixed;}
  .lr-cal th{font-size:0.68rem; color:var(--muted,#7C7566); font-weight:700; text-align:center; padding:0;}
  .lr-cal td{height:42px; border-radius:8px; background:#F6F2E6; vertical-align:top; padding:3px 4px; font-size:0.68rem; color:var(--muted,#7C7566); position:relative;}
  .lr-cal td.out{background:transparent;}
  .lr-cal td.lesson{background:#E7ECF6; color:var(--lr-ink); font-weight:800;}
  .lr-cal td .dot{display:block; margin-top:2px; font-size:0.62rem; font-weight:800; color:#fff; background:var(--lr-bar); border-radius:4px; text-align:center; line-height:1.4;}
  .lr-cal td .pr{position:absolute; left:4px; right:4px; bottom:3px; height:4px; border-radius:2px; background:var(--lr-good);}
  .lr-cal td.today{outline:2px solid var(--lr-gold); outline-offset:-2px;}
  .lr-legend{display:flex; gap:14px; flex-wrap:wrap; font-size:0.75rem; color:var(--muted,#7C7566); margin-top:8px; align-items:center;}
  .lr-legend i{display:inline-block; width:14px; height:10px; border-radius:3px; margin-right:4px; vertical-align:-1px;}
  .lr-chips{display:flex; flex-wrap:wrap; gap:6px;}
  .lr-chip{font-size:0.75rem; font-weight:800; border-radius:999px; padding:3px 9px; background:var(--bg,#FAF6EC); border:1px solid var(--border,#EAE1C8); color:var(--body-text,#3C4257); white-space:nowrap;}
  .lr-chip.good{background:#E4F5EC; color:var(--lr-good); border-color:#BFE6D0;}
  .lr-chip.mid{background:#FBF1DC; color:var(--lr-mid); border-color:#F0DDAE;}
  .lr-chip.bad{background:#FBEAE8; color:var(--lr-bad); border-color:#F0C6C1;}
  .lr-chip.none{color:var(--lr-bad); background:#fff;}
  .lr-lesson{border-top:1px solid var(--border,#EAE1C8); padding:10px 0;}
  .lr-lesson:first-of-type{border-top:none; padding-top:2px;}
  .lr-lesson .ld{font-size:0.8rem; font-weight:800; color:var(--lr-ink); margin-bottom:6px;}
  .lr-lesson .ld span{font-weight:600; color:var(--muted,#7C7566); margin-left:6px;}
  .lr-sent{display:flex; gap:10px; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; padding:6px 0; border-bottom:1px dashed #EFE8D6;}
  .lr-sent:last-child{border-bottom:none;}
  .lr-sent .tx{flex:1 1 300px; font-size:0.88rem; line-height:1.5;}
  .lr-sent .x{color:var(--lr-bad); text-decoration:line-through; opacity:0.8; font-size:0.82rem;}
  .lr-sent .o{color:var(--lr-ink); font-weight:700;}
  .lr-words{display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;}
  .lr-word{border:1px solid var(--border,#EAE1C8); background:var(--input-bg,#FBF9F2); border-radius:10px; padding:5px 9px; font-size:0.82rem; color:var(--lr-ink); font-weight:700;}
  .lr-word small{font-weight:700; margin-left:4px;}
  .lr-table{width:100%; border-collapse:collapse; font-size:0.82rem;}
  .lr-table th{text-align:left; color:var(--muted,#7C7566); font-weight:800; border-bottom:1px solid var(--border,#EAE1C8); padding:7px 6px; white-space:nowrap;}
  .lr-table td{border-bottom:1px solid #F1EBDA; padding:7px 6px; vertical-align:middle; font-variant-numeric:tabular-nums;}
  .lr-table td.num, .lr-table th.num{text-align:right;}
  .lr-scroll{overflow-x:auto;}
  .lr-empty{color:var(--muted,#7C7566); font-size:0.85rem; padding:6px 0;}
  .lr-tip{position:fixed; z-index:3000; pointer-events:none; background:#1B2A4E; color:#fff; font-size:0.78rem; line-height:1.45; padding:6px 9px; border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,0.2); max-width:260px; display:none;}
  @media print{ .lr-noprint{display:none !important;} .lr-sec, .lr-tile{break-inside:avoid;} }
  `;
  function ensureCSS() {
    if (document.getElementById('lr-css')) return;
    const st = document.createElement('style'); st.id = 'lr-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  /* ---------- 툴팁 (마우스를 올리거나 손가락으로 누르면) ---------- */
  let tipEl = null;
  function setupTips(root) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'lr-tip'; document.body.appendChild(tipEl); }
    const show = (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t || !root.contains(t)) { tipEl.style.display = 'none'; return; }
      tipEl.innerHTML = t.getAttribute('data-tip');
      tipEl.style.display = 'block';
      const p = e.touches ? e.touches[0] : e;
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      let x = p.clientX + 12, y = p.clientY - h - 10;
      if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
      if (y < 8) y = p.clientY + 16;
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    };
    root.addEventListener('mousemove', show);
    root.addEventListener('mouseleave', () => { tipEl.style.display = 'none'; });
    root.addEventListener('touchstart', show, { passive: true });
    window.addEventListener('scroll', () => { if (tipEl) tipEl.style.display = 'none'; }, { passive: true });
  }

  /* ---------- 날짜 ---------- */
  const ymdUTC = s => new Date(s + 'T00:00:00Z');
  function fmtDate(s) { const d = ymdUTC(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]})`; }
  function fmtMonth(m) { const [y, mo] = m.split('-'); return `${y}년 ${Number(mo)}월`; }
  function shortMonth(m) { return `${Number(m.split('-')[1])}월`; }
  function periodTitle(r) {
    if (r.month) return fmtMonth(r.month);
    return `${r.from.replace(/-/g, '.')} ~ ${r.to.replace(/-/g, '.')}`;
  }
  function todayKst() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function scoreClass(n) { return n == null ? '' : n >= 85 ? 'good' : n >= 60 ? 'mid' : 'bad'; }

  /* ---------- 차트: 세로 막대 (한 가지 값) ---------- */
  // items: [{ label, value, tip, highlight }]
  function barChart(items, { height = 170, max, unit = '', valueFmt, labelMax = false } = {}) {
    const W = 520, H = height, padL = 30, padR = 8, padT = 18, padB = 26;
    const top = Math.max(1, max != null ? max : Math.max(...items.map(i => i.value || 0)));
    const nice = top <= 5 ? Math.max(top, 1) : Math.ceil(top / 5) * 5;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const slot = plotW / Math.max(items.length, 1);
    const bw = Math.max(4, Math.min(34, slot * 0.6));
    const y = v => padT + plotH - (v / nice) * plotH;
    const fmt = valueFmt || (v => `${v}${unit}`);
    const peak = Math.max(...items.map(i => i.value || 0));
    let g = '';
    const ticks = nice <= 5 ? Array.from({ length: nice + 1 }, (_, i) => i) : [0, nice / 2, nice];
    ticks.forEach(t => {
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--lr-grid)" stroke-width="1"/>`;
      g += `<text x="${padL - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="#9A927F">${Math.round(t)}</text>`;
    });
    const labelEvery = Math.ceil(items.length / 12);
    items.forEach((it, i) => {
      const cx = padL + slot * i + slot / 2;
      const v = it.value || 0;
      const h = (v / nice) * plotH;
      if (v > 0) {
        const r = Math.min(4, bw / 2, h);
        const x0 = cx - bw / 2, y0 = y(v), yb = padT + plotH;
        g += `<path class="mark" d="M${x0},${yb} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${yb} Z" fill="${it.highlight ? 'var(--lr-bar)' : 'var(--lr-bar-soft)'}"/>`;
        if (labelMax ? v === peak : (it.highlight || items.length <= 8)) g += `<text x="${cx}" y="${y0 - 5}" text-anchor="middle" font-size="10.5" font-weight="800" fill="var(--lr-ink)">${fmt(v)}</text>`;
      }
      if (i % labelEvery === 0) g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#7C7566">${esc(it.label)}</text>`;
      g += `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" data-tip="${esc(it.tip || `${it.label}: ${fmt(v)}`)}"/>`;
    });
    g += `<line x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}" stroke="#CFC6AE" stroke-width="1"/>`;
    return `<svg class="lr-svg" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
  }

  /* ---------- 차트: 꺾은선 (0~100%) ---------- */
  function lineChart(points, { height = 170 } = {}) {
    const W = 520, H = height, padL = 34, padR = 12, padT = 18, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const step = points.length > 1 ? plotW / (points.length - 1) : 0;
    const x = i => padL + (points.length > 1 ? step * i : plotW / 2);
    const y = v => padT + plotH - (v / 100) * plotH;
    let g = '';
    [0, 50, 100].forEach(t => {
      g += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--lr-grid)"/>`;
      g += `<text x="${padL - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="#9A927F">${t}%</text>`;
    });
    // 값이 있는 점끼리만 선으로 잇기
    let path = '', pen = false;
    points.forEach((p, i) => {
      if (p.value == null) { pen = false; return; }
      path += `${pen ? 'L' : 'M'}${x(i)},${y(p.value)} `; pen = true;
    });
    if (path) g += `<path d="${path}" fill="none" stroke="var(--lr-bar)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const labelEvery = Math.ceil(points.length / 12);
    points.forEach((p, i) => {
      if (p.value != null) {
        g += `<circle class="mark" cx="${x(i)}" cy="${y(p.value)}" r="4.5" fill="var(--lr-bar)" stroke="#fff" stroke-width="2"/>`;
        if (i === points.length - 1 || points.length <= 6) g += `<text x="${x(i)}" y="${y(p.value) - 9}" text-anchor="middle" font-size="10.5" font-weight="800" fill="var(--lr-ink)">${p.value}%</text>`;
      }
      if (i % labelEvery === 0) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#7C7566">${esc(p.label)}</text>`;
      const hw = points.length > 1 ? step / 2 : plotW / 2;
      g += `<rect class="hit" x="${x(i) - hw}" y="${padT}" width="${hw * 2}" height="${plotH}" data-tip="${esc(p.tip)}"/>`;
    });
    if (!points.some(p => p.value != null)) g += `<text x="${W / 2}" y="${padT + plotH / 2}" text-anchor="middle" font-size="12" fill="#9A927F">아직 따라 말하기 기록이 없어요</text>`;
    return `<svg class="lr-svg" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
  }

  /* ---------- 차트: 가로 막대 (순위) ---------- */
  function hbarChart(items) {
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div>${items.map(it => `
      <div data-tip="${esc(it.tip)}" style="display:grid; grid-template-columns:minmax(70px,30%) 1fr auto; gap:8px; align-items:center; margin:5px 0; font-size:0.84rem;">
        <div style="font-weight:800; color:var(--lr-ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(it.label)}</div>
        <div style="background:#F3EEE0; border-radius:4px; height:12px;"><div style="width:${Math.max(3, (it.value / max) * 100)}%; height:12px; border-radius:4px; background:var(--lr-bar);"></div></div>
        <div style="font-weight:700; color:var(--body-text,#3C4257); white-space:nowrap; font-variant-numeric:tabular-nums;">${esc(it.right)}</div>
      </div>`).join('')}</div>`;
  }

  /* ---------- 출결 달력 ---------- */
  function calendars(r) {
    const months = [];
    for (let m = r.from.slice(0, 7); m <= r.to.slice(0, 7);) {
      months.push(m);
      const [y, mo] = m.split('-').map(Number);
      m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
    }
    const today = todayKst();
    const maxPr = Math.max(1, ...Object.values(r.days || {}).map(d => d.spoke + d.listen + d.failed));
    return `<div class="lr-months">${months.slice(-12).map(m => {
      const [y, mo] = m.split('-').map(Number);
      const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      let cells = '';
      for (let i = 0; i < first; i++) cells += '<td class="out"></td>';
      for (let d = 1; d <= last; d++) {
        const key = `${m}-${String(d).padStart(2, '0')}`;
        const inRange = key >= r.from && key <= r.to;
        const info = (r.days || {})[key];
        const cls = [];
        if (!inRange) cls.push('out');
        if (info && info.lessons) cls.push('lesson');
        if (key === today) cls.push('today');
        let inner = `${d}`;
        const tip = [`<b>${fmtDate(key)}</b>`];
        if (info && info.lessons) { inner += `<span class="dot">수업${info.lessons > 1 ? ' ' + info.lessons : ''}</span>`; tip.push(`📘 수업 ${info.lessons}회${info.titles && info.titles.length ? ' · ' + esc(info.titles.join(', ')) : ''}`); }
        const pr = info ? info.spoke + info.listen + info.failed : 0;
        if (pr) {
          inner += `<span class="pr" style="opacity:${0.35 + 0.65 * (pr / maxPr)}"></span>`;
          tip.push(`🗣️ 쉐도잉 ${pr}번 반복${info.spoke ? ` · 따라 말하기 ${info.spoke}회 · 평균 ${info.avg}%` : ''}${info.listen ? ` · 듣기만 ${info.listen}회` : ''}`);
        }
        if (inRange && !info) tip.push('기록 없음');
        cells += `<td class="${cls.join(' ')}" ${inRange ? `data-tip="${esc(tip.join('<br>'))}"` : ''}>${inner}</td>`;
        if ((first + d) % 7 === 0 && d !== last) cells += '</tr><tr>';
      }
      return `<div class="lr-cal"><div class="cap">${fmtMonth(m)}</div><table><thead><tr>${WD.map(w => `<th>${w}</th>`).join('')}</tr></thead><tbody><tr>${cells}</tr></tbody></table></div>`;
    }).join('')}</div>
    <div class="lr-legend"><span><i style="background:#E7ECF6; border:1px solid #C9D3E6"></i>수업한 날</span><span><i style="background:var(--lr-good); height:4px"></i>쉐도잉 연습한 날 (진할수록 많이)</span><span><i style="background:transparent; outline:2px solid var(--lr-gold); outline-offset:-2px"></i>오늘</span></div>`;
  }

  /* ---------- 작은 도우미 ---------- */
  function delta(cur, prev, { unit = '', word = '지난달', pct = false } = {}) {
    if (cur == null || prev == null) return `<div class="d">${word} 기록 없음</div>`;
    const diff = cur - prev;
    if (diff === 0) return `<div class="d">${word}과 같아요</div>`;
    return `<div class="d ${diff > 0 ? 'up' : 'down'}">${word}보다 ${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${pct ? '%p' : unit}</div>`;
  }
  function practiceChip(p) {
    if (!p || !p.total) return '<span class="lr-chip none">연습 안 함</span>';
    const parts = [];
    if (p.spoke) parts.push(`<span class="lr-chip ${scoreClass(p.avg)}" data-tip="따라 말하기 ${p.spoke}회 · 평균 ${p.avg}% · 최고 ${p.best}%">🗣️ ${p.spoke}회 · ${p.avg}%</span>`);
    if (p.listen) parts.push(`<span class="lr-chip" data-tip="마이크 끄고 듣기만 ${p.listen}회">👂 ${p.listen}회</span>`);
    if (!p.spoke && !p.listen && p.failed) parts.push(`<span class="lr-chip bad">인식 실패 ${p.failed}회</span>`);
    return parts.join('');
  }

  /* ---------- 자동 코멘트 ---------- */
  function comments(r, word) {
    const k = r.kpi, p = r.prev, out = [];
    const lessonDiff = k.lessons - p.lessons;
    out.push(`이 기간에 수업을 <b>${k.lessons}번</b> 했어요${p.lessons || k.lessons ? (lessonDiff > 0 ? ` (${word}보다 ${lessonDiff}번 많아요 👏)` : lessonDiff < 0 ? ` (${word}보다 ${-lessonDiff}번 적어요)` : ` (${word}과 같아요)`) : ''}. 고친 문장 <b>${k.sentences}개</b>, 발음 단어 <b>${k.words}개</b>를 배웠어요.`);
    if (k.practiceDays) {
      let s = `쉐도잉은 <b>${k.practiceDays}일</b> 동안 했고, 따라 말하기 <b>${k.spoke}회</b>`;
      if (k.avg != null) {
        s += ` · 평균 일치도 <b>${k.avg}%</b>`;
        if (p.avg != null) s += k.avg > p.avg ? ` (${word}보다 ${k.avg - p.avg}%p 올랐어요 📈)` : k.avg < p.avg ? ` (${word}보다 ${p.avg - k.avg}%p 내려갔어요)` : '';
      }
      out.push(s + '.');
      const lessonDays = Object.keys(r.days || {}).filter(d => r.days[d].lessons);
      const both = lessonDays.filter(d => { const x = r.days[d]; return x.spoke + x.listen + x.failed > 0; }).length;
      if (lessonDays.length) out.push(`수업한 ${lessonDays.length}일 중 <b>${both}일</b>은 그날 바로 쉐도잉까지 했어요.`);
    } else {
      out.push('이 기간에는 아직 쉐도잉 연습 기록이 없어요. 수업이 끝나고 그날 받은 문장을 10번만 따라 말해 보세요.');
    }
    if (r.review) out.push(`예전 수업 내용 복습도 <b>${r.review}번</b> 했어요.`);
    const allS = r.lessons.reduce((n, l) => n + l.sentences.length, 0);
    const notYet = r.lessons.reduce((n, l) => n + l.sentences.filter(s => !s.practice || !s.practice.total).length, 0);
    if (allS && notYet) out.push(`이 기간 문장 ${allS}개 중 <b>${notYet}개</b>는 아직 연습하지 않았어요.`);
    else if (allS) out.push('이 기간에 배운 문장을 <b>모두</b> 한 번 이상 연습했어요! 🎉');
    if (r.weakWords && r.weakWords.length) out.push(`따라 말할 때 자주 빠뜨린 단어: ${r.weakWords.slice(0, 5).map(w => `<b>${esc(w.word)}</b>`).join(', ')}`);
    return out;
  }

  /* ---------- 회원 한 명 리포트 ---------- */
  function renderStudent(container, r, opts = {}) {
    ensureCSS();
    const word = r.month ? '지난달' : '이전 같은 기간';
    const k = r.kpi, p = r.prev;
    const who = r.name ? `${esc(r.name)} (${esc(r.username)})` : esc(r.username);
    const tag = r.saved ? '<span class="lr-tag">매달 1일 자동 정리</span>' : (r.complete ? '' : '<span class="lr-tag live">진행 중 · 지금까지 기준</span>');

    const tiles = [
      ['📘 수업 횟수', `${k.lessons}<small>회</small>`, delta(k.lessons, p.lessons, { unit: '회', word })],
      ['✏️ 고친 문장', `${k.sentences}<small>개</small>`, `<div class="d">발음 단어 ${k.words}개</div>`],
      ['📅 쉐도잉 연습일', `${k.practiceDays}<small>일</small>`, delta(k.practiceDays, p.practiceDays, { unit: '일', word })],
      ['🗣️ 따라 말하기', `${k.spoke}<small>회</small>`, `<div class="d">듣기만 ${k.listen}회${k.failed ? ` · 인식 실패 ${k.failed}회` : ''}</div>`],
      ['🎯 쉐도잉 평균', k.avg == null ? '-' : `${k.avg}<small>%</small>`, k.avg == null ? '<div class="d">따라 말하기 기록 없음</div>' : delta(k.avg, p.avg, { word, pct: true })],
      ['🏆 최고 일치도', k.spoke ? `${k.best}<small>%</small>` : '-', `<div class="d">연습한 문장·단어 ${k.practicedItems}개</div>`],
    ];

    const hist = r.history || [];
    const lastIdx = hist.length - 1;
    const lessonBars = barChart(hist.map((h, i) => ({ label: shortMonth(h.month), value: h.lessons, highlight: i === lastIdx, tip: `<b>${fmtMonth(h.month)}</b><br>수업 ${h.lessons}회` })), { unit: '회' });
    const scoreLine = lineChart(hist.map(h => ({ label: shortMonth(h.month), value: h.avg, tip: `<b>${fmtMonth(h.month)}</b><br>${h.avg == null ? '따라 말하기 기록 없음' : `평균 일치도 ${h.avg}% · 따라 말하기 ${h.spoke}회 · 연습 ${h.practiceDays}일`}` })));

    // 일별(기간이 길면 주별) 쉐도잉 반복 횟수
    const dayKeys = [];
    for (let d = r.from; d <= r.to; d = new Date(ymdUTC(d).getTime() + 86400000).toISOString().slice(0, 10)) dayKeys.push(d);
    let dailyItems;
    if (dayKeys.length <= 62) {
      dailyItems = dayKeys.map(d => { const x = (r.days || {})[d]; const n = x ? x.spoke + x.listen + x.failed : 0; return { label: `${Number(d.slice(8))}`, value: n, highlight: true, tip: `<b>${fmtDate(d)}</b><br>${n ? `쉐도잉 ${n}번${x.spoke ? ` · 평균 ${x.avg}%` : ''}` : '연습 안 함'}${x && x.lessons ? '<br>📘 수업한 날' : ''}` }; });
    } else {
      dailyItems = [];
      for (let i = 0; i < dayKeys.length; i += 7) {
        const wk = dayKeys.slice(i, i + 7);
        const n = wk.reduce((s, d) => { const x = (r.days || {})[d]; return s + (x ? x.spoke + x.listen + x.failed : 0); }, 0);
        dailyItems.push({ label: `${Number(wk[0].slice(5, 7))}/${Number(wk[0].slice(8))}`, value: n, highlight: true, tip: `<b>${fmtDate(wk[0])} ~ ${fmtDate(wk[wk.length - 1])}</b><br>쉐도잉 ${n}번` });
      }
    }
    const totalPractice = dailyItems.reduce((s, i) => s + i.value, 0);

    const weekdays = (r.weekdays || []).map((n, i) => n ? `<span class="lr-chip">${WD[i]} ${n}회</span>` : '').join('');

    const weak = (r.weakWords || []).length
      ? hbarChart(r.weakWords.map(w => ({ label: w.word, value: w.missed, right: `${w.missed}번 놓침 · ${w.rate}%`, tip: `<b>${esc(w.word)}</b><br>이 단어가 나온 따라 말하기 ${w.seen}번 중 ${w.missed}번 빠뜨렸어요` })))
      : '<div class="lr-empty">따라 말하기 기록이 쌓이면 자주 놓치는 단어를 보여드려요.</div>';

    const top = (r.topPracticed || []).length
      ? `<table class="lr-table"><thead><tr><th>문장·단어</th><th class="num">반복</th><th class="num">평균</th><th class="num">최고</th></tr></thead><tbody>${r.topPracticed.map(t => `<tr><td style="font-weight:700; color:var(--lr-ink)">${t.type === 'word' ? '<span class="lr-chip" style="margin-right:4px">단어</span>' : ''}${esc(t.text)}</td><td class="num">${t.total}회</td><td class="num">${t.avg == null ? '-' : `<span class="lr-chip ${scoreClass(t.avg)}">${t.avg}%</span>`}</td><td class="num">${t.spoke ? t.best + '%' : '-'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="lr-empty">아직 이 기간에 연습한 문장이 없어요.</div>';

    const lessonsHTML = r.lessons.length ? r.lessons.map(l => `
      <div class="lr-lesson">
        <div class="ld">${fmtDate(l.date)}<span>${esc(l.title)}</span></div>
        ${l.sentences.map(s => `<div class="lr-sent"><div class="tx">${s.x ? `<div class="x">${esc(s.x)}</div>` : ''}<div class="o">${esc(s.o)}</div></div><div class="lr-chips">${practiceChip(s.practice)}</div></div>`).join('')}
        ${l.words.length ? `<div class="lr-words">${l.words.map(w => `<span class="lr-word" ${w.practice && w.practice.total ? `data-tip="${esc(`따라 말하기 ${w.practice.spoke}회${w.practice.avg != null ? ` · 평균 ${w.practice.avg}%` : ''}${w.practice.listen ? ` · 듣기만 ${w.practice.listen}회` : ''}`)}"` : 'data-tip="아직 연습 안 함"'}>🔤 ${esc(w.w)}<small class="${w.practice && w.practice.avg != null ? scoreClass(w.practice.avg) : ''}" style="color:${w.practice && w.practice.total ? (w.practice.avg != null ? (w.practice.avg >= 85 ? 'var(--lr-good)' : w.practice.avg >= 60 ? 'var(--lr-mid)' : 'var(--lr-bad)') : 'var(--muted,#7C7566)') : 'var(--lr-bad)'}">${w.practice && w.practice.total ? (w.practice.avg != null ? w.practice.avg + '%' : '👂' + w.practice.listen) : '·'}</small></span>`).join('')}</div>` : ''}
      </div>`).join('') : '<div class="lr-empty">이 기간에는 수업 피드백이 없어요.</div>';

    container.innerHTML = `<div class="lr">
      <div class="lr-head">
        <div><h3 class="lr-title">📊 ${periodTitle(r)} 학습 리포트 ${tag}</h3>
          <div class="lr-period">${who} · ${r.from.replace(/-/g, '.')} ~ ${r.to.replace(/-/g, '.')}</div></div>
        <button class="btn-ghost btn-small lr-noprint lr-print">🖨️ 인쇄 · PDF 저장</button>
      </div>
      <div class="lr-comment"><ul>${comments(r, word).map(c => `<li>${c}</li>`).join('')}</ul></div>
      <div class="lr-tiles">${tiles.map(([l, n, d]) => `<div class="lr-tile"><div class="l">${l}</div><div class="n">${n}</div>${d}</div>`).join('')}</div>

      <div class="lr-sec"><h3>🗓️ 출결 · 연습 달력</h3>
        <div class="lr-desc">수업 피드백이 올라온 날을 출석으로 표시해요. 날짜를 누르거나 마우스를 올리면 그날 기록이 나와요.${weekdays ? ' 수업 요일:' : ''}</div>
        ${weekdays ? `<div class="lr-chips" style="margin-bottom:10px">${weekdays}</div>` : ''}
        ${calendars(r)}
      </div>

      <div class="lr-grid2">
        <div class="lr-sec"><h3>📘 월별 수업 횟수</h3><div class="lr-desc">${hist.length ? `${fmtMonth(hist[0].month)} ~ ${fmtMonth(hist[lastIdx].month)}` : ''}</div>${lessonBars}</div>
        <div class="lr-sec"><h3>🎯 월별 쉐도잉 평균 일치도</h3><div class="lr-desc">따라 말하기에서 원어민 문장 단어를 맞게 말한 비율의 평균</div>${scoreLine}</div>
      </div>
      <div style="height:14px"></div>

      <div class="lr-sec"><h3>🗣️ ${dayKeys.length <= 62 ? '날짜별' : '주별'} 쉐도잉 반복 횟수</h3><div class="lr-desc">이 기간 모두 ${totalPractice}번 반복했어요 (따라 말하기 + 듣기만)</div>${barChart(dailyItems, { height: 150, unit: '번', labelMax: true })}</div>

      <div class="lr-grid2">
        <div class="lr-sec"><h3>🔁 가장 많이 연습한 문장</h3><div class="lr-desc">이 기간 반복 횟수 순</div><div class="lr-scroll">${top}</div></div>
        <div class="lr-sec"><h3>⚠️ 자주 놓치는 단어</h3><div class="lr-desc">따라 말할 때 빠뜨린 횟수 순 (a, the 같은 짧은 단어 제외)</div>${weak}</div>
      </div>
      <div style="height:14px"></div>

      <div class="lr-sec"><h3>📚 공부한 문장 · 단어</h3>
        <div class="lr-desc">수업에서 고친 문장과 발음 단어예요. 오른쪽은 지금까지 쌓인 연습 기록(따라 말하기 횟수 · 평균 일치도)이에요.</div>
        ${lessonsHTML}
      </div>
    </div>`;
    container.querySelector('.lr-print').addEventListener('click', () => printReport(container, `${periodTitle(r)} 학습 리포트 - ${r.name || r.username}`));
    setupTips(container);
  }

  /* ---------- 전체 회원 요약 (관리자) ---------- */
  function renderOverview(container, r, opts = {}) {
    ensureCSS();
    const t = r.total;
    const tag = r.saved ? '<span class="lr-tag">매달 1일 자동 정리</span>' : (r.complete ? '' : '<span class="lr-tag live">진행 중 · 지금까지 기준</span>');
    const members = r.members || [];
    const withLessons = members.filter(m => m.lessons).sort((a, b) => b.lessons - a.lessons);
    const tiles = [
      ['📘 전체 수업', `${t.lessons}<small>회</small>`],
      ['👥 수업한 학생', `${t.activeStudents}<small>명</small>`],
      ['🗣️ 쉐도잉한 학생', `${t.practicingStudents}<small>명</small>`],
      ['🎯 전체 평균 일치도', t.avg == null ? '-' : `${t.avg}<small>%</small>`],
    ];
    const chart = withLessons.length
      ? hbarChart(withLessons.slice(0, 20).map(m => ({ label: m.name ? `${m.name}` : m.username, value: m.lessons, right: `${m.lessons}회`, tip: `<b>${esc(m.name || '')} ${esc(m.username)}</b><br>수업 ${m.lessons}회 · 쉐도잉 ${m.practiceDays}일${m.avg != null ? ` · 평균 ${m.avg}%` : ''}` })))
      : '<div class="lr-empty">이 기간에는 수업 기록이 없어요.</div>';
    const rows = members.map(m => `<tr>
      <td><b style="color:var(--lr-ink)">${esc(m.username)}</b>${m.name ? `<div style="font-size:0.75rem;color:var(--muted,#7C7566)">${esc(m.name)}</div>` : ''}</td>
      <td class="num">${m.lessons ? `${m.lessons}회` : '<span style="color:var(--lr-bad)">0</span>'}</td>
      <td class="num">${m.sentences}</td><td class="num">${m.words}</td>
      <td class="num">${m.practiceDays ? `${m.practiceDays}일` : '<span style="color:var(--lr-bad)">0</span>'}</td>
      <td class="num">${m.spoke}회</td>
      <td class="num">${m.avg == null ? '-' : `<span class="lr-chip ${scoreClass(m.avg)}">${m.avg}%</span>`}</td>
      <td class="num" style="white-space:nowrap">${m.lastPractice ? new Date(m.lastPractice).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '-'}</td>
      <td class="lr-noprint"><button class="btn-ghost btn-small lr-pick" data-u="${esc(m.username)}">리포트 보기</button></td>
    </tr>`).join('');
    container.innerHTML = `<div class="lr">
      <div class="lr-head">
        <div><h3 class="lr-title">👥 ${periodTitle(r)} 전체 회원 학습 현황 ${tag}</h3><div class="lr-period">${r.from.replace(/-/g, '.')} ~ ${r.to.replace(/-/g, '.')}</div></div>
        <button class="btn-ghost btn-small lr-noprint lr-print">🖨️ 인쇄 · PDF 저장</button>
      </div>
      <div class="lr-tiles">${tiles.map(([l, n]) => `<div class="lr-tile"><div class="l">${l}</div><div class="n">${n}</div></div>`).join('')}</div>
      <div class="lr-sec"><h3>📘 학생별 수업 횟수</h3><div class="lr-desc">수업이 많은 순 (최대 20명)</div>${chart}</div>
      <div class="lr-sec"><h3>📋 회원별 요약</h3><div class="lr-desc">"리포트 보기"를 누르면 그 회원의 자세한 학습 리포트가 나와요. 빨간 0은 이 기간에 수업이나 쉐도잉이 없었다는 뜻이에요.</div>
        <div class="lr-scroll"><table class="lr-table"><thead><tr><th>회원</th><th class="num">수업</th><th class="num">문장</th><th class="num">단어</th><th class="num">쉐도잉 연습일</th><th class="num">따라 말하기</th><th class="num">평균 일치도</th><th class="num">마지막 연습</th><th class="lr-noprint"></th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="lr-empty">회원이 없어요.</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
    container.querySelectorAll('.lr-pick').forEach(b => b.addEventListener('click', () => opts.onPick && opts.onPick(b.getAttribute('data-u'))));
    container.querySelector('.lr-print').addEventListener('click', () => printReport(container, `${periodTitle(r)} 전체 회원 학습 현황`));
    setupTips(container);
  }

  /* ---------- 인쇄 / PDF 저장 ---------- */
  function printReport(container, title) {
    const w = window.open('', '_blank');
    if (!w) { window.print(); return; }
    const vars = getComputedStyle(document.documentElement);
    const rootVars = ['--bg', '--panel', '--border', '--input-bg', '--text', '--body-text', '--muted'].map(v => `${v}:${vars.getPropertyValue(v)};`).join('');
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>:root{${rootVars}} body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Pretendard,"Malgun Gothic",Roboto,sans-serif; margin:24px; background:#fff; color:#3C4257;} .btn-ghost{display:none;} ${CSS}</style>
      </head><body>${container.innerHTML}<script>setTimeout(function(){window.print();},400);<\/script></body></html>`);
    w.document.close();
  }

  global.LearningReport = { renderStudent, renderOverview, printReport };
})(window);
