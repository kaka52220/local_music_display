/**
 * 背景样式（v9）：高斯模糊（原有）/ 流体（封面色网格渐变缓慢流动），右上角"播放页布局"弹窗里切换，记住选择。
 *
 * 流体的做法（低开销）：
 * - 只在一张很小的 canvas（约 72×44）上画 5 团封面取色的径向渐变，由 CSS 拉伸铺满全屏；
 *   浏览器双线性放大后本身就是柔和的网格渐变，不需要 blur 滤镜（滤镜每帧全屏模糊才是 GPU 大头）。
 * - 色团沿各自的李萨如曲线缓慢漂移（周期 23–41 秒），约 30fps 重画；颜色切歌时逐帧插值，约 1.2 秒交叉过渡。
 * - 页面隐藏、选了"高斯模糊"或系统"减少动态效果"时停帧（减少动态时只画静止画面，换歌时颜色仍平滑过渡）。
 */
const KEY = 'local-player/bg/v1';
const MODES = ['blur', 'fluid'];
const W = 72;
const FRAME_MS = 1000 / 30;
const COLOR_TAU = 0.45; // 颜色插值时间常数（秒）：约 1.2 秒基本到位

// 色团：位置 = 中心 + 振幅 × sin(2π t / 周期 + 相位)
const BLOBS = [
  { cx: 0.22, cy: 0.28, ax: 0.18, ay: 0.16, px: 31, py: 37, ph: 0.0, r: 0.75 },
  { cx: 0.78, cy: 0.25, ax: 0.16, ay: 0.2, px: 41, py: 29, ph: 1.7, r: 0.7 },
  { cx: 0.7, cy: 0.78, ax: 0.2, ay: 0.14, px: 27, py: 35, ph: 3.1, r: 0.8 },
  { cx: 0.25, cy: 0.76, ax: 0.17, ay: 0.18, px: 37, py: 23, ph: 4.4, r: 0.72 },
  { cx: 0.5, cy: 0.5, ax: 0.22, ay: 0.2, px: 33, py: 39, ph: 5.6, r: 0.55 },
];
const DEFAULT_PALETTE = [[74, 52, 66], [52, 46, 70], [86, 60, 58], [44, 52, 62], [64, 58, 72]];

/* ---------------- 取色 ---------------- */
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
/** 压到适合做深色背景的范围：亮度 0.16–0.34，饱和度 ≤ 0.6（白字歌词保持清晰） */
const tame = (rgb) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, Math.min(s, 0.6), Math.min(0.34, Math.max(0.16, l))]); };

/** 封面 → 5 个主色：按色相分 12 桶 × 明暗 2 档，按"像素数 ×（0.3 + 饱和度）"取前几桶的平均色 */
function extractPalette(img) {
  try {
    const size = 32;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const rgb = [data[i], data[i + 1], data[i + 2]];
      const [h, s, l] = rgbToHsl(rgb);
      const key = s < 0.12 ? `g${l < 0.5 ? 0 : 1}` : `${Math.floor(h * 12) % 12}-${l < 0.5 ? 0 : 1}`;
      const b = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, w: 0 };
      b.r += rgb[0]; b.g += rgb[1]; b.b += rgb[2]; b.n++; b.w += 0.3 + s;
      buckets.set(key, b);
    }
    const top = [...buckets.values()].sort((a, b) => b.w - a.w).slice(0, 5).map((b) => tame([b.r / b.n, b.g / b.n, b.b / b.n]));
    // 颜色不足 5 个（单色封面）：用已有颜色做明暗/色相微调补齐
    for (let i = 0; top.length < 5; i++) {
      const [h, s, l] = rgbToHsl(top[i % Math.max(1, top.length)] || DEFAULT_PALETTE[i]);
      top.push(hslToRgb([(h + 0.04 * (i + 1)) % 1, s, Math.min(0.34, Math.max(0.16, l + (i % 2 ? 0.07 : -0.05)))]));
    }
    return top;
  } catch {
    return DEFAULT_PALETTE;
  }
}

