/**
 * UI 组件：歌单底部弹窗（替代原选歌抽屉/列表页）
 *
 * 动效（参考网易云/iOS 原生 sheet）：
 *  打开：遮罩 0→1 淡入（280ms），面板自底部升起，cubic-bezier(.32,.72,0,1) 420ms（类弹簧、无回弹）；
 *  关闭：更快（260ms），同曲线反向；
 *  手势：按住顶部把手/头部向下拖动 1:1 跟手，超过 25% 高度或快速下甩即关闭，否则回弹；
 *  遮罩点击 / Esc 关闭。
 * 内容：当前歌曲头部、4 个快捷操作、搜索、全部本地歌曲（正在播放显示跳动的均衡器条）。
 */
import { ICONS, MODE_LABEL, FALLBACK_COVER } from './icons.mjs';
import { formatTime } from '../util/format.mjs';

const OPEN_MS = 420;
const CLOSE_MS = 260;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function createSheet(engine, { onToggleLyrics, isLyricsOn }) {
  const app = document.getElementById('app');
  const sheet = document.getElementById('sheet');
  const scrim = document.getElementById('sheet-scrim');
  const grab = document.getElementById('sheet-grab');
  const head = document.getElementById('sheet-head');
  const list = document.getElementById('sheet-list');
  const empty = document.getElementById('sheet-empty');
  const search = document.getElementById('sheet-search');
  const cover = document.getElementById('sheet-cover');
  const titleEl = document.getElementById('sheet-title');
  const subEl = document.getElementById('sheet-sub');
  const countEl = document.getElementById('sheet-count');
  const modeIco = document.getElementById('sa-mode-ico');
  const modeLabel = document.getElementById('sa-mode-label');
  const lyricLabel = document.getElementById('sa-lyric-label');
  const openers = [document.getElementById('btn-sheet'), document.getElementById('now-playlist')];

  sheet.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon]; });
  openers[0].innerHTML = ICONS.library;

  let tracks = [];
  let isOpen = false;
  let lastFocus = null;

  /* ---------------- 列表 ---------------- */
  function renderList() {
    const q = search.value.trim().toLowerCase();
    const current = engine.getIndex();
    const rows = tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !q || [t.title, t.artist, t.album].some((v) => (v || '').toLowerCase().includes(q)));
    empty.hidden = rows.length > 0;
    list.innerHTML = rows.map(({ t, i }) => `
      <li class="song${i === current ? ' is-current' : ''}" role="option" aria-selected="${i === current}" data-index="${i}" tabindex="0">
        <span class="song-idx"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span></span>
        <span class="song-main">
          <span class="song-title">${escapeHtml(t.title)}</span>
          <span class="song-artist">${escapeHtml(t.artist)}${t.album ? ` · ${escapeHtml(t.album)}` : ''}</span>
        </span>
        <span class="song-time">${formatTime(t.duration)}</span>
      </li>`).join('');
    syncPlaying();
  }

  function syncPlaying() {
    list.classList.toggle('is-playing', engine.isPlaying());
  }

  function renderHead() {
    const t = tracks[engine.getIndex()];
    countEl.textContent = `共 ${tracks.length} 首`;
    if (!t) { titleEl.textContent = '本地歌单'; subEl.textContent = '\u00a0'; cover.innerHTML = FALLBACK_COVER; return; }
    titleEl.textContent = t.title;
    subEl.textContent = t.artist;
    cover.innerHTML = t.coverUrl ? `<img src="${t.coverUrl}" alt="">` : FALLBACK_COVER;
  }

  function renderMode() {
    const mode = engine.getMode();
    modeIco.innerHTML = ICONS.mode[mode];
    modeLabel.textContent = MODE_LABEL[mode];
  }

  /**
   * 定位当前：把正在播放的行滚到列表可视区正中（靠近两端时贴边）。
   * 注意不能用 el.offsetTop——它相对的是最近的定位祖先（整个弹窗），会把头部/快捷操作/搜索框的高度也算进去，
   * 导致多滚了约 3–4 行（v6 及之前的 bug）。这里用两者的 getBoundingClientRect 差值 + 当前 scrollTop，
   * 与 padding、弹窗的 transform、外层偏移都无关。
   */
  let scrollAnim = 0;
  function stopScrollAnim() { cancelAnimationFrame(scrollAnim); scrollAnim = 0; }
  function scrollListTo(top, ms) {
    stopScrollAnim();
    const from = list.scrollTop;
    if (!ms || Math.abs(top - from) < 1) { list.scrollTop = top; return; }
    const t0 = performance.now();
    const ease = (k) => 1 - (1 - k) ** 3;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      list.scrollTop = from + (top - from) * ease(k);
      scrollAnim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    scrollAnim = requestAnimationFrame(step);
  }
  // 用户自己滚动时立即让出控制权
  ['wheel', 'pointerdown', 'touchstart'].forEach((t) => list.addEventListener(t, stopScrollAnim, { passive: true }));

  function locateTarget(el) {
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const rowCenter = er.top - lr.top - list.clientTop + list.scrollTop + er.height / 2;
    const max = list.scrollHeight - list.clientHeight;
    return Math.max(0, Math.min(max, rowCenter - list.clientHeight / 2));
  }

  function locateCurrent(smooth = true, pulse = smooth) {
    const el = list.querySelector('.song.is-current');
    if (!el) return;
    const top = locateTarget(el);
    const dist = Math.abs(top - list.scrollTop);
    scrollListTo(top, smooth ? Math.min(560, 280 + dist * 0.25) : 0);
    if (pulse) {
      el.classList.remove('is-located');
      void el.offsetWidth;
      el.classList.add('is-located');
      el.addEventListener('animationend', () => el.classList.remove('is-located'), { once: true });
    }
  }

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.song');
    if (!row) return;
    const index = Number(row.dataset.index);
    close();
    // 立即切歌（声音不等弹窗收起）；弹窗收起与唱片滑动同时进行
    if (index === engine.getIndex()) { if (!engine.isPlaying()) engine.toggle(); return; }
    engine.playAt(index);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('song')) e.target.click();
  });
  search.addEventListener('input', renderList);

  document.getElementById('sa-playall').addEventListener('click', () => { close(); engine.playAt(0); });
  document.getElementById('sa-mode').addEventListener('click', () => engine.cycleMode());
  document.getElementById('sa-locate').addEventListener('click', () => {
    if (search.value) { search.value = ''; renderList(); }
    locateCurrent(true);
  });
  document.getElementById('sa-lyric').addEventListener('click', () => { onToggleLyrics(); renderLyricLabel(); });
  function renderLyricLabel() { lyricLabel.textContent = isLyricsOn() ? '隐藏歌词' : '显示歌词'; }

  /* ---------------- 开合 ---------------- */
  function setY(px, ms, ease = 'cubic-bezier(.32,.72,0,1)') {
    sheet.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    sheet.style.transform = px === null ? '' : `translate3d(-50%, ${px}px, 0)`;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    renderHead(); renderMode(); renderLyricLabel(); renderList();
    sheet.inert = false;
    sheet.setAttribute('aria-hidden', 'false');
    openers.forEach((b) => b.setAttribute('aria-expanded', 'true'));
    app.classList.add('sheet-open');
    sheet.style.transition = `transform ${OPEN_MS}ms cubic-bezier(.32,.72,0,1)`;
    sheet.style.transform = '';
    // 打开即自动定位到当前歌曲（等一帧布局完成；弹窗 transform 不影响相对位置）
    requestAnimationFrame(() => locateCurrent(false, false));
    setTimeout(() => { if (isOpen) sheet.focus({ preventScroll: true }); }, 50);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    sheet.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(.32,.72,0,1)`;
    sheet.style.transform = '';
    app.classList.remove('sheet-open');
    sheet.setAttribute('aria-hidden', 'true');
    openers.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    setTimeout(() => { if (!isOpen) sheet.inert = true; }, CLOSE_MS);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
  }

  openers.forEach((b) => b.addEventListener('click', () => (isOpen ? close() : open())));
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });
  sheet.tabIndex = -1;

  /* ---------------- 下拉关闭手势 ---------------- */
  let drag = null;
  function onDown(e) {
    if (e.button !== 0 || !isOpen) return;
    drag = { id: e.pointerId, y: e.clientY, dy: 0, samples: [{ t: e.timeStamp, y: e.clientY }], el: e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
    sheet.classList.add('is-dragging');
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    drag.dy = dy > 0 ? dy : dy / 6; // 向上拖有阻尼
    sheet.style.transition = 'none';
    sheet.style.transform = `translate3d(-50%, ${drag.dy}px, 0)`;
    scrim.style.opacity = String(Math.max(0, 1 - Math.max(0, drag.dy) / sheet.offsetHeight));
    drag.samples.push({ t: e.timeStamp, y: e.clientY });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { dy, samples } = drag;
    drag = null;
    sheet.classList.remove('is-dragging');
    scrim.style.opacity = '';
    const a = samples[0]; const b = samples[samples.length - 1];
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    if (dy > sheet.offsetHeight * 0.25 || (v > 0.5 && dy > 10)) {
      // 从当前位置继续向下收起
      sheet.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(.32,.72,0,1)`;
      requestAnimationFrame(() => close());
    } else {
      setY(0, 300);
      setTimeout(() => { if (isOpen && !drag) { sheet.style.transform = ''; } }, 310);
    }
  }
  [grab, head].forEach((el) => {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });

  /* ---------------- 引擎事件 ---------------- */
  engine.on('trackchange', () => { if (isOpen) { renderHead(); renderList(); } });
  engine.on('playstate', syncPlaying);
  engine.on('modechange', renderMode);

  return {
    setTracks(list_) { tracks = list_; countEl.textContent = `共 ${tracks.length} 首`; },
    locateCurrent,
    open, close, isOpen: () => isOpen,
  };
}
