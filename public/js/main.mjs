/**
 * 组装入口：连接引擎、接口、播放主界面与歌单弹窗，负责会话恢复与持久化。
 * 依赖方向 main -> engine/ui -> api/state，各模块不在此之外互相耦合。
 * 进入页面即播放主界面；没有独立的选歌页面，选歌统一在歌单弹窗中完成。
 */
import { fetchTracks } from './api/client.mjs';
import { createPlayerEngine } from './player/engine.mjs';
import { createNowPlaying } from './ui/nowPlaying.mjs';
import { createSheet } from './ui/sheet.mjs';
import { createLayout } from './ui/layout.mjs';
import { loadSession, saveSession } from './state/persistence.mjs';
import { initPressFeedback } from './ui/pressFeedback.mjs';
import { createSleepTimer } from './ui/sleepTimer.mjs';
import { createFullscreenToggle } from './ui/fullscreen.mjs';
import { createChorusMarker } from './ui/chorusMarker.mjs';

const engine = createPlayerEngine();
initPressFeedback();
// 调试/自动化测试（?audiodebug）：暴露引擎
if (new URLSearchParams(location.search).has('audiodebug')) window.__engine = engine;
const nowPlaying = createNowPlaying(engine);
const sheet = createSheet(engine, {
  onToggleLyrics: nowPlaying.toggleLyrics,
  isLyricsOn: nowPlaying.isLyricsOn,
});
const layout = createLayout(engine, {
  toggleLyrics: nowPlaying.toggleLyrics,
  isLyricsOn: nowPlaying.isLyricsOn,
});
const sleep = createSleepTimer(engine);
createFullscreenToggle();
createChorusMarker(engine);
if (new URLSearchParams(location.search).has('audiodebug')) window.__sleep = sleep;

// 首次用户手势时解锁 Web Audio（自动播放策略要求 AudioContext 在手势中创建/恢复）；之后每次手势都确保它在运行
['pointerdown', 'keydown', 'touchend'].forEach((type) => document.addEventListener(type, () => engine.unlock(), { capture: true, passive: true }));

/* ---------------- 播放会话持久化 ---------------- */
let currentTime = 0;
let lastSavedAt = 0;

engine.on('trackchange', ({ track }) => {
  currentTime = 0;
  saveSession({ trackId: track.id, position: 0 });
});

// 进度节流写入（约每 3 秒一次），避免高频写 localStorage
engine.on('timeupdate', ({ currentTime: time }) => {
  currentTime = time;
  const now = Date.now();
  if (now - lastSavedAt >= 3000) {
    lastSavedAt = now;
    saveSession({ position: time });
  }
});

// 音量变化即保存（静音时不覆盖原音量）
engine.on('volumechange', ({ volume, muted }) => {
  if (!muted) saveSession({ volume });
});

// 空格键：播放 / 暂停（输入控件、按钮聚焦或歌单打开时除外）
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || sheet.isOpen() || layout.isOpen() || sleep.isOpen()) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
  event.preventDefault();
  engine.toggle();
});

window.addEventListener('beforeunload', () => {
  saveSession({ position: currentTime });
});

/* ---------------- 启动：加载曲目并恢复上次会话 ---------------- */
try {
  const tracks = await fetchTracks();
  engine.setQueue(tracks);
  sheet.setTracks(tracks);

  const saved = loadSession();
  // 用户在曲目列表返回前就点了播放：尊重用户操作，不再用会话恢复覆盖
  const userActed = engine.getIndex() >= 0;
  if (saved && typeof saved.volume === 'number') engine.setVolume(saved.volume);
  const foundIndex = saved?.trackId ? tracks.findIndex((track) => track.id === saved.trackId) : -1;
  if (userActed) {
    /* 保持用户已开始的播放 */
  } else if (foundIndex >= 0) {
    // 先加载不自动播放，再恢复位置，最后尝试继续播放（被浏览器拦截时保持暂停）
    engine.playAt(foundIndex, false);
    if (saved.position > 0) engine.seek(saved.position);
    engine.resume();
  } else if (tracks.length) {
    // 从未播放过：默认选中第一首（暂停），让唱片、封面与歌词直接可见
    engine.playAt(0, false);
  } else {
    document.getElementById('big-title').textContent = '音乐目录中没有找到 flac 或 mp3 文件';
  }
} catch (error) {
  document.getElementById('big-title').textContent = error.message || '加载曲目失败';
}
