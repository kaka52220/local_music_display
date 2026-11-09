/**
 * UI 组件：布局样式（经典 / 分栏）+ 右上角布局选择弹窗 + 分栏布局下的唱片下方信息区
 *
 * - 经典布局（classic）：唱片在左、信息+歌词在右、底部控制栏；
 * - 分栏布局（split）：对齐网易云平板端录屏——左侧唱片 + 歌名/歌手/喜欢 + 进度条 + 播放控制，
 *   右侧只有歌词（上方署名信息）。
 * 同一套 DOM：切换时把控制按钮组与进度条节点在底栏/左侧信息区之间移动，事件绑定保持不变。
 * 选择写入 localStorage；切换时优先用 View Transitions 做交叉淡入，不支持时退化为淡入淡出。
 */
import { ICONS } from './icons.mjs';
import { formatTime } from '../util/format.mjs';
import { swapIn } from './nowPlaying.mjs';

const LAYOUT_KEY = 'local-player/layout/v1';
const LIKES_KEY = 'local-player/likes/v1';
const LAYOUTS = ['classic', 'split'];

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储不可用时静默 */ }
}

export function createLayout(engine, { toggleLyrics, isLyricsOn }) {
  const app = document.getElementById('app');
  const btn = document.getElementById('btn-layout');
  const pop = document.getElementById('layout-pop');
  const scrim = document.getElementById('lp-scrim');
  const opts = [...pop.querySelectorAll('.lp-opt')];

  const transport = document.getElementById('transport');
  const barCenterHome = transport.parentElement;
  const barCenterNext = transport.nextElementSibling;
  const slider = document.getElementById('now-slider');
  const sliderHome = slider.parentElement;
  const dockTransport = document.getElementById('dock-transport');
  const dockSlider = document.getElementById('dock-slider');
  const dockTitle = document.getElementById('dock-title');
  const dockArtist = document.getElementById('dock-artist');
  const dockCur = document.getElementById('dock-cur');
  const dockTotal = document.getElementById('dock-total');
  const dockMeta = document.querySelector('.dock-meta');
  const credits = document.getElementById('credits');
  const likeBtn = document.getElementById('btn-like');
  const dockLyric = document.getElementById('btn-dock-lyric');

  btn.innerHTML = ICONS.layout;
  dockLyric.innerHTML = ICONS.lyric;

  /* ---------------- 应用布局 ---------------- */
  let layout = readJSON(LAYOUT_KEY, 'classic');
  if (!LAYOUTS.includes(layout)) layout = 'classic';

  function place(name) {
    app.dataset.layout = name;
    if (name === 'split') {
      dockTransport.appendChild(transport);
      dockSlider.appendChild(slider);
    } else {
      barCenterHome.insertBefore(transport, barCenterNext);
      sliderHome.appendChild(slider);
    }
    opts.forEach((o) => o.setAttribute('aria-checked', String(o.dataset.layout === name)));
  }

  function setLayout(name) {
    if (name === layout || !LAYOUTS.includes(name)) return;
    layout = name;
    writeJSON(LAYOUT_KEY, name);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduce) {
      document.startViewTransition(() => place(name));
    } else {
      app.classList.add('is-relayout');
      setTimeout(() => { place(name); requestAnimationFrame(() => app.classList.remove('is-relayout')); }, 160);
    }
  }
  place(layout);

  /* ---------------- 选择弹窗 ---------------- */
  let open = false;
  function setOpen(v) {
    open = v;
    app.classList.toggle('lp-open', v);
    btn.setAttribute('aria-expanded', String(v));
    pop.setAttribute('aria-hidden', String(!v));
    pop.inert = !v;
    if (v) requestAnimationFrame(() => (pop.querySelector('[aria-checked="true"]') || opts[0]).focus({ preventScroll: true }));
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  scrim.addEventListener('pointerdown', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const i = opts.indexOf(document.activeElement);
      if (i >= 0) opts[(i + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length].focus();
    }
  });
  opts.forEach((o) => o.addEventListener('click', () => {
    const name = o.dataset.layout;
    opts.forEach((x) => x.setAttribute('aria-checked', String(x === o)));
    // 先让选中态动一下，再关闭并切换
    setTimeout(() => { setOpen(false); setLayout(name); }, 170);
  }));

  /* ---------------- 分栏：歌曲信息 / 喜欢 / 署名 / 时间 ---------------- */
  const likes = new Set(readJSON(LIKES_KEY, []));
  let current = null;
  function renderLike(pop = false) {
    const on = !!current && likes.has(current.id);
    likeBtn.innerHTML = on ? ICONS.heartOn : ICONS.heart;
    likeBtn.classList.toggle('is-liked', on);
    likeBtn.setAttribute('aria-pressed', String(on));
    likeBtn.title = on ? '取消喜欢' : '喜欢';
    if (pop && on) { likeBtn.classList.remove('is-pop'); void likeBtn.offsetWidth; likeBtn.classList.add('is-pop'); }
  }
  likeBtn.addEventListener('click', () => {
    if (!current) return;
    if (likes.has(current.id)) likes.delete(current.id); else likes.add(current.id);
    writeJSON(LIKES_KEY, [...likes]);
    renderLike(true);
  });

  function renderLyricBtn() { dockLyric.classList.toggle('is-off', !isLyricsOn()); }
  dockLyric.addEventListener('click', () => { toggleLyrics(); renderLyricBtn(); });
  document.getElementById('btn-lyric')?.addEventListener('click', () => setTimeout(renderLyricBtn));
  document.getElementById('sa-lyric')?.addEventListener('click', () => setTimeout(renderLyricBtn));

  function renderCredits(track) {
    credits.replaceChildren();
    [['歌手', track.artist], ['专辑', track.album || '未知专辑'], ['来源', '本地音乐']].forEach(([k, v]) => {
      const row = document.createElement('p');
      row.className = 'credit';
      const label = document.createElement('span');
      label.textContent = `${k}：`;
      const val = document.createElement('b');
      val.textContent = v || '未知';
      row.append(label, val);
      credits.appendChild(row);
    });
  }

  engine.on('trackchange', ({ track }) => {
    current = track;
    // 当帧更新文字 + 短淡入，不延迟
    dockTitle.textContent = track.title;
    dockTitle.title = track.title;
    dockArtist.textContent = track.artist || '未知歌手';
    renderCredits(track);
    renderLike();
    dockTotal.textContent = formatTime(track.duration);
    dockCur.textContent = '00:00';
    swapIn(dockMeta);
    swapIn(credits);
  });

  let scrubbing = false;
  slider.addEventListener('input', () => {
    scrubbing = true;
    const d = engine.getDuration() || 0;
    if (d) { lastCur = ''; dockCur.textContent = formatTime((Number(slider.value) / Number(slider.max)) * d); }
  });
  slider.addEventListener('change', () => { scrubbing = false; });
  let lastCur = '';
  let lastTotal = '';
  engine.on('timeupdate', ({ currentTime, duration }) => {
    if (scrubbing) return;
    const c = formatTime(currentTime);
    if (c !== lastCur) { dockCur.textContent = c; lastCur = c; }
    if (duration) { const t = formatTime(duration); if (t !== lastTotal) { dockTotal.textContent = t; lastTotal = t; } }
  });

  renderLyricBtn();
  return { getLayout: () => layout, setLayout, isOpen: () => open, close: () => setOpen(false) };
}
