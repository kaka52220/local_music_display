/**
 * UI 组件：歌词时间微调（v9）
 *   [−]  歌词 +0.3s  [+]
 * − = 歌词提前 0.1 秒，+ = 歌词延后 0.1 秒（歌更靠前）；点中间的数值重置为 0。
 * 页面里每个 [data-lyric-offset] 容器各渲染一份（播放页歌词区 / 迷你歌词条），共用同一个歌词时钟，数值同步。
 * 按住 ± 连续调整（先停 400ms，之后每 120ms 一档）。
 */
import { formatOffset } from '../player/lyricClock.mjs';

export function createLyricOffsetControls(clock) {
  const hosts = [...document.querySelectorAll('[data-lyric-offset]')];
  const labels = [];
  hosts.forEach((host) => {
    host.innerHTML = `
      <button class="lo-btn" data-dir="-1" aria-label="歌词提前 0.1 秒" title="歌词提前 0.1 秒">−</button>
      <button class="lo-val" aria-label="重置歌词时间" title="点击重置"></button>
      <button class="lo-btn" data-dir="1" aria-label="歌词延后 0.1 秒" title="歌词延后 0.1 秒">+</button>`;
    labels.push(host.querySelector('.lo-val'));
    host.querySelector('.lo-val').addEventListener('click', () => clock.setUserOffset(0));
    host.querySelectorAll('.lo-btn').forEach((btn) => {
      const dir = Number(btn.dataset.dir);
      let hold = 0;
      const stop = () => { clearTimeout(hold); clearInterval(hold); hold = 0; };
      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        clock.nudge(dir);
        stop();
        hold = setTimeout(() => { hold = setInterval(() => clock.nudge(dir), 120); }, 400);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => btn.addEventListener(t, stop));
      // 键盘（Enter/空格）触发的 click 没有 pointerdown
      btn.addEventListener('click', (e) => { if (e.detail === 0) clock.nudge(dir); });
    });
  });

  function render(pulse) {
    const v = clock.getUserOffset();
    labels.forEach((el) => {
      el.textContent = formatOffset(v);
      el.parentElement.classList.toggle('is-set', v !== 0);
      if (pulse) { el.classList.remove('is-pulse'); void el.offsetWidth; el.classList.add('is-pulse'); }
    });
  }
  let last = clock.getUserOffset();
  clock.onChange(() => { const v = clock.getUserOffset(); render(v !== last); last = v; });
  render(false);
}
