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
  let seeking = false;

  refs.play.innerHTML = ICONS.play;
  refs.play.title = '播放';
  refs.play.addEventListener('click', () => engine.toggle());
  if (refs.prev) refs.prev.innerHTML = ICONS.prev;
  if (refs.next) refs.next.innerHTML = ICONS.next;
  if (refs.playlist) refs.playlist.innerHTML = ICONS.playlist;
  refs.prev?.addEventListener('click', () => engine.prev());
  refs.next?.addEventListener('click', () => engine.next());
  refs.mode?.addEventListener('click', () => engine.cycleMode());

  // 进度条已播放部分用 CSS 变量 --p 绘制（0–100%）
  function paintSlider() {
    if (!refs.slider) return;
    refs.slider.style.setProperty('--p', `${Number(refs.slider.value) / 10}%`);
  }

  if (refs.slider) {
    refs.slider.addEventListener('input', () => {
      seeking = true;
      paintSlider();
      if (refs.cur && duration) refs.cur.textContent = formatTime((Number(refs.slider.value) / 1000) * duration);
    });
    refs.slider.addEventListener('change', () => {
      if (duration) engine.seek((Number(refs.slider.value) / 1000) * duration);
      seeking = false;
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
    refs.play.innerHTML = playing ? ICONS.pause : ICONS.play;
    refs.play.title = playing ? '暂停' : '播放';
  });
  engine.on('timeupdate', (payload) => {
    duration = payload.duration || duration;
    if (seeking) return;
    if (refs.cur) refs.cur.textContent = formatTime(payload.currentTime);
    if (refs.total) refs.total.textContent = formatTime(payload.duration);
    if (refs.slider && payload.duration) {
      refs.slider.value = Math.round((payload.currentTime / payload.duration) * 1000);
      paintSlider();
    }
  });
  engine.on('trackchange', ({ track }) => {
    duration = track.duration || 0;
    if (refs.slider) { refs.slider.value = 0; paintSlider(); }
    if (refs.cur) refs.cur.textContent = '00:00';
    if (refs.total) refs.total.textContent = formatTime(track.duration);
  });
  engine.on('modechange', ({ mode }) => renderMode(mode));
  renderMode(engine.getMode());
}
