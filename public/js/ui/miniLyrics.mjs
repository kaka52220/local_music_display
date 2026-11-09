/**
 * UI 组件：迷你歌词条（v9）+ 封面共享元素转场
 *
 * 迷你歌词条：整页收成一条居中的横向卡片——左侧小封面，中间一行大字逐字（卡拉 OK）歌词 + 下一句淡色预告，
 * 右侧播放/暂停、下一首、展开。卡片底色取封面氛围色；背景沿用当前背景样式（高斯模糊 / 流体）。
 * 进入/退出按钮：顶栏右侧"迷你歌词条"、卡片上的"展开"，Esc 也可退出；状态写入 localStorage。
 * 歌词与播放页共用同一份数据（lyricsView 载入后回调）和同一个歌词时钟（含延迟补偿与用户偏移）。
 *
 * 共享元素转场：唱片中心的封面 ⇄ 迷你条小封面"飞"过去（圆形 ⇄ 圆角方形、带唱片当前转角）。
 * 用自己的 FLIP（Web Animations）实现而不是 View Transitions：View Transitions 进行中再次触发只能跳到终点
 * 重新开始（skipTransition），没法从半路折返；这里飞行中再点一次，会从封面"此刻"的位置/大小/角度/圆角
 * 平滑折返。其余界面（舞台、底栏、卡片）用 CSS 过渡交叉淡入，本身就可随时反向。
 * 系统"减少动态效果"时不飞，直接淡入淡出。
 */
import { ICONS } from './icons.mjs';
import { bindTransport } from './transport.mjs';
import { buildTiming, measure, fillAt, fillPast } from './karaoke.mjs';

