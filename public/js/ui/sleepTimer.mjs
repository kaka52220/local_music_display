/**
 * UI 组件：定时关闭（睡眠定时）
 *
 * - 触发按钮：时钟图标 + 「定时」；开启后文字变成实时倒计时（mm:ss），两种布局各放一个（分栏：喜欢旁；经典：底栏右侧）。
 * - 底部弹窗：标题「定时关闭」/ 开启后实时「mm:ss后自动停止播放」+ 关闭按钮；
 *   中间一条连续滑轨 0–90 分钟（刻度 关 / 30 / 60 / 90），胶囊拇指 1:1 跟手、内显整数分钟；
 *   轻点轨道远处时拇指以指数缓动"滑"过去，追上手指后转为 1:1 跟随；经过刻度时拇指轻弹 + 短振动（支持时）。
 *   下方「播完本首后关闭」圆形勾选：开启后倒计时 = 本首剩余时长（拖动进度会跟着变），本首播完即停。
 * - 到点：用 Web Audio 增益在约 4 秒内缓缓淡出再暂停（唱臂随播放状态抬起）；暂停状态下到点则直接结束定时。
 * - 定时状态写入 localStorage，刷新页面后继续倒计时。
 */
import { ICONS } from './icons.mjs';

const MAX = 90;
const MARKS = [0, 30, 60, 90];
const FADE_MS = 4000;
const STORE_KEY = 'local-player/sleep/v1';
const GLIDE_TAU = 55; // 拇指追赶手指的指数缓动时间常数（ms）

const pad2 = (n) => String(n).padStart(2, '0');
/** 剩余秒数 → mm:ss（分钟可超过 59，如 90:00） */
export function formatCountdown(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}
function save(v) {
  try { if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v)); else localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

