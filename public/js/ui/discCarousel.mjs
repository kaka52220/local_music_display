/**
 * UI 组件：黑胶唱片轮播 + 唱臂（对齐网易云平板端录屏，v4）
 *
 * 结构：
 *  .disc-base   —— 浅色半透明底座圆环，固定不动（切歌时只有唱片在滑）；
 *  .disc-slot×3 —— 三张唱片（上一首 / 当前 / 下一首），各自独立 transform + opacity；
 *  .tonearm     —— 唱臂，只与"播放状态"有关，与切歌动画解耦。
 *
 * 运动模型：一个连续量 p（单位 = 一个唱片间距），槽位 r 的唱片显示在 (r + p) × 间距处。
 *  - 切歌（按钮/歌单/自动下一首/甩动松手）一律先"换角色"：把显示新歌的唱片设为中心，p += dir，
 *    再让 p 回到 0。所以任何时刻中心唱片 = 引擎当前曲目，快速连点只是不断叠加 p，永远不会错乱。
 *  - p → 0 用临界阻尼弹簧的解析解推进（只改 transform/opacity，rAF 驱动）：
 *    叠加位移时同时给一个 -ω·dir 的初速度，使整体轨迹恰好是指数衰减 = 起步快、平滑减速的 ease-out；
 *    被打断时保留当前速度，轨迹连续无顿挫；拖动松手时继承手指速度。
 *
 * 唱臂（对齐录屏）：播放中切歌唱臂不抬起；只有暂停，或者新歌还没真正出声（加载/起播前）时才抬起，
 *  音频 playing 事件到达后落下。切歌时给 1.5s 宽限，本地文件加载通常远小于此，因此播放中切歌唱臂不动。
 */
import { FALLBACK_COVER } from './icons.mjs';

const PITCH = 1.1;          // 相邻唱片中心距 / 底座直径
const OMEGA = 13;           // 弹簧角频率（1/s）：约 380ms 走完 99%
const ARM_DROP_MS = 560;
const ARM_LIFT_MS = 420;
const SWITCH_GRACE_MS = 1500;
// 旋转（v6）：rAF 推进角度，角速度带缓动——暂停时像真唱机一样减速停下，继续时平滑起转（不再切换 animation-play-state 造成瞬停/瞬起）
const SPIN_DEG_PER_S = 360 / 24; // 24s 一圈
const SPIN_UP_MS = 520;
const SPIN_DOWN_MS = 820;
const easeInOutSine = (k) => 0.5 - Math.cos(Math.PI * k) / 2;
const easeOutQuad = (k) => 1 - (1 - k) * (1 - k);
// 调试：?slowmo=8 让切换动画放慢 8 倍，便于逐帧检查
const SLOWMO = Math.max(1, Number(new URLSearchParams(location.search).get('slowmo')) || 1);

function slotMarkup() {
  return `
    <div class="disc-shadow"></div>
    <div class="disc"><div class="disc-grooves"></div><div class="disc-cover"></div><div class="disc-label-ring"></div></div>
    <div class="disc-sheen"></div>`;
}