/* ---------------- 背景样式 + 流体渲染 ---------------- */
export function createBackgroundStyle() {
  const app = document.getElementById('app');
  const canvas = document.getElementById('bg-fluid');
  const opts = [...document.querySelectorAll('[data-bg-opt]')];
  const ctx = canvas.getContext('2d', { alpha: false });
  const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');

  let mode = 'blur';
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (MODES.includes(v)) mode = v; } catch { /* ignore */ }

  const cur = DEFAULT_PALETTE.map((c) => c.slice());
  let target = DEFAULT_PALETTE.map((c) => c.slice());
  let raf = 0;
  let clock = 0; // 动画时间（秒）

  function size() {
    const h = Math.max(24, Math.round(W * (innerHeight / Math.max(1, innerWidth))));
    if (canvas.width !== W || canvas.height !== h) { canvas.width = W; canvas.height = h; }
  }

  function draw() {
    const w = canvas.width; const h = canvas.height;
    const base = cur[0];
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgb(${base[0] * 0.55 | 0},${base[1] * 0.55 | 0},${base[2] * 0.55 | 0})`;
    ctx.fillRect(0, 0, w, h);
    const still = reduceMq.matches;
    BLOBS.forEach((b, i) => {
      const t = still ? 0 : clock;
      const x = (b.cx + b.ax * Math.sin((2 * Math.PI * t) / b.px + b.ph)) * w;
      const y = (b.cy + b.ay * Math.sin((2 * Math.PI * t) / b.py + b.ph * 1.3)) * h;
      const r = b.r * Math.max(w, h) * (1 + (still ? 0 : 0.08 * Math.sin((2 * Math.PI * t) / (b.px + 7))));
      const [cr, cg, cb] = cur[i];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},.95)`);
      g.addColorStop(0.55, `rgba(${cr | 0},${cg | 0},${cb | 0},.45)`);
      g.addColorStop(1, `rgba(${cr | 0},${cg | 0},${cb | 0},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  const colorsSettled = () => cur.every((c, i) => c.every((v, k) => Math.abs(v - target[i][k]) < 0.5));

  // 停帧（隐藏 / 切走）期间动画时间不走，恢复后从原位置继续
  let prevNow = 0;
  let acc = 0;
  function frame(now) {
    raf = 0;
    if (!active()) return;
    const dt = prevNow ? Math.min(0.1, (now - prevNow) / 1000) : FRAME_MS / 1000;
    prevNow = now;
    const still = reduceMq.matches;
    if (!still) clock += dt;
    acc += dt;
    if (acc * 1000 >= FRAME_MS - 2) { // 约 30fps
      const k = 1 - Math.exp(-acc / COLOR_TAU);
      acc = 0;
      cur.forEach((c, i) => c.forEach((v, j) => { c[j] = v + (target[i][j] - v) * k; }));
      draw();
    }
    if (still && colorsSettled()) return; // 减少动态：颜色过渡完就停帧
    raf = requestAnimationFrame(frame);
  }

  const active = () => mode === 'fluid' && !document.hidden;
  function start() {
    if (raf || !active()) return;
    size();
    prevNow = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function apply(name, persist) {
    mode = name;
    app.dataset.bg = name;
    opts.forEach((o) => o.setAttribute('aria-checked', String(o.dataset.bgOpt === name)));
    if (persist) { try { localStorage.setItem(KEY, JSON.stringify(name)); } catch { /* ignore */ } }
    if (active()) start(); else stop();
  }

  opts.forEach((o) => o.addEventListener('click', () => apply(o.dataset.bgOpt, true)));
  document.addEventListener('visibilitychange', () => { if (active()) start(); else stop(); });
  reduceMq.addEventListener?.('change', () => { if (active()) start(); });
  window.addEventListener('resize', () => { size(); if (mode === 'fluid' && !raf) draw(); });

  size();
  draw();
  apply(mode, false);

  return {
    /** 封面载入后调用：img 为空时回到默认色 */
    setCover(img) {
      target = img ? extractPalette(img) : DEFAULT_PALETTE.map((c) => c.slice());
      if (mode === 'fluid') start();
    },
  };
}
