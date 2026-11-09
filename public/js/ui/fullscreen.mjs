/**
 * UI 组件：全屏切换（顶栏右侧）
 * Fullscreen API（含 webkit 前缀回退）；navigationUI:'hide' 让安卓浏览器隐藏导航栏。
 * 图标在"展开 / 收起"之间交叉变形；监听 fullscreenchange（含 Esc / 系统返回键退出）。
 * 浏览器不支持（如 iPhone Safari）时按钮保持隐藏。
 */
import { ICONS } from './icons.mjs';

const root = document.documentElement;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const supported = () => Boolean(
  (document.fullscreenEnabled || document.webkitFullscreenEnabled)
  && (root.requestFullscreen || root.webkitRequestFullscreen),
);

async function enter() {
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else root.webkitRequestFullscreen?.();
  } catch { /* 被拒绝（非用户手势等）：保持原状 */ }
}
async function exit() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else document.webkitExitFullscreen?.();
  } catch { /* ignore */ }
}

export function createFullscreenToggle() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return null;
  if (!supported()) { btn.hidden = true; return null; }
  btn.innerHTML = `<span class="fs-i fs-enter">${ICONS.fullscreen}</span><span class="fs-i fs-exit">${ICONS.fullscreenExit}</span>`;
  // 从主屏幕以「全屏 App」打开（manifest display: fullscreen）时本来就没有浏览器边框，按钮没有意义
  // （只在启动时判断：用 API 进入全屏后 display-mode 也可能变成 fullscreen，不能据此隐藏"退出"按钮）
  if (window.matchMedia?.('(display-mode: fullscreen)').matches && !fsElement()) { btn.hidden = true; return null; }
  btn.hidden = false;

  function render() {
    const on = Boolean(fsElement());
    btn.classList.toggle('is-full', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? '退出全屏' : '全屏';
    btn.setAttribute('aria-label', btn.title);
    document.getElementById('app')?.classList.toggle('is-fullscreen', on);
  }
  btn.addEventListener('click', () => (fsElement() ? exit() : enter()));
  document.addEventListener('fullscreenchange', render);
  document.addEventListener('webkitfullscreenchange', render);
  render();
  return { toggle: () => (fsElement() ? exit() : enter()), isFullscreen: () => Boolean(fsElement()) };
}
