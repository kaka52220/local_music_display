/**
 * UI 组件：歌词（同步高亮 + 拖动定位）
 *
 * - 当前行高亮，自动滚动停在视区 40% 的"焦点线"；
 * - 用户滚轮/拖动/触摸滑动歌词 → 进入"定位模式"：
 *     焦点线处的行左侧显示时间，先出现细引导线，滚动停下后过渡为圆角半透明高亮行，
 *     右侧出现"点击从这里播放 ▶"胶囊；点击胶囊或该行即从此处播放；
 *   3 秒无操作淡出，并平滑回到当前播放行。
 * - 切歌：旧歌词淡出 → "歌词加载中..." → 新歌词淡入。
 *
 * 滚动（v6）：不再用原生 scrollTop。歌词容器 overflow:hidden，内层用 translate3d 位移（合成层，GPU 友好）：
 *  - 换行/拖动进度条定位后，用 ease-out 补间（约 450ms）平滑滚到新行，被打断时从当前位置/速度接着走；
 *  - 滚轮、触摸、鼠标拖动 1:1 跟手，松手带惯性，停稳后吸附到焦点线。
 */
import { fetchLyrics } from '../api/client.mjs';
import { formatTime } from '../util/format.mjs';
import { buildTiming, measure, fillAt } from './karaoke.mjs';

// 焦点线位于歌词视区高度的比例：经典布局 0.4；分栏布局由 CSS 变量 --lyric-focus 设为 0.5（正中）
const DEFAULT_FOCUS = 0.4;
let FOCUS = DEFAULT_FOCUS;
const IDLE_EXIT_MS = 3000;
const SETTLE_MS = 160;
const LINE_SCROLL_MS = 450;   // 自动换行 / 定位后滚到新行
const SNAP_MS = 280;          // 拖动停稳后吸附
const FLING_TAU = 325;        // 惯性衰减时间常数（ms）
const easeOutCubic = (k) => 1 - (1 - k) ** 3;