export function createDiscCarousel(engine) {
  const stage = document.getElementById('disc-stage');
  const arm = document.getElementById('tonearm');
  const els = [...stage.querySelectorAll('.disc-slot')];
  els.forEach((el) => { el.innerHTML = slotMarkup(); });
  // 角色 → 元素（-1 上一首，0 当前，1 下一首）
  const roles = new Map([[-1, els[0]], [0, els[1]], [1, els[2]]]);
  const idxOf = new Map(); // 元素 → 曲目索引

  let p = 0;
  let v = 0;
  let raf = 0;
  let lastT = 0;
  let pitch = 0;
  let hintDir = 0;
  let dragging = false;

  const queueLen = () => engine.getQueue().length;
  const measure = () => { pitch = stage.offsetWidth * PITCH; };
  measure();
  new ResizeObserver(() => { measure(); render(); }).observe(stage);

  /* ---------------- 渲染 ---------------- */
  function setCover(el, index) {
    idxOf.set(el, index);
    const cover = el.querySelector('.disc-cover');
    const t = engine.getQueue()[index];
    if (!t || !t.coverUrl) { cover.innerHTML = FALLBACK_COVER; return; }
    const cur = cover.querySelector('img');
    if (cur && cur.dataset.src === t.coverUrl) return;
    const img = new Image();
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.dataset.src = t.coverUrl;
    img.src = t.coverUrl;
    cover.replaceChildren(img);
  }

  function render() {
    for (const [r, el] of roles) {
      const d = r + p;
      const ad = Math.abs(d);
      const o = Math.max(0, Math.min(1, 1 - (ad - 0.3) / 0.7));
      el.style.transform = `translate3d(${(d * pitch).toFixed(2)}px,0,0)`;
      el.style.opacity = o.toFixed(3);
      el.style.visibility = o > 0.001 ? 'visible' : 'hidden';
    }
  }

  function fillNeighbors() {
    if (!queueLen()) return;
    setCover(roles.get(1), engine.peekNext());
    setCover(roles.get(-1), engine.peekPrev());
  }

  function restartSpin(el) {
    const disc = el.querySelector('.disc');
    disc.style.animation = 'none';
    void disc.offsetWidth; // 新唱片从 0° 开始转
    disc.style.animation = '';
  }

  /** 把 dir 方向的唱片设为中心（若它显示的不是 index，先换封面） */
  function rotate(dir, index) {
    const incoming = roles.get(dir);
    if (idxOf.get(incoming) !== index) { setCover(incoming, index); restartSpin(incoming); }
    const outgoing = roles.get(0);
    const recycled = roles.get(-dir);
    roles.set(0, incoming);
    roles.set(-dir, outgoing);
    roles.set(dir, recycled);
    restartSpin(recycled);
    p += dir;
    if (dragging) baseP += dir; // 拖动中被动切歌（如自动下一首）：手指基准同步平移
    if (Math.abs(p) > 2) p = Math.sign(p) * 2;
  }

  /* ---------------- 弹簧动画 ---------------- */
  function tick(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000) / SLOWMO; // 解析解，大步长也稳定
    lastT = t;
    const e = Math.exp(-OMEGA * dt);
    const k = v + OMEGA * p;
    const np = (p + k * dt) * e;
    v = (v - OMEGA * k * dt) * e;
    p = np;
    if (Math.abs(p) < 0.0015 && Math.abs(v) < 0.02) {
      p = 0; v = 0; raf = 0;
      render();
      stage.classList.remove('is-moving');
      fillNeighbors();
      return;
    }
    render();
    raf = requestAnimationFrame(tick);
  }

  function settle() {
    if (dragging) return;
    stage.classList.add('is-moving');
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function stopSpring() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------------- 切歌 ---------------- */
  let shownIndex = -1;
  engine.on('trackchange', ({ index }) => {
    const first = shownIndex < 0;
    const old = shownIndex;
    shownIndex = index;
    if (first || document.hidden || queueLen() < 2) {
      stopSpring(); p = 0; v = 0;
      setCover(roles.get(0), index);
      fillNeighbors(); render();
      return;
    }
    if (old === index && !hintDir) return;
    let dir = hintDir;
    hintDir = 0;
    if (!dir) {
      if (idxOf.get(roles.get(1)) === index) dir = 1;
      else if (idxOf.get(roles.get(-1)) === index) dir = -1;
      else dir = 1;
    }
    rotate(dir, index);
    // 叠加一段指数衰减的初速度 → 起步快、平滑减速
    v -= OMEGA * dir;
    render();
    settle();
  });

  engine.on('modechange', () => { if (!raf && !dragging && shownIndex >= 0) setCover(roles.get(1), engine.peekNext()); });

  // 按钮切歌前先告知方向（捕获阶段，早于 transport 的点击处理）
  const hint = (id, dir) => document.getElementById(id)?.addEventListener('click', () => { hintDir = dir; }, { capture: true });
  hint('now-next', 1);
  hint('now-prev', -1);

  /* ---------------- 唱臂 / 旋转 ---------------- */
  let grace = false;
  let graceTimer = 0;
  let armDown = false;
  let landTimer = 0;

  function setArm(down) {
    if (down === armDown) return;
    armDown = down;
    clearTimeout(landTimer);
    arm.style.transitionDuration = `${down ? ARM_DROP_MS : ARM_LIFT_MS}ms`;
    arm.classList.toggle('is-down', down);
    if (down) {
      // 唱针落稳后唱片才开始转（与录屏一致）
      landTimer = setTimeout(syncSpin, ARM_DROP_MS * 0.55);
    } else syncSpin();
  }

  // 角速度 ω ∈ [0,1]（1 = 正常转速），从当前值缓动到目标值；被打断时从此刻的 ω 接着走，速度曲线连续
  const angles = new WeakMap(); // .disc 元素 → 当前角度（每张唱片保留自己的角度）
  let omega = 0; let omegaFrom = 0; let omegaTo = 0; let rampT0 = 0; let rampDur = 0;
  let spinRaf = 0; let spinLast = 0;
  const spinLog = []; // 调试：最近的 [t, ω]
  function setSpin(on) {
    const to = on ? 1 : 0;
    if (to === omegaTo) return;
    omegaFrom = omega; omegaTo = to;
    rampT0 = performance.now();
    rampDur = (on ? SPIN_UP_MS : SPIN_DOWN_MS) * Math.abs(to - omegaFrom);
    stage.classList.toggle('is-spinning', on);
    if (!spinRaf) { spinLast = rampT0; spinRaf = requestAnimationFrame(spinFrame); }
  }
  function spinFrame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - spinLast) / 1000));
    spinLast = now;
    const k = rampDur ? Math.min(1, (now - rampT0) / rampDur) : 1;
    const ease = omegaTo > omegaFrom ? easeInOutSine : easeOutQuad;
    omega = omegaFrom + (omegaTo - omegaFrom) * ease(k);
    const disc = roles.get(0).querySelector('.disc');
    const a = ((angles.get(disc) || 0) + omega * SPIN_DEG_PER_S * dt) % 360;
    angles.set(disc, a);
    disc.style.transform = `rotate(${a.toFixed(3)}deg)`;
    spinLog.push([Math.round(now), +omega.toFixed(4)]);
    if (spinLog.length > 400) spinLog.shift();
    if (k >= 1 && omega === 0) { spinRaf = 0; return; }
    spinRaf = requestAnimationFrame(spinFrame);
  }
  if (new URLSearchParams(location.search).has('spinlog')) window.__spinLog = spinLog;

  function syncSpin() {
    const spinning = armDown && engine.isPlaying() && (engine.isAudible() || grace);
    setSpin(spinning);
  }

  function syncArm() {
    setArm(engine.isPlaying() && (engine.isAudible() || grace));
    if (armDown) syncSpin();
  }

  engine.on('playstate', syncArm);
  engine.on('audible', ({ audible }) => {
    if (audible) { grace = false; clearTimeout(graceTimer); }
    syncArm();
  });
  // 播放中切歌：给一段宽限期，期间即使新歌尚未出声唱臂也保持在唱片上
  engine.on('trackchange', () => {
    if (!armDown || !engine.isPlaying()) return;
    grace = true;
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => { grace = false; syncArm(); }, SWITCH_GRACE_MS);
  });

  /* ---------------- 拖动（1:1 跟手，松手继承速度） ---------------- */
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let baseP = 0;
  let samples = [];

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointerId !== null || queueLen() < 2) return;
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    dragging = false;
    samples = [{ t: e.timeStamp, x: e.clientX }];
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < 5) return;
      if (Math.abs(e.clientY - startY) > Math.abs(dx)) { release(e, true); return; }
      dragging = true;
      stopSpring();
      v = 0;
      baseP = p - dx / pitch; // 从当前位置（可能在动画中）无缝接管
      fillNeighbors();
      stage.classList.add('is-moving', 'is-dragging');
    }
    let np = baseP + dx / pitch;
    // 超出一个间距后加阻尼
    if (Math.abs(np) > 1) np = Math.sign(np) * (1 + (Math.abs(np) - 1) * 0.25);
    p = np;
    render();
    samples.push({ t: e.timeStamp, x: e.clientX });
    while (samples.length > 2 && e.timeStamp - samples[0].t > 90) samples.shift();
  });

  function release(e, cancelled = false) {
    if (e.pointerId !== pointerId) return;
    try { stage.releasePointerCapture(pointerId); } catch { /* ignore */ }
    pointerId = null;
    stage.classList.remove('is-dragging');
    if (!dragging) return;
    dragging = false;
    const a = samples[0];
    const b = samples[samples.length - 1];
    const vx = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms
    let dir = 0;
    if (!cancelled) {
      if (Math.abs(p) > 0.3) dir = p < 0 ? 1 : -1;
      else if (Math.abs(vx) > 0.4 && Math.abs(p) > 0.03 && Math.sign(vx) === Math.sign(p)) dir = p < 0 ? 1 : -1;
    }
    if (dir) {
      hintDir = dir;
      engine.playAt(idxOf.get(roles.get(dir)), true); // → trackchange → 换角色，p 跳到另一侧
    }
    // 纯指数衰减（临界阻尼下不过冲的最快 ease-out）
    v = -OMEGA * p;
    settle();
  }
  stage.addEventListener('pointerup', (e) => release(e));
  stage.addEventListener('pointercancel', (e) => release(e, true));
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  // 键盘：唱片区域聚焦时左右方向键切歌
  stage.tabIndex = 0;
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { hintDir = 1; engine.next(); }
    if (e.key === 'ArrowLeft') { hintDir = -1; engine.prev(); }
  });

  render();
  return { getShownIndex: () => shownIndex };
}
