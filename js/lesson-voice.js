/* 🎥 수업영상 쉐도잉 — 목소리로 선생님·학생 나누기 (운영자 지시 2026-11-04: 선생님·학생 색이 너무 많이 틀려서)
   화상 수업 녹화는 선생님과 학생이 서로 다른 기기·마이크로 말해서 목소리 모양(음색·마이크 소리)이 확실히 달라요.
   문장마다 소리에서 목소리 특징(MFCC 평균·흩어짐, 높낮이)을 뽑아 두 묶음으로 나누고(k-means, 여러 번 시작해 가장 잘 나뉜 것),
   어느 묶음이 선생님인지는 글로 정한 사람(AI)이 더 많이 선생님인 쪽으로 정해요.
   두 묶음이 또렷하게 나뉘지 않으면(목소리 차이가 작음) 글로 정한 사람을 그대로 써요.
   need = 목소리로 정해도 되는 또렷함(margin) — 두 목소리가 덜 나뉜 녹화일수록 더 또렷한 문장만 목소리로 정해요.
   LessonVoice.speakers(sents[{s,e,sp}], pcm(Float32Array, 16kHz), SR) → { ok, changed, sep, labels:['T'|'S'...] } */
(function () {
  const N = 512, HOP = 256, NMEL = 26, NCEP = 13;
  // ---- FFT (radix-2, 제자리) ----
  const rev = new Uint16Array(N);
  for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cosT = new Float32Array(N / 2), sinT = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = -Math.sin(2 * Math.PI * i / N); }
  function fft(re, im) {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) for (let k = 0; k < half; k++) {
        const c = cosT[k * step], s = sinT[k * step], a = i + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  const hann = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  let melBank = null, dct = null;
  function setup(SR) {
    const mel = f => 2595 * Math.log10(1 + f / 700), inv = m => 700 * (Math.pow(10, m / 2595) - 1);
    const lo = mel(80), hi = mel(Math.min(7600, SR / 2 - 100));
    const pts = Array.from({ length: NMEL + 2 }, (_, i) => Math.floor((N + 1) * inv(lo + (hi - lo) * i / (NMEL + 1)) / SR));
    melBank = [];
    for (let m = 1; m <= NMEL; m++) {
      const w = new Float32Array(N / 2 + 1);
      for (let k = pts[m - 1]; k < pts[m]; k++) w[k] = (k - pts[m - 1]) / Math.max(1, pts[m] - pts[m - 1]);
      for (let k = pts[m]; k <= pts[m + 1]; k++) w[k] = (pts[m + 1] - k) / Math.max(1, pts[m + 1] - pts[m]);
      melBank.push(w);
    }
    dct = Array.from({ length: NCEP }, (_, c) => Float32Array.from({ length: NMEL }, (_, m) => Math.cos(Math.PI * c * (m + 0.5) / NMEL)));
  }
  // 한 구간의 프레임마다 [에너지, MFCC 0..12, 높낮이(Hz, 없으면 0)]
  function frames(pcm, a, b, SR) {
    const out = [], re = new Float32Array(N), im = new Float32Array(N), lm = new Float32Array(NMEL);
    for (let st = a; st + N <= b; st += HOP) {
      let en = 0;
      for (let i = 0; i < N; i++) { const v = pcm[st + i]; en += v * v; re[i] = v * hann[i]; im[i] = 0; }
      en = Math.log(en / N + 1e-10);
      fft(re, im);
      for (let m = 0; m < NMEL; m++) { const w = melBank[m]; let s = 0; for (let k = 0; k <= N / 2; k++) if (w[k]) s += w[k] * (re[k] * re[k] + im[k] * im[k]); lm[m] = Math.log(s + 1e-10); }
      const cep = dct.map(row => { let s = 0; for (let m = 0; m < NMEL; m++) s += row[m] * lm[m]; return s; });
      out.push({ en, cep, st });
    }
    return out;
  }
  // 높낮이: 자기상관(80~400Hz)
  function pitch(pcm, st, SR) {
    const L = 640; if (st + L + 200 > pcm.length) return 0;
    const minLag = Math.floor(SR / 400), maxLag = Math.floor(SR / 80);
    let e0 = 0; for (let i = 0; i < L; i++) e0 += pcm[st + i] * pcm[st + i];
    if (e0 <= 0) return 0;
    let best = 0, bl = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0, e1 = 0; for (let i = 0; i < L; i++) { s += pcm[st + i] * pcm[st + i + lag]; e1 += pcm[st + i + lag] * pcm[st + i + lag]; }
      const r = s / Math.sqrt(e0 * e1 + 1e-12); if (r > best) { best = r; bl = lag; }
    }
    return best > 0.5 ? SR / bl : 0;
  }
  // 문장 하나의 목소리 특징(소리가 큰 프레임만)
  function feature(pcm, s, e, SR) {
    const a = Math.max(0, Math.floor(s * SR)), b = Math.min(pcm.length, Math.floor(e * SR));
    if (b - a < N * 4) return null;
    const fr = frames(pcm, a, b, SR);
    if (fr.length < 6) return null;
    const ens = fr.map(f => f.en).sort((x, y) => x - y), top = ens[ens.length - 1];
    const thr = Math.max(ens[Math.floor(ens.length * 0.4)], top - 4);
    const vf = fr.filter(f => f.en >= thr);
    if (vf.length < 4) return null;
    const mean = new Array(NCEP).fill(0), sd = new Array(NCEP).fill(0);
    vf.forEach(f => f.cep.forEach((v, c) => { mean[c] += v / vf.length; }));
    vf.forEach(f => f.cep.forEach((v, c) => { sd[c] += (v - mean[c]) ** 2 / vf.length; }));
    const ps = vf.filter((_, i) => i % 3 === 0).map(f => pitch(pcm, f.st, SR)).filter(Boolean).sort((x, y) => x - y);
    const f0 = ps.length >= 3 ? Math.log(ps[Math.floor(ps.length / 2)]) : null;
    return { v: mean.slice(1).concat(sd.slice(1).map(Math.sqrt), [mean[0] / NCEP]), f0, n: vf.length };
  }
  function kmeans(X, w, seed) {
    let rnd = seed; const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    const d2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; };
    let c0 = X[Math.floor(rand() * X.length)];
    const dist = X.map(x => d2(x, c0)), tot = dist.reduce((a, b) => a + b, 0);
    let r = rand() * tot, k = 0; while (k < X.length - 1 && (r -= dist[k]) > 0) k++;
    let C = [c0.slice(), X[k].slice()], lab = new Array(X.length).fill(0);
    for (let it = 0; it < 30; it++) {
      let moved = false;
      X.forEach((x, i) => { const l = d2(x, C[0]) <= d2(x, C[1]) ? 0 : 1; if (l !== lab[i]) { lab[i] = l; moved = true; } });
      C = [0, 1].map(c => { const m = new Array(X[0].length).fill(0); let n = 0; X.forEach((x, i) => { if (lab[i] === c) { n += w[i]; x.forEach((v, j) => { m[j] += v * w[i]; }); } }); return n ? m.map(v => v / n) : C[c]; });
      if (!moved && it) break;
    }
    let wss = 0; X.forEach((x, i) => { wss += w[i] * d2(x, C[lab[i]]); });
    return { C, lab, wss };
  }
  function speakers(sents, pcm, SR) {
    if (!melBank) setup(SR);
    const F = sents.map(x => feature(pcm, x.s, x.e, SR));
    const idx = F.map((f, i) => (f ? i : -1)).filter(i => i >= 0);
    const labels = sents.map(x => x.sp);
    if (idx.length < 12) return { ok: false, why: 'few', labels };
    // 특징마다 고르게(평균 0, 흩어짐 1) — 높낮이는 없는 문장은 평균으로
    const f0s = idx.map(i => F[i].f0).filter(v => v != null), f0m = f0s.length ? f0s.reduce((a, b) => a + b, 0) / f0s.length : 0;
    const raw = idx.map(i => F[i].v.concat([F[i].f0 == null ? f0m : F[i].f0]));
    const D = raw[0].length, mu = new Array(D).fill(0), sg = new Array(D).fill(0);
    raw.forEach(x => x.forEach((v, j) => { mu[j] += v / raw.length; }));
    raw.forEach(x => x.forEach((v, j) => { sg[j] += (v - mu[j]) ** 2 / raw.length; }));
    const X = raw.map(x => x.map((v, j) => (v - mu[j]) / (Math.sqrt(sg[j]) || 1)));
    const w = idx.map(i => Math.min(3, 0.5 + F[i].n / 60));   // 긴 문장일수록 더 믿어요
    let best = null;
    for (let s = 1; s <= 12; s++) { const r = kmeans(X, w, s * 7919); if (!best || r.wss < best.wss) best = r; }
    // 얼마나 또렷하게 나뉘었나: 묶음 사이 거리 ÷ 묶음 안 흩어짐
    const d2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; };
    const n1 = best.lab.filter(l => l === 1).length, n0 = best.lab.length - n1;
    const within = Math.sqrt(best.wss / w.reduce((a, b) => a + b, 0));
    const sep = Math.sqrt(d2(best.C[0], best.C[1])) / (within || 1);
    const minor = Math.min(n0, n1) / best.lab.length;
    // 어느 묶음이 선생님인가: 글로 정한 사람이 선생님인 비율이 더 높은 쪽(같으면 문장이 더 많은 쪽)
    // 글로 정한 사람이 거의 다 같으면(예전 영상처럼 모두 선생님) 질문(?)이 많은 쪽 · 문장이 많은 쪽을 선생님으로
    const rate = (c, f) => { const m = idx.filter((_, k) => best.lab[k] === c); return m.length ? m.filter(f).length / m.length : 0; };
    const score = c => rate(c, i => sents[i].sp === 'T') + 0.5 * rate(c, i => /\?\s*$/.test(sents[i].en || '')) + 0.2 * (c ? n1 : n0) / best.lab.length;
    const tc = score(0) >= score(1) ? 0 : 1;
    if (sep < 0.8 || minor < 0.08) return { ok: false, why: 'unclear', sep: +sep.toFixed(2), minor: +minor.toFixed(2), labels };
    let changed = 0; const margins = sents.map(() => null);
    idx.forEach((i, k) => {
      const x = X[k], dT = Math.sqrt(d2(x, best.C[tc])), dS = Math.sqrt(d2(x, best.C[1 - tc]));
      const margin = Math.abs(dT - dS) / (dT + dS); margins[i] = +margin.toFixed(3);
      // 목소리가 어느 쪽인지 또렷한 문장만 바꿔요(애매하면 글로 정한 사람)
      if (margin < 0.04 && (sents[i].sp === 'T' || sents[i].sp === 'S')) return;
      const sp = dT < dS ? 'T' : 'S';
      if (labels[i] !== sp) changed++;
      labels[i] = sp;
    });
    // 소리가 너무 짧아 특징을 못 뽑은 문장: 글로 정한 사람(없으면 앞 문장)
    labels.forEach((l, i) => { if (l !== 'T' && l !== 'S') labels[i] = (labels[i - 1] === 'S' ? 'S' : 'T'); });
    return { ok: true, sep: +sep.toFixed(2), minor: +minor.toFixed(2), changed, labels, margins, need: +Math.min(0.25, Math.max(0.1, 0.1 + (1.2 - sep) * 0.35)).toFixed(3) };
  }
  window.LessonVoice = { speakers, feature, setup };
})();
