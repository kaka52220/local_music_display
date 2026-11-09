/**
 * 播放控制绑定（适配器）
 * 把同一套引擎能力绑定到任意视图传入的元素上，避免重复编写逻辑。
 * refs: { play, prev?, next?, playlist?, mode?, slider?, cur?, total? }
 */
import { ICONS, MODE_LABEL } from './icons.mjs';
import { PLAY_MODE } from '../player/engine.mjs';
import { formatTime } from '../util/format.mjs';

export function bindTransport(engine, refs) {
  let duration = 0;
  const SCALE = Number(refs.slider?.max) || 1000; // 进度条精度（10000 → 拖动/逐帧移动足够细腻）
  let seeking = false;

  // 播放/暂停：两个图标叠放，切换时交叉淡变 + 缩放旋转（约 200ms），而不是瞬间替换
  refs.play.innerHTML = `<span class="pp"><span class="pp-i pp-play">${ICONS.play}</span><span class="pp-i pp-pause">${ICONS.pause}</span></span>`;
  refs.play.title = '播放';
  refs.play.addEventListener('click', () => engine.toggle());
  if (refs.prev) refs.prev.innerHTML = ICONS.prev;
  if (refs.next) refs.next.innerHTML = ICONS.next;
  if (refs.playlist) refs.playlist.innerHTML = ICONS.playlist;
  refs.prev?.addEventListener('click', () => engine.prev());
  refs.next?.addEventListener('click', () => engine.next());
  refs.mode?.addEventListener('click', () => engine.cycleMode());

  // 进度条：已播放 --p、已缓冲到 --b（0–100%），由 CSS 渐变绘制三段（已播放 / 已缓存 / 未加载）
  let buffered = [];
  let lastP = '';
  let lastB = '';
  function paintSlider() {
    if (!refs.slider) return;
    const p = `${(Number(refs.slider.value) / SCALE) * 100}%`;
    if (p !== lastP) { refs.slider.style.setProperty('--p', p); lastP = p; }
    paintBuffered();
  }
  function paintBuffered() {
    if (!refs.slider || !duration) return;
    const t = (Number(refs.slider.value) / SCALE) * duration;
    // 取包含当前播放位置的缓冲区间；没有则取起点之后最近的一段
    let end = 0;
    for (const [a, b] of buffered) { if (a <= t + 0.5 && b >= t) { end = b; break; } }
    const v = `${Math.min(100, (end / duration) * 100).toFixed(2)}%`;
    if (v !== lastB) { refs.slider.style.setProperty('--b', v); lastB = v; }
  }

  if (refs.slider) {
    // 按下/拖动进度条时拇指略微放大（触屏上 :active 不可靠，用类名）
    const press = (on) => refs.slider.classList.toggle('is-pressing', on);
    refs.slider.addEventListener('pointerdown', () => press(true));
    ['pointerup', 'pointercancel', 'change', 'blur'].forEach((t) => refs.slider.addEventListener(t, () => press(false)));
    refs.slider.addEventListener('input', () => {
      seeking = true;
      paintSlider();
      if (refs.cur && duration) refs.cur.textContent = formatTime((Number(refs.slider.value) / SCALE) * duration);
    });
    // 松手才真正定位（拖动中拇指已同步跟手）；引擎会立即按目标时间回报，拇指不会回跳
    refs.slider.addEventListener('change', () => {
      seeking = false;
      if (duration) engine.seek((Number(refs.slider.value) / SCALE) * duration, { fast: true });
    });
    paintSlider();
  }

  function renderMode(mode) {
    if (!refs.mode) return;
    refs.mode.innerHTML = ICONS.mode[mode];
    refs.mode.title = MODE_LABEL[mode];
    refs.mode.setAttribute('aria-label', `播放模式：${MODE_LABEL[mode]}`);
    refs.mode.classList.toggle('is-on', mode !== PLAY_MODE.SEQUENCE);
  }

  engine.on('playstate', ({ playing }) => {
    refs.play.classList.toggle('is-pause', playing);
    refs.play.title = playing ? '暂停' : '播放';
    refs.play.setAttribute('aria-label', refs.play.title);
  });
  // 播放中每帧都会到这里（引擎用 rAF 驱动），只在文字变化时写 DOM
  let lastCur = '';
  let lastTotal = '';
  engine.on('timeupdate', (payload) => {
    duration = payload.duration || duration;
    if (seeking) return;
    const cur = formatTime(payload.currentTime);
    if (refs.cur && cur !== lastCur) { refs.cur.textContent = cur; lastCur = cur; }
    const total = formatTime(payload.duration);
    if (refs.total && total !== lastTotal) { refs.total.textContent = total; lastTotal = total; }
    if (refs.slider && payload.duration) {
      const v = Math.round((payload.currentTime / payload.duration) * SCALE);
      if (String(v) !== refs.slider.value) refs.slider.value = v;
      paintSlider();
    }
  });
  engine.on('buffered', ({ ranges, duration: d }) => {
    buffered = ranges;
    if (d) duration = d;
    paintBuffered();
  });
  engine.on('trackchange', ({ track }) => {
    duration = track.duration || 0;
    buffered = [];
    if (refs.slider) { refs.slider.value = 0; paintSlider(); }
    if (refs.cur) { refs.cur.textContent = '00:00'; lastCur = '00:00'; }
    if (refs.total) { refs.total.textContent = formatTime(track.duration); lastTotal = refs.total.textContent; }
  });
  engine.on('modechange', ({ mode }) => renderMode(mode));
  renderMode(engine.getMode());
}