export function createSleepTimer(engine) {
  const app = document.getElementById('app');
  const sheet = document.getElementById('sleep-sheet');
  const scrim = document.getElementById('sl-scrim');
  const title = document.getElementById('sl-title');
  const closeBtn = document.getElementById('sl-close');
  const track = document.getElementById('sl-track');
  const fill = document.getElementById('sl-fill');
  const thumb = document.getElementById('sl-thumb');
  const pill = thumb.querySelector('.sl-pill');
  const num = document.getElementById('sl-num');
  const eotBtn = document.getElementById('sl-eot');
  const triggers = [...document.querySelectorAll('[data-sleep-trigger]')];

  closeBtn.innerHTML = ICONS.close;
  triggers.forEach((b) => {
    b.innerHTML = `<span class="sleep-ico">${ICONS.timer}</span><span class="sleep-label">定时</span>`;
    b.addEventListener('click', () => open(b));
  });
  const labels = triggers.map((b) => b.querySelector('.sleep-label'));

  /* ---------------- 定时状态 ---------------- */
  // mode: 'off' | 'timer'（deadline = 到点的时间戳 ms） | 'eot'（播完本首）
  let mode = 'off';
  let deadline = 0;
  let fading = false;
  let tick = 0;

  function remainingSec() {
    if (mode === 'timer') return (deadline - Date.now()) / 1000;
    if (mode === 'eot') return Math.max(0, (engine.getDuration() || 0) - (engine.getCurrentTime() || 0));
    return 0;
  }

  function startTimer(minutes) {
    mode = 'timer';
    deadline = Date.now() + minutes * 60000;
    fading = false;
    engine.setStopAfterCurrent(false);
    save({ mode, deadline });
    sync();
  }
  function startEot() {
    mode = 'eot';
    fading = false;
    engine.setStopAfterCurrent(true);
    save({ mode });
    sync();
  }
  function cancel() {
    mode = 'off';
    deadline = 0;
    fading = false;
    engine.setStopAfterCurrent(false);
    save(null);
    sync();
  }

  function onTick() {
    if (mode === 'timer') {
      const left = deadline - Date.now();
      if (left <= FADE_MS && !fading) {
        if (engine.isPlaying()) {
          fading = true;
          engine.sleepFade(Math.max(800, left)).then(() => { if (fading) cancel(); });
        } else if (left <= 0) {
          cancel(); // 到点时本来就没在放：结束定时即可
          return;
        }
      }
    }
    render();
  }
  engine.on('sleepstop', () => { if (mode !== 'off') cancel(); });
  // 淡出中用户自己暂停 / 继续 / 切歌：包络被接管，定时到此结束
  engine.on('playstate', ({ playing }) => { if (fading && !playing) cancel(); });

  function sync() {
    const on = mode !== 'off';
    clearInterval(tick);
    tick = on ? setInterval(onTick, 250) : 0;
    eotBtn.setAttribute('aria-checked', String(mode === 'eot'));
    triggers.forEach((b) => {
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-label', on ? `定时关闭：${formatCountdown(remainingSec())}后停止` : '定时关闭');
    });
    render(true);
  }

  /* ---------------- 文字：按钮倒计时 + 弹窗标题 ---------------- */
  let lastLabel = '';
  let lastTitle = '';
  let lastMin = -1;
  function render(force = false) {
    const on = mode !== 'off';
    const rem = remainingSec();
    const label = on ? formatCountdown(rem) : '定时';
    if (label !== lastLabel || force) {
      labels.forEach((l) => { l.textContent = label; });
      lastLabel = label;
    }
    if (!dragging) {
      const t = on ? `${formatCountdown(rem)}后自动停止播放` : '定时关闭';
      if (t !== lastTitle) { title.textContent = t; lastTitle = t; }
      title.classList.toggle('is-live', on);
      // 弹窗开着时，拇指跟着剩余分钟走（缓动滑过去）
      const m = on ? Math.min(MAX, Math.max(1, Math.ceil(rem / 60))) : 0;
      if (isOpen && (m !== lastMin || force)) glideTo(m);
      lastMin = m;
    }
  }

  /* ---------------- 滑轨几何 ---------------- */
  let geo = null; // { left, width, pad, tw }
  function measure() {
    const r = track.getBoundingClientRect();
    const cs = getComputedStyle(track);
    geo = { left: r.left, width: r.width, pad: parseFloat(cs.paddingLeft) || 0, tw: thumb.offsetWidth };
    return geo;
  }
  const usable = () => Math.max(1, geo.width - 2 * geo.pad - geo.tw);
  const posFromValue = (v) => geo.pad + geo.tw / 2 + (usable() * v) / MAX;      // 拇指中心 x（相对轨道）
  const valueFromPos = (x) => Math.min(MAX, Math.max(0, ((x - geo.pad - geo.tw / 2) / usable()) * MAX));

  /* ---------------- 拇指动画：pos 追 target（glide）或 1:1（follow） ---------------- */
  let pos = 0;
  let target = 0;
  let gliding = false;
  let raf = 0;
  let shown = -1;
  function paint() {
    thumb.style.transform = `translate3d(${(pos - geo.tw / 2).toFixed(2)}px,0,0)`;
    fill.style.width = `${(pos + geo.tw / 2).toFixed(2)}px`;
    const v = Math.round(valueFromPos(pos));
    if (v !== shown) {
      const prev = shown;
      shown = v;
      num.textContent = v === 0 ? '关' : String(v);
      fill.classList.toggle('is-zero', v === 0);
      track.setAttribute('aria-valuenow', String(v));
      track.setAttribute('aria-valuetext', v === 0 ? '关' : `${v} 分钟`);
      if (prev >= 0) {
        num.classList.remove('roll-up', 'roll-down');
        void num.offsetWidth;
        num.classList.add(v > prev ? 'roll-up' : 'roll-down');
        if (dragging && MARKS.some((m) => (prev < m && v >= m) || (prev > m && v <= m))) tickFeedback();
      }
      if (dragging) {
        // 拖动中标题实时预览
        const t = v === 0 ? '定时关闭' : `${pad2(v)}:00后自动停止播放`;
        if (t !== lastTitle) { title.textContent = t; lastTitle = t; }
        title.classList.toggle('is-live', v > 0);
      }
    }
  }
  function frame(now) {
    raf = 0;
    if (!gliding) return;
    const dt = Math.min(48, now - (frame.last || now));
    frame.last = now;
    const k = 1 - Math.exp(-dt / GLIDE_TAU);
    pos += (target - pos) * (dt ? k : 0.25);
    if (Math.abs(target - pos) < 0.4) { pos = target; gliding = false; }
    paint();
    if (gliding) raf = requestAnimationFrame(frame);
  }
  function glide(x) {
    target = x;
    if (!gliding) { gliding = true; frame.last = performance.now(); }
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function follow(x) {
    target = x;
    if (gliding) return; // 还在追赶：交给 glide 继续追
    pos = x;
    paint();
  }
  function glideTo(v) { if (geo) glide(posFromValue(v)); }

  function tickFeedback() {
    pill.classList.remove('is-tick');
    void pill.offsetWidth;
    pill.classList.add('is-tick');
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
  }

  /* ---------------- 拖动 / 点击轨道 ---------------- */
  let dragging = false;
  let pid = null;
  const xOf = (e) => e.clientX - geo.left;
  track.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    measure();
    dragging = true;
    pid = e.pointerId;
    track.setPointerCapture?.(e.pointerId);
    track.classList.add('is-pressing');
    const x = Math.min(posFromValue(MAX), Math.max(posFromValue(0), xOf(e)));
    // 按在拇指上：直接 1:1；按在远处：先滑过去再跟手
    if (Math.abs(x - pos) > geo.tw / 2) glide(x); else follow(x);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pid) return;
    follow(Math.min(posFromValue(MAX), Math.max(posFromValue(0), xOf(e))));
  });
  function release(e) {
    if (!dragging || (e && e.pointerId !== pid)) return;
    dragging = false;
    pid = null;
    track.classList.remove('is-pressing');
    const v = Math.round(valueFromPos(target));
    lastMin = v;
    glide(posFromValue(v)); // 吸附到整数分钟
    if (v === 0) cancel(); else startTimer(v);
  }
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  track.addEventListener('lostpointercapture', release);
  // 点「关」刻度也走同一路径（pointerdown 落在轨道上）；键盘：方向键 ±1，PageUp/Down ±10，Home/End
  track.addEventListener('keydown', (e) => {
    const cur = mode === 'off' ? 0 : Math.max(1, Math.ceil(remainingSec() / 60));
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    let v = null;
    if (step) v = Math.min(MAX, Math.max(0, cur + step));
    if (e.key === 'Home') v = 0;
    if (e.key === 'End') v = MAX;
    if (v === null) return;
    e.preventDefault();
    measure();
    if (v === 0) cancel(); else startTimer(v);
  });

  eotBtn.addEventListener('click', () => {
    if (mode === 'eot') cancel(); else startEot();
  });

  /* ---------------- 弹窗开关（打开 ~300ms 缓出上滑，关闭 ~200ms 缓入，遮罩同步） ---------------- */
  let isOpen = false;
  let opener = null;
  function open(from) {
    if (isOpen) return;
    isOpen = true;
    opener = from || null;
    app.classList.add('sleep-open');
    sheet.setAttribute('aria-hidden', 'false');
    sheet.inert = false;
    triggers.forEach((b) => b.setAttribute('aria-expanded', 'true'));
    measure();
    // 打开时拇指直接就位（不从 0 滑过来）
    const m = mode === 'off' ? 0 : Math.min(MAX, Math.max(1, Math.ceil(remainingSec() / 60)));
    gliding = false; pos = target = posFromValue(m); lastMin = m; paint();
    render(true);
    requestAnimationFrame(() => track.focus({ preventScroll: true }));
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    app.classList.remove('sleep-open');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.inert = true;
    triggers.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (opener && opener.offsetParent) opener.focus({ preventScroll: true });
  }
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('pointerdown', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) { e.stopPropagation(); close(); } });
  window.addEventListener('resize', () => { if (isOpen) { measure(); pos = target; paint(); } });

  /* ---------------- 恢复 ---------------- */
  const saved = load();
  if (saved?.mode === 'timer' && saved.deadline > Date.now() + 1000) { mode = 'timer'; deadline = saved.deadline; }
  else if (saved?.mode === 'eot') { mode = 'eot'; engine.setStopAfterCurrent(true); }
  else save(null);
  sync();

  return { open, close, isOpen: () => isOpen, getMode: () => mode, remaining: remainingSec, cancel, startTimer, startEot };
}
