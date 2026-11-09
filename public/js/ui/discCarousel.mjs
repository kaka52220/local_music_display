/**
 * UI 组件：黑胶唱片轮播（网易云平板端"拖动唱片切歌"）
 *
 * 交互时序（对齐录屏分析）：
 *  按下/开始拖动 → 旋转立即暂停，唱臂 ~130ms 抬起并保持；
 *  拖动 → 唱片 1:1 跟手，相邻唱片同尺寸同时可见（间距≈封面半径）；
 *  松手 → 超过阈值或快速甩动：~360ms ease-out 吸附到相邻唱片后才真正切歌；
 *          否则回弹居中；
 *  落定 → 唱臂 ~230ms 落下，落稳后（且正在播放）唱片才恢复旋转。
 * 其他途径切歌（上一首/下一首按钮、歌单点击、自动下一首）走同一套滑动动画。
 *
 * 只依赖引擎的公开接口（getQueue/getIndex/peekNext/peekPrev/playAt/isPlaying），不改引擎。
 */
import { FALLBACK_COVER } from './icons.mjs';

const PITCH = 1.317;        // 相邻唱片中心距 / 唱片直径（直径 + 封面半径）
const SNAP_MS = 360;
const BACK_MS = 300;
const LIFT_MS = 130;
const DROP_MS = 230;
const PLAY_DROP_MS = 520;   // 普通播放/暂停时唱臂起落
const EASE_OUT = 'cubic-bezier(.22,.61,.36,1)';

function slotMarkup() {
  return `
    <div class="disc-shadow"></div>
    <div class="disc-halo"></div>
    <div class="disc"><div class="disc-grooves"></div><div class="disc-cover"></div></div>
    <div class="disc-sheen"></div>`;
}

