/**
 * 歌词时钟：把"音频位置"换算成"歌词该显示到的位置"，所有歌词视图（经典 / 分栏 / 迷你歌词条）共用。
 *
 *   歌词时间 = audio.currentTime − 输出延迟 − 默认延后 − 用户偏移 + 歌词文件 [offset:]
 *
 * - 输出延迟：经 Web Audio 输出时 currentTime 读到的是"交给音频图的位置"，真正从扬声器（含蓝牙）出来还要再等
 *   baseLatency + outputLatency（引擎实时读取，蓝牙连上/断开会变化）。不扣掉，高亮就会比歌声早这么多。
 * - 默认延后 DEFAULT_DELAY = 0.1s：让歌声略早于高亮（用户要求"歌在前、但不能差太多"）。
 *   取值依据 ITU-R BT.1359：声音领先画面约 45ms 开始可察觉、90ms 以内仍可接受；0.1s 刚好在"能感觉到歌在前"
 *   且接近可接受上限的位置（逐字填充是柔和渐变，视觉上的"边"本身再落后一点）。
 * - 用户偏移：±0.1s 一档，正数 = 歌词延后（歌更靠前），全局记住（localStorage）。
 * - [offset:] 标签（毫秒，LRC 约定"+ 让歌词更早出现"）按歌曲生效。
 */
const KEY = 'local-player/lyric-offset/v1';
export const DEFAULT_DELAY = 0.1;
const STEP = 0.1;
const LIMIT = 5;
const MAX_LATENCY = 0.8; // 异常值保护

const round1 = (v) => Math.round(v * 10) / 10;
function load() {
  try { const v = Number(JSON.parse(localStorage.getItem(KEY))); return Number.isFinite(v) ? round1(v) : 0; } catch { return 0; }
}

export function createLyricClock(engine) {
  let user = load();
  let track = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  const latency = () => Math.min(MAX_LATENCY, Math.max(0, engine.getOutputLatency?.() || 0));
  const shift = () => latency() + DEFAULT_DELAY + user - track;

  return {
    /** 音频时间 → 歌词时间 */
    map: (t) => t - shift(),
    /** 歌词时间 → 音频时间（"从这句播放"时让音频落在与这句对齐的位置） */
    toAudio: (t) => Math.max(0, t + shift()),
    now: () => engine.getCurrentTime() - shift(),
    getUserOffset: () => user,
    setUserOffset(v) {
      const next = Math.min(LIMIT, Math.max(-LIMIT, round1(v)));
      if (next === user) return;
      user = next;
      try { localStorage.setItem(KEY, JSON.stringify(user)); } catch { /* ignore */ }
      emit();
    },
    nudge(dir) { this.setUserOffset(user + dir * STEP); },
    /** 歌词文件里的 [offset:]（毫秒） */
    setTrackOffset(ms) {
      const v = Number.isFinite(ms) ? ms / 1000 : 0;
      if (v === track) return;
      track = v;
      emit();
    },
    /** 调试：当前各项（秒） */
    debug: () => ({ latency: latency(), delay: DEFAULT_DELAY, user, track, shift: shift() }),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** "歌词 +0.3s" 文案（正数 = 延后） */
export function formatOffset(v) {
  if (!v) return '歌词 0.0s';
  return `歌词 ${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}s`;
}
