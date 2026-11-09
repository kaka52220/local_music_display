/**
 * UI 组件：歌词（同步高亮 + 拖动定位）
 *
 * - 当前行高亮，自动滚动停在视区 40% 的"焦点线"；
 * - 用户滚轮/拖动/触摸滑动歌词 → 进入"定位模式"：
 *     焦点线处的行左侧显示时间，先出现细引导线，滚动停下后过渡为圆角半透明高亮行，
 *     右侧出现"点击从这里播放 ▶"胶囊；点击胶囊或该行即从此处播放；
 *   3 秒无操作淡出，并平滑回到当前播放行。
 * - 切歌：旧歌词淡出 → "歌词加载中..." → 新歌词淡入。
 */
import { fetchLyrics } from '../api/client.mjs';
import { formatTime } from '../util/format.mjs';

const FOCUS = 0.4;        // 焦点线位于歌词视区高度的比例
const IDLE_EXIT_MS = 3000;
const SETTLE_MS = 160;

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
  let programmatic = false; // 程序触发的滚动（不视为用户操作）
  let programmaticTimer = 0;
  let snapping = false;     // 停稳后吸附滚动中（不回到"滚动中"状态）
  let snapTimer = 0;
  let renderToken = 0;

  /* ---------------- 渲染 ---------------- */
  function updateEdgePadding() {
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
    box.scrollTop = 0;
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
        text.textContent = line.text;
        el.appendChild(text);
        inner.appendChild(el);
        return { ...line, el };
      });
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
  function scrollToLine(el, smooth) {
    const top = el.offsetTop + el.offsetHeight / 2 - box.clientHeight * FOCUS;
    programmatic = true;
    clearTimeout(programmaticTimer);
    programmaticTimer = setTimeout(() => { programmatic = false; }, smooth ? 700 : 60);
    box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  function sync(currentTime, smooth = true) {
    if (!synced || !lines.length) return;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= currentTime + 0.15) idx = i;
      else break;
    }
    while (idx > 0 && !lines[idx].text) idx--;
    if (idx === activeIndex) return;
    lines[activeIndex]?.el.classList.remove('active');
    activeIndex = idx;
    lines[idx]?.el.classList.add('active');
    if (!scrubbing) scrollToLine((lines[idx] || lines[0]).el, smooth);
  }

  /* ---------------- 定位模式 ---------------- */
  function nearestLine() {
    const focusY = box.scrollTop + box.clientHeight * FOCUS;
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

  function enterScrub() {
    if (!synced || !lines.length) return;
    snapping = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => exitScrub(true), IDLE_EXIT_MS);
    wrap.classList.add('scrub-moving');
    wrap.classList.remove('scrub-settled');
    if (!scrubbing) {
      scrubbing = true;
      placeScrub();
      scrub.setAttribute('aria-hidden', 'false');
      scrubPlay.tabIndex = 0;
      requestAnimationFrame(() => wrap.classList.add('scrub-on'));
    }
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

  box.addEventListener('scroll', () => {
    if (programmatic && !scrubbing) return;
    if (!scrubbing) return;
    if (snapping) return;
    placeScrub();
    wrap.classList.add('scrub-moving');
    wrap.classList.remove('scrub-settled');
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      // 停稳：把焦点行吸附到焦点线，引导线过渡为高亮行
      if (!scrubbing || !target) return;
      const top = target.el.offsetTop + target.el.offsetHeight / 2 - box.clientHeight * FOCUS;
      if (Math.abs(box.scrollTop - top) > 1) {
        snapping = true;
        clearTimeout(snapTimer);
        snapTimer = setTimeout(() => { snapping = false; }, 450);
        box.scrollTo({ top, behavior: 'smooth' });
      }
      wrap.classList.remove('scrub-moving');
      wrap.classList.add('scrub-settled');
    }, SETTLE_MS);
  }, { passive: true });

  box.addEventListener('wheel', () => enterScrub(), { passive: true });
  box.addEventListener('touchmove', () => enterScrub(), { passive: true });

  // 鼠标按住拖动歌词（桌面端），轻点不算拖动
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { y: e.clientY, top: box.scrollTop, moved: false, id: e.pointerId };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 4) return;
    if (!drag.moved) { drag.moved = true; box.setPointerCapture(e.pointerId); box.classList.add('is-grabbing'); }
    enterScrub();
    box.scrollTop = drag.top - dy;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved } = drag;
    drag = null;
    box.classList.remove('is-grabbing');
    if (moved) { e.preventDefault(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
  };
  let suppressClick = false;
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
    if (!lines.length || !updateEdgePadding()) return;
    if (scrubbing) { placeScrub(); return; }
    const anchor = lines[activeIndex >= 0 ? activeIndex : 0];
    if (anchor) scrollToLine(anchor.el, false);
  }).observe(box);

  engine.on('timeupdate', ({ currentTime }) => sync(currentTime));

  return { render, isScrubbing: () => scrubbing };
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