export function createLyricsView(engine) {
  const wrap = document.getElementById('lyrics-wrap');
  const box = document.getElementById('lyrics-box');
  const inner = document.getElementById('lyrics-inner');
  const scrub = document.getElementById('scrub');
  const scrubTime = document.getElementById('scrub-time');
  const scrubPlay = document.getElementById('scrub-play');

  let lines = [];          // { time, text, el }
  let synced = false;
  let activeIndex = -1;
  let scrubbing = false;
  let target = null;       // 定位模式下焦点线上的行
  let idleTimer = 0;
  let settleTimer = 0;
  let renderToken = 0;

  /* ---------------- 变换滚动：y = 内容向上偏移量（px） ---------------- */
  let y = 0;
  let anim = null;          // { kind:'tween', from, to, t0, dur } | { kind:'fling', v, t }
  let animRaf = 0;
  const yLog = [];          // 调试：[t, y]
  const maxY = () => Math.max(0, inner.offsetHeight - box.clientHeight);
  const clampY = (v) => Math.min(maxY(), Math.max(0, v));
  function setY(v) {
    y = v;
    inner.style.transform = `translate3d(0, ${(-v).toFixed(2)}px, 0)`;
    if (scrubbing) placeScrub();
    if (window.__lyricLog) { yLog.push([Math.round(performance.now()), +v.toFixed(1)]); if (yLog.length > 600) yLog.shift(); }
  }
  function stopAnim() { anim = null; cancelAnimationFrame(animRaf); animRaf = 0; }
  function tweenTo(to, ms, onDone) {
    to = clampY(to);
    if (!ms || Math.abs(to - y) < 0.5) { stopAnim(); setY(to); onDone?.(); return; }
    anim = { kind: 'tween', from: y, to, t0: performance.now(), dur: ms, onDone };
    if (!animRaf) animRaf = requestAnimationFrame(step);
  }
  function fling(v) { // v: px/ms，正值 = 向下滚（内容上移）
    anim = { kind: 'fling', v, t: performance.now() };
    if (!animRaf) animRaf = requestAnimationFrame(step);
  }
  function step(now) {
    animRaf = 0;
    if (!anim) return;
    if (anim.kind === 'tween') {
      const k = Math.min(1, (now - anim.t0) / anim.dur);
      setY(anim.from + (anim.to - anim.from) * easeOutCubic(k));
      if (k >= 1) { const done = anim.onDone; anim = null; done?.(); return; }
    } else {
      const dt = Math.min(50, now - anim.t);
      anim.t = now;
      anim.v *= Math.exp(-dt / FLING_TAU);
      const next = clampY(y + anim.v * dt);
      const hitEdge = next !== y + anim.v * dt;
      setY(next);
      if (Math.abs(anim.v) < 0.02 || hitEdge) { anim = null; scheduleSettle(); return; }
    }
    animRaf = requestAnimationFrame(step);
  }
  if (new URLSearchParams(location.search).has('lyriclog')) window.__lyricLog = yLog;

  /* ---------------- 渲染 ---------------- */
  function readFocus() {
    const v = parseFloat(getComputedStyle(box).getPropertyValue('--lyric-focus'));
    FOCUS = v > 0 && v < 1 ? v : DEFAULT_FOCUS;
  }

  function updateEdgePadding() {
    readFocus();
    const h = box.clientHeight;
    if (!h) return false;
    inner.style.paddingTop = `${h * FOCUS}px`;
    inner.style.paddingBottom = `${h * (1 - FOCUS)}px`;
    return true;
  }

  function setPlaceholder(text) {
    lines = []; synced = false; activeIndex = -1;
    box.classList.remove('synced');
    inner.innerHTML = `<div class="lyric-empty">${text}</div>`;
    inner.style.paddingTop = '0px';
    inner.style.paddingBottom = '0px';
    stopAnim(); setY(0);
  }

  async function render(track) {
    const token = ++renderToken;
    exitScrub(false);
    inner.classList.add('is-fading');
    await wait(180);
    if (token !== renderToken) return;
    setPlaceholder('歌词加载中...');
    inner.classList.remove('is-fading');

    let data = null;
    try { data = await fetchLyrics(track.id); } catch { data = null; }
    if (token !== renderToken) return;
    if (!data || !data.lines.length) { swapIn(() => setPlaceholder('纯音乐，请欣赏')); return; }

    swapIn(() => {
      synced = data.synced;
      box.classList.toggle('synced', synced);
      inner.innerHTML = '';
      lines = data.lines.map((line) => {
        const el = document.createElement('div');
        el.className = 'lyric-line';
        if (!line.text) el.classList.add('is-gap');
        const text = document.createElement('span');
        text.className = 'lyric-text';
        const kara = document.createElement('span'); // 行内元素：逐字填充的渐变跨视觉行连续
        kara.className = 'kara';
        kara.textContent = line.text;
        text.appendChild(kara);
        el.appendChild(text);
        inner.appendChild(el);
        return { ...line, el, kara, timing: null, geo: null, fill: -1 };
      });
      if (synced) {
        lines.forEach((l, i) => {
          const next = lines.slice(i + 1).find((n) => n.time > l.time);
          if (l.text) l.timing = buildTiming(l, next ? next.time : NaN);
        });
      }
      activeIndex = -1;
      if (updateEdgePadding()) {
        const t = engine.getCurrentTime();
        if (synced && t > 0) sync(t, false);
        else scrollToLine(lines[0].el, false);
      }
    });
  }

  // 淡出占位 → 替换内容 → 淡入
  async function swapIn(apply) {
    const token = renderToken;
    inner.classList.add('is-fading');
    await wait(160);
    if (token !== renderToken) return;
    apply();
    requestAnimationFrame(() => inner.classList.remove('is-fading'));
  }

  /* ---------------- 同步与滚动 ---------------- */
  const lineY = (el) => el.offsetTop + el.offsetHeight / 2 - box.clientHeight * FOCUS;
  function scrollToLine(el, smooth) {
    tweenTo(lineY(el), smooth ? LINE_SCROLL_MS : 0);
  }

  function sync(currentTime, smooth = true) {
    if (!synced || !lines.length) return;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= currentTime + 0.15) idx = i;
      else break;
    }
    while (idx > 0 && !lines[idx].text) idx--;
    if (idx !== activeIndex) {
      const prev = lines[activeIndex];
      if (prev) {
        prev.el.classList.remove('active');
        // 向后走：上一行保持全亮，随 --lit 过渡慢慢褪成灰色；向前跳（拖回去）：清空
        setFill(prev, idx > activeIndex && prev.geo ? prev.geo.total + 40 : 0);
      }
      activeIndex = idx;
      lines[idx]?.el.classList.add('active');
      if (!scrubbing) scrollToLine((lines[idx] || lines[0]).el, smooth);
    }
    updateFill(currentTime);
  }

  /* ---------------- 逐字高亮 ---------------- */
  function setFill(line, px) {
    if (!line || Math.abs(px - line.fill) < 0.25) return;
    line.fill = px;
    line.kara.style.setProperty('--fill', `${px.toFixed(1)}px`);
  }
  function updateFill(t) {
    const line = lines[activeIndex];
    if (!line?.timing) return;
    if (!line.geo) line.geo = measure(line.kara, line.timing);
    setFill(line, fillAt(line.timing, line.geo.geo, t));
  }

  /* ---------------- 定位模式 ---------------- */
  function nearestLine() {
    const focusY = y + box.clientHeight * FOCUS;
    let best = null; let bestD = Infinity;
    for (const line of lines) {
      if (!line.text) continue;
      const c = line.el.offsetTop + line.el.offsetHeight / 2;
      const d = Math.abs(c - focusY);
      if (d < bestD) { bestD = d; best = line; }
    }
    return best;
  }

  function placeScrub() {
    const next = nearestLine();
    if (!next) return;
    if (next !== target) {
      target?.el.classList.remove('is-target');
      target = next;
      target.el.classList.add('is-target');
      scrubTime.textContent = formatTime(target.time);
    }
    const h = target.el.offsetHeight;
    scrub.style.setProperty('--row-h', `${h}px`);
    scrub.style.top = `${box.offsetTop + box.clientHeight * FOCUS}px`;
  }

  /** 用户滚动（滚轮/拖动/惯性）停下后：把焦点行吸附到焦点线，引导线过渡为高亮行 */
  function markMoving() {
    wrap.classList.add('scrub-moving');
    wrap.classList.remove('scrub-settled');
    clearTimeout(settleTimer);
  }
  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (!scrubbing || !target || drag || anim?.kind === 'fling') return;
      tweenTo(lineY(target.el), SNAP_MS);
      wrap.classList.remove('scrub-moving');
      wrap.classList.add('scrub-settled');
    }, SETTLE_MS);
  }

  function enterScrub() {
    if (!synced || !lines.length) return false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => exitScrub(true), IDLE_EXIT_MS);
    markMoving();
    if (!scrubbing) {
      scrubbing = true;
      placeScrub();
      scrub.setAttribute('aria-hidden', 'false');
      scrubPlay.tabIndex = 0;
      requestAnimationFrame(() => wrap.classList.add('scrub-on'));
    }
    return true;
  }

  function exitScrub(returnToCurrent) {
    clearTimeout(idleTimer); clearTimeout(settleTimer);
    if (!scrubbing) return;
    scrubbing = false;
    wrap.classList.remove('scrub-on', 'scrub-moving', 'scrub-settled');
    scrub.setAttribute('aria-hidden', 'true');
    scrubPlay.tabIndex = -1;
    target?.el.classList.remove('is-target');
    target = null;
    if (returnToCurrent) {
      const anchor = lines[activeIndex >= 0 ? activeIndex : 0];
      if (anchor) setTimeout(() => scrollToLine(anchor.el, true), 120);
    }
  }

  function seekTo(line) {
    if (!line) return;
    engine.seek(line.time);
    if (!engine.isPlaying()) engine.toggle();
    exitScrub(false);
    activeIndex = -2; // 强制下一次 sync 重新定位
    lines.forEach((l) => l.el.classList.remove('active'));
    sync(line.time + 0.01, true);
  }

  // 滚轮：1:1 位移，停下后吸附
  box.addEventListener('wheel', (e) => {
    if (!enterScrub()) return;
    e.preventDefault();
    stopAnim();
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? box.clientHeight : 1;
    setY(clampY(y + e.deltaY * unit));
    scheduleSettle();
  }, { passive: false });

  // 触摸 / 鼠标拖动：1:1 跟手，松手带惯性；轻点不算拖动
  let drag = null;
  let suppressClick = false;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { y0: e.clientY, top: y, moved: false, id: e.pointerId, samples: [[e.timeStamp, e.clientY]] };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) < 5) return;
      if (!enterScrub()) { drag = null; return; }
      drag.moved = true;
      drag.y0 = e.clientY; drag.top = y; // 从当前位置（可能在补间中）无缝接管
      stopAnim();
      try { box.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      box.classList.add('is-grabbing');
    }
    markMoving();
    let ny = drag.top - (e.clientY - drag.y0);
    const m = maxY();
    if (ny < 0) ny *= 0.35; else if (ny > m) ny = m + (ny - m) * 0.35; // 越界阻尼
    setY(ny);
    drag.samples.push([e.timeStamp, e.clientY]);
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0][0] > 90) drag.samples.shift();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, samples } = drag;
    drag = null;
    box.classList.remove('is-grabbing');
    if (!moved) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => exitScrub(true), IDLE_EXIT_MS);
    const [t0, y0] = samples[0];
    const [t1, y1] = samples[samples.length - 1];
    const v = t1 > t0 ? -(y1 - y0) / (t1 - t0) : 0;
    if (y < 0 || y > maxY()) { tweenTo(clampY(y), SNAP_MS, scheduleSettle); return; }
    if (Math.abs(v) > 0.15) fling(v); else scheduleSettle();
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  // 定位模式下点击某一行：从该行播放
  inner.addEventListener('click', (e) => {
    if (suppressClick || !scrubbing) return;
    const el = e.target.closest('.lyric-line');
    const line = lines.find((l) => l.el === el);
    if (line && line.text) seekTo(line);
  });
  scrubPlay.addEventListener('click', (e) => { e.stopPropagation(); seekTo(target); });

  new ResizeObserver(() => {
    lines.forEach((l) => { l.geo = null; });
    if (!lines.length || !updateEdgePadding()) return;
    if (scrubbing) { placeScrub(); return; }
    const anchor = lines[activeIndex >= 0 ? activeIndex : 0];
    if (anchor) scrollToLine(anchor.el, false);
  }).observe(box);

  engine.on('timeupdate', ({ currentTime }) => sync(currentTime));

  return { render, isScrubbing: () => scrubbing };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