export function createDiscCarousel(engine) {
  const stage = document.getElementById('disc-stage');
  const track = document.getElementById('disc-track');
  const arm = document.getElementById('tonearm');
  const slots = new Map(
    [...track.querySelectorAll('.disc-slot')].map((el) => {
      el.innerHTML = slotMarkup();
      return [Number(el.dataset.slot), el];
    }),
  );
  const centerDisc = slots.get(0).querySelector('.disc');

  let shownIndex = -1;     // 中间唱片当前展示的曲目
  let x = 0;               // 轨道位移（px）
  let phase = 'idle';      // idle | drag | anim
  let armLifted = false;   // 被拖动/切歌强制抬起
  let armDown = false;     // 唱臂已落在唱片上
  let internal = false;    // 本次 trackchange 由轮播自身发起
  let hintDir = 0;         // 按钮切歌时预告方向
  let timers = [];

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const pitchPx = () => stage.offsetWidth * PITCH;
  const queueLen = () => engine.getQueue().length;

  /* ---------------- 渲染 ---------------- */
  function setCover(slot, index) {
    const cover = slots.get(slot).querySelector('.disc-cover');
    const t = engine.getQueue()[index];
    slots.get(slot).dataset.index = String(index);
    if (!t || !t.coverUrl) { cover.innerHTML = FALLBACK_COVER; return; }
    const cur = cover.querySelector('img');
    if (cur && cur.dataset.src === t.coverUrl) return;
    const img = new Image();
    img.alt = '';
    img.draggable = false;
    img.dataset.src = t.coverUrl;
    img.src = t.coverUrl;
    cover.replaceChildren(img);
  }

  function renderAround(index) {
    shownIndex = index;
    setCover(0, index);
    if (!queueLen()) return;
    setCover(1, engine.peekNext());
    setCover(-1, engine.peekPrev());
  }

  function moveTo(px, ms = 0, ease = EASE_OUT) {
    x = px;
    track.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    track.style.transform = `translate3d(${px}px,0,0)`;
  }

  /* ---------------- 唱臂 / 旋转 ---------------- */
  function updateSpin() {
    const spinning = engine.isPlaying() && armDown && !armLifted && phase === 'idle';
    centerDisc.classList.toggle('is-spinning', spinning);
  }

  function setArm(down, ms) {
    arm.style.transitionDuration = `${ms}ms`;
    arm.classList.toggle('is-down', down);
    armDown = false;
    updateSpin();
    if (down) later(() => { armDown = true; updateSpin(); }, ms);
  }

  function liftArm() {
    armLifted = true;
    setArm(false, LIFT_MS);
  }

  function landArm() {
    armLifted = false;
    if (engine.isPlaying()) setArm(true, DROP_MS);
    else setArm(false, DROP_MS);
  }

  function restartSpin() {
    centerDisc.style.animation = 'none';
    void centerDisc.offsetWidth; // 重启动画，新唱片从 0° 开始转
    centerDisc.style.animation = '';
  }

  /* ---------------- 切换动画 ---------------- */
  function finishSwap(index) {
    renderAround(index);
    moveTo(0);
    restartSpin();
    stage.classList.remove('is-moving');
    phase = 'idle';
    later(landArm, 40);
  }

  /** 视觉上滑到相邻唱片（dir: +1 下一首 / -1 上一首），完成后回调 */
  function slide(dir, done) {
    phase = 'anim';
    stage.classList.add('is-moving');
    const remaining = Math.abs(-dir * pitchPx() - x) / pitchPx();
    const ms = Math.round(Math.max(220, SNAP_MS * Math.min(1, remaining + 0.15)));
    moveTo(-dir * pitchPx(), ms);
    later(done, ms + 10);
  }

  /** 引擎已切歌（按钮/歌单/自动下一首）：补一段同样的滑动动画 */
  function animateExternal(newIndex) {
    clearTimers();
    const old = shownIndex;
    if (old < 0 || old === newIndex || document.hidden) { finishSwap(newIndex); return; }
    const n = queueLen();
    let dir = hintDir;
    if (!dir) dir = newIndex === (old - 1 + n) % n && n > 2 ? -1 : 1;
    hintDir = 0;
    if (phase !== 'idle') { moveTo(0); }
    setCover(0, old);
    setCover(dir, newIndex);
    stage.classList.add('is-moving');
    phase = 'anim';
    liftArm();
    later(() => slide(dir, () => finishSwap(newIndex)), LIFT_MS * 0.6);
  }

  engine.on('trackchange', ({ index }) => {
    if (internal) { internal = false; finishSwap(index); return; }
    animateExternal(index);
  });

  engine.on('playstate', ({ playing }) => {
    if (armLifted || phase !== 'idle') { updateSpin(); return; }
    setArm(playing, PLAY_DROP_MS);
  });
  engine.on('modechange', () => { if (phase === 'idle' && shownIndex >= 0) setCover(1, engine.peekNext()); });

  // 按钮切歌前先告知方向（捕获阶段，早于 transport 的点击处理）
  document.getElementById('now-next')?.addEventListener('click', () => { hintDir = 1; }, { capture: true });
  document.getElementById('now-prev')?.addEventListener('click', () => { hintDir = -1; }, { capture: true });

  /* ---------------- 拖动 ---------------- */
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let dragging = false;
  let samples = [];

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointerId !== null || queueLen() < 1) return;
    if (phase === 'anim') return; // 动画中不接管，避免状态错乱
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    baseX = x;
    dragging = false;
    samples = [{ t: e.timeStamp, x: e.clientX }];
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < 4) return;
      if (Math.abs(e.clientY - startY) > Math.abs(dx)) { release(e, true); return; }
      dragging = true;
      clearTimers();
      phase = 'drag';
      stage.classList.add('is-moving', 'is-dragging');
      setCover(1, engine.peekNext());
      setCover(-1, engine.peekPrev());
      liftArm();
    }
    const p = pitchPx();
    moveTo(Math.max(-p, Math.min(p, baseX + dx)));
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
    const first = samples[0];
    const last = samples[samples.length - 1];
    const v = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px/ms
    const p = pitchPx();
    let dir = 0;
    if (!cancelled) {
      if (Math.abs(x) > p * 0.32) dir = x < 0 ? 1 : -1;
      else if (Math.abs(v) > 0.45 && Math.abs(x) > 12 && Math.sign(v) === Math.sign(x)) dir = x < 0 ? 1 : -1;
    }
    if (!dir) {
      phase = 'anim';
      moveTo(0, BACK_MS);
      later(() => { stage.classList.remove('is-moving'); phase = 'idle'; landArm(); }, BACK_MS + 10);
      return;
    }
    const target = dir > 0 ? engine.peekNext() : engine.peekPrev();
    slide(dir, () => {
      internal = true;
      engine.playAt(target, true);
    });
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

  return {
    /** 当前中间唱片的封面元素（供歌单头部等复用） */
    getShownIndex: () => shownIndex,
  };
}
