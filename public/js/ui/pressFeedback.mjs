/**
 * 按压反馈：从触点扩散的柔光涟漪（事件委托，作用于下列控件）。
 * 按下即出现，松手 / 取消 / 移出后淡出并移除——不留下任何"选中框"状态。
 * 键盘触发（Enter/Space）时从中心出现一次。
 */
const SELECTOR = '.sheet-action, .song, .ghost-btn, .lp-opt, .scrub-play, .dock-actions .icon-btn, #now-mode, #now-playlist, .sleep-btn, .sl-close, .sl-opt, .mini-ctrl .icon-btn, .lo-btn, .lp-seg-opt';
const MIN_VISIBLE_MS = 180;

export function initPressFeedback(root = document) {
  const live = new Map(); // pointerId → { el, born }

  function spawn(host, x, y) {
    host.classList.add('has-ripple');
    const r = host.getBoundingClientRect();
    const lx = x - r.left; const ly = y - r.top;
    // 圆形柔光：直径不超过控件短边的 1.7 倍，边缘在 70% 处完全透明——宽按钮上也只是触点周围的一团光，
    // 不会铺满成"浅色矩形"
    const far = Math.min(Math.hypot(Math.max(lx, r.width - lx), Math.max(ly, r.height - ly)), Math.min(r.width, r.height) * 0.85);
    const el = document.createElement('span');
    el.className = 'ripple';
    el.style.setProperty('--x', `${lx}px`);
    el.style.setProperty('--y', `${ly}px`);
    el.style.setProperty('--r', `${far * 2}px`);
    host.appendChild(el);
    return { el, born: performance.now() };
  }
  function fade(rec) {
    if (!rec) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - rec.born));
    setTimeout(() => {
      rec.el.classList.add('is-out');
      setTimeout(() => rec.el.remove(), 420);
    }, wait);
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const host = e.target.closest(SELECTOR);
    if (!host || host.disabled) return;
    fade(live.get(e.pointerId));
    live.set(e.pointerId, spawn(host, e.clientX, e.clientY));
  }, { passive: true });
  const end = (e) => { fade(live.get(e.pointerId)); live.delete(e.pointerId); };
  ['pointerup', 'pointercancel'].forEach((t) => root.addEventListener(t, end, { passive: true }));
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const host = e.target.closest?.(SELECTOR);
    if (!host) return;
    const r = host.getBoundingClientRect();
    fade(spawn(host, r.left + r.width / 2, r.top + r.height / 2));
  });
}