const KEY = 'local-player/mini/v1';
const FLY_MS = 520;
const SPIN_DEG_PER_S = 360 / 24; // 与 discCarousel 的转速一致
const EASE = 'cubic-bezier(.3, .9, .25, 1)';
const FALLBACK_COVER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="rgba(255,255,255,.55)" d="M12 3v10.55A4 4 0 1014 17V7h4V3z"/></svg>`;

export function createMiniLyrics(engine, clock, { onToggle } = {}) {
  const app = document.getElementById('app');
  const root = document.getElementById('mini');
  const coverBox = document.getElementById('mini-cover');
  const linesBox = document.getElementById('mini-lines');
  const nextEl = document.getElementById('mini-next');
  const metaEl = document.getElementById('mini-meta');
  const btnEnter = document.getElementById('btn-mini');
  const btnExit = document.getElementById('mini-exit');
  const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)');

  btnEnter.innerHTML = ICONS.mini;
  btnExit.innerHTML = ICONS.expand;
  bindTransport(engine, { play: root.querySelector('#mini-play'), next: root.querySelector('#mini-nextbtn') });

  /* ---------------- 曲目信息 / 封面 ---------------- */
  let track = null;
  engine.on('trackchange', ({ track: t }) => {
    track = t;
    metaEl.textContent = `${t.title} - ${t.artist || '未知歌手'}`;
    if (t.coverUrl) {
      const img = coverBox.querySelector('img');
      if (!img || img.dataset.src !== t.coverUrl) {
        const n = new Image();
        n.alt = ''; n.draggable = false; n.decoding = 'async';
        n.dataset.src = t.coverUrl; n.src = t.coverUrl;
        coverBox.replaceChildren(n);
      }
    } else coverBox.innerHTML = FALLBACK_COVER;
    setLines(null);
  });

  /* ---------------- 歌词：当前句（逐字）+ 下一句 ---------------- */
  let lines = [];     // { time, text, timing }
  let synced = false;
  let idx = -2;
  let cur = null;     // { kara, timing, geo, fill }

  function setLines(data) {
    synced = !!data?.synced;
    root.classList.toggle('is-synced', synced);
    lines = (data?.lines || []).filter((l) => l.text);
    if (synced) {
      lines.forEach((l, i) => { const n = lines[i + 1]; l.timing = buildTiming(l, n ? n.time : NaN); });
    }
    idx = -2;
    update(true);
  }

  function showLine(text, timing, nextText, animate) {
    const p = document.createElement('p');
    p.className = 'mini-line';
    const kara = document.createElement('span');
    kara.className = 'kara';
    kara.textContent = text;
    p.appendChild(kara);
    const olds = [...linesBox.children];
    linesBox.appendChild(p);
    cur = { kara, timing, geo: null, fill: -1 };
    if (!timing) kara.style.setProperty('--fill', '100000px');
    if (animate && !reduceMq.matches && olds.length) {
      p.classList.add('is-in');
      olds.forEach((o) => { o.classList.add('is-out'); setTimeout(() => o.remove(), 450); });
      requestAnimationFrame(() => requestAnimationFrame(() => p.classList.remove('is-in')));
    } else olds.forEach((o) => o.remove());
    if (nextEl.textContent !== (nextText || '\u00a0')) {
      nextEl.classList.remove('swap'); void nextEl.offsetWidth; nextEl.classList.add('swap');
      nextEl.textContent = nextText || '\u00a0';
    }
  }

  function update(force = false) {
    if (!synced) {
      if (idx !== -1 || force) {
        idx = -1;
        // 没有时间轴：显示第一句（或纯音乐提示），下一句显示第二句
        showLine(lines[0]?.text || (track ? '纯音乐，请欣赏' : '未在播放'), null, lines[1]?.text || '', !force);
      }
      return;
    }
    const t = clock.now();
    let i = -1;
    for (let k = 0; k < lines.length; k++) { if (lines[k].time <= t) i = k; else break; }
    if (i !== idx || force) {
      idx = i;
      if (i < 0) showLine(track?.title || '', null, lines[0]?.text || '', !force);
      else showLine(lines[i].text, lines[i].timing, lines[i + 1]?.text || '', !force);
    }
    if (cur?.timing && open) {
      if (!cur.geo) cur.geo = measure(cur.kara, cur.timing);
      const px = fillAt(cur.timing, cur.geo.geo, t) + fillPast(cur.timing, cur.geo, t);
      if (Math.abs(px - cur.fill) >= 0.25) { cur.fill = px; cur.kara.style.setProperty('--fill', `${px.toFixed(1)}px`); }
    }
  }

  engine.on('timeupdate', () => { if (open) update(); });
  clock.onChange(() => { if (open) update(); });
  new ResizeObserver(() => { if (cur) cur.geo = null; if (open) update(); }).observe(linesBox);

  /* ---------------- 封面飞行（FLIP，可中途折返） ---------------- */
  let fly = null; // { el, anim, toMini }

  /** 当前唱片封面的几何：中心、直径、转角（唱片旋转时外接矩形会变大，所以不用旋转元素自身的 rect） */
  function discGeom() {
    const slots = [...document.querySelectorAll('.disc-slot')];
    // 当前唱片 = 最靠近舞台中心、未透明的那张
    const stage = document.getElementById('disc-stage').getBoundingClientRect();
    let best = null; let bestD = Infinity;
    for (const s of slots) {
      const r = s.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - (stage.left + stage.width / 2));
      if (d < bestD && getComputedStyle(s).opacity !== '0') { bestD = d; best = s; }
    }
    if (!best) return null;
    const cover = best.querySelector('.disc-cover');
    const disc = best.querySelector('.disc');
    const r = best.getBoundingClientRect();
    const scale = r.width / (best.offsetWidth || 1);
    // 封面中心 = 唱片中心（旋转不改变中心）
    const dr = disc.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(disc).transform === 'none' ? undefined : getComputedStyle(disc).transform);
    const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    const size = cover.offsetWidth * scale;
    return { el: cover, cx: dr.left + dr.width / 2, cy: dr.top + dr.height / 2, size, radius: size / 2, angle };
  }
  function miniGeom() {
    const r = coverBox.getBoundingClientRect();
    return { el: coverBox, cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width, radius: parseFloat(getComputedStyle(coverBox).borderTopLeftRadius) || 0, angle: 0 };
  }

  function coverMarkup() {
    return track?.coverUrl ? `<img src="${track.coverUrl}" alt="" draggable="false">` : FALLBACK_COVER;
  }

  /** 读飞行元素此刻的视觉状态（中途折返用）：中心、视觉尺寸、转角、视觉圆角 */
  function liveGeom(el) {
    const cs = getComputedStyle(el);
    const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
    const box = el.offsetWidth;
    const s = Math.hypot(m.a, m.b);
    const left = parseFloat(cs.left); const top = parseFloat(cs.top);
    return {
      cx: left + box / 2 + m.e, cy: top + box / 2 + m.f, size: box * s,
      angle: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      radius: (parseFloat(cs.borderTopLeftRadius) || 0) * s, // 圆角始终用 px 动画，读出来就是 px
    };
  }

  function flyCover(toMini, from) {
    const dst = toMini ? miniGeom() : discGeom();
    if (!dst || !from || dst.size < 4 || from.size < 4) { cleanupFly(); return; }
    let el = fly?.el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'cover-fly';
      el.innerHTML = coverMarkup();
      document.body.appendChild(el);
    }
    fly?.anim.cancel();
    // 盒子放在终点（终点尺寸），用 transform 从起点"反推"过来：只动合成层属性
    el.style.width = el.style.height = `${dst.size}px`;
    el.style.left = `${dst.cx - dst.size / 2}px`;
    el.style.top = `${dst.cy - dst.size / 2}px`;
    const s0 = from.size / dst.size;
    // 唱片继续转：落回唱片时预估飞行结束时它转到的角度
    let endAngle = dst.angle;
    if (!toMini && engine.isPlaying()) endAngle += (FLY_MS / 1000) * SPIN_DEG_PER_S;
    // 圆角（视觉 px）换算到终点盒子的坐标：起点 ÷ 起始缩放
    const r0 = `${(from.radius / s0).toFixed(2)}px`;
    const r1 = `${dst.radius.toFixed(2)}px`;
    const anim = el.animate([
      { transform: `translate(${from.cx - dst.cx}px, ${from.cy - dst.cy}px) scale(${s0}) rotate(${from.angle}deg)`, borderRadius: r0 },
      { transform: `translate(0px, 0px) scale(1) rotate(${endAngle}deg)`, borderRadius: r1 },
    ], { duration: FLY_MS, easing: EASE, fill: 'forwards' });
    // 起点 / 终点的真封面在飞行期间隐藏
    document.querySelectorAll('.disc-cover.is-flying').forEach((c) => c.classList.remove('is-flying'));
    (toMini ? discGeom() : dst)?.el.classList.add('is-flying');
    coverBox.classList.add('is-flying');
    fly = { el, anim, toMini };
    anim.onfinish = () => { if (fly?.anim === anim) cleanupFly(); };
  }

  function cleanupFly() {
    fly?.anim.cancel();
    fly?.el.remove();
    fly = null;
    document.querySelectorAll('.is-flying').forEach((c) => c.classList.remove('is-flying'));
  }

  /* ---------------- 进入 / 退出 ---------------- */
  let open = false;
  function setOpen(v, { animate = true, persist = true } = {}) {
    if (v === open) return;
    const motion = animate && !reduceMq.matches;
    // 起点：飞行中 → 飞行元素此刻的样子；否则 → 起点封面
    let from = null;
    if (motion) {
      if (fly) from = liveGeom(fly.el);
      else from = v ? discGeom() : miniGeom();
    }
    open = v;
    app.classList.toggle('is-mini', v);
    root.setAttribute('aria-hidden', String(!v));
    root.inert = !v;
    btnEnter.setAttribute('aria-pressed', String(v));
    if (persist) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } }
    if (v) { idx = -2; update(true); }
    if (motion) flyCover(v, from); else cleanupFly();
    onToggle?.(v);
    (v ? btnExit : btnEnter).focus({ preventScroll: true });
  }

  btnEnter.addEventListener('click', () => setOpen(true));
  btnExit.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape' && !document.querySelector('.app.sheet-open, .app.sleep-open, .app.lp-open')) { e.preventDefault(); setOpen(false); }
  });

  let saved = false;
  try { saved = JSON.parse(localStorage.getItem(KEY)) === true; } catch { /* ignore */ }
  if (saved) setOpen(true, { animate: false, persist: false });

  return {
    setLyrics(t, data) { if (t === track || t?.id === track?.id) setLines(data); },
    isOpen: () => open,
    setOpen,
  };
}
