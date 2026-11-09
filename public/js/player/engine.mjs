/**
 * 引擎层：播放引擎
 * 只封装 HTMLAudioElement 与播放队列/模式，通过事件对外通知。
 * 不引用任何 DOM 界面元素，因此 UI 可独立替换或单测。
 */
export const PLAY_MODE = {
  SEQUENCE: 'sequence', // 顺序播放，播完最后一首停止
  LOOP_ONE: 'loop_one', // 单曲循环
  SHUFFLE: 'shuffle', // 随机播放
};

export function createPlayerEngine() {
  const audio = new Audio();
  const listeners = new Map();
  let queue = [];
  let index = -1;
  let mode = PLAY_MODE.SEQUENCE;
  let upcoming = -1; // 随机模式下预先抽好的"下一首"，保证唱片预览与实际切换一致

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
  }
  function emit(event, payload) {
    listeners.get(event)?.forEach((fn) => fn(payload));
  }

  function loadAt(nextIndex, autoplay = true) {
    if (nextIndex < 0 || nextIndex >= queue.length) return;
    index = nextIndex;
    upcoming = -1;
    const track = queue[index];
    audio.src = track.streamUrl;
    emit('trackchange', { track, index });
    if (autoplay) audio.play().catch(() => {});
  }

  function pickNextIndex() {
    if (!queue.length) return -1;
    if (mode === PLAY_MODE.SHUFFLE) {
      if (upcoming >= 0) return upcoming;
      if (queue.length === 1) return index;
      let candidate;
      do {
        candidate = Math.floor(Math.random() * queue.length);
      } while (candidate === index);
      upcoming = candidate;
      return candidate;
    }
    return (index + 1) % queue.length;
  }

  function next() {
    const target = pickNextIndex();
    if (target >= 0) loadAt(target);
  }
  function prev() {
    if (!queue.length) return;
    loadAt((index - 1 + queue.length) % queue.length);
  }

  audio.addEventListener('ended', () => {
    if (mode === PLAY_MODE.LOOP_ONE) {
      audio.currentTime = 0;
      audio.play();
    } else if (mode === PLAY_MODE.SEQUENCE && index === queue.length - 1) {
      emit('finished', {}); // 顺序模式到末尾停止
    } else {
      next();
    }
  });
  audio.addEventListener('timeupdate', () => {
    emit('timeupdate', { currentTime: audio.currentTime, duration: audio.duration });
  });
  audio.addEventListener('play', () => emit('playstate', { playing: true }));
  audio.addEventListener('pause', () => emit('playstate', { playing: false }));
  audio.addEventListener('volumechange', () => emit('volumechange', { volume: audio.volume, muted: audio.muted }));

  return {
    on,
    setQueue(tracks) {
      queue = tracks;
      index = -1;
    },
    playAt: loadAt,
    toggle() {
      if (audio.paused) {
        if (index < 0 && queue.length) loadAt(0);
        else audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    },
    next,
    prev,
    // 仅在已加载曲目时继续播放，供会话恢复使用；自动播放被拦截时静默
    resume() {
      if (index >= 0) audio.play().catch(() => {});
    },
    seek(seconds) {
      audio.currentTime = seconds;
    },
    getCurrentTime: () => audio.currentTime,
    setVolume(value) {
      audio.volume = Math.min(1, Math.max(0, value));
    },
    getVolume: () => audio.volume,
    setMuted(value) {
      audio.muted = value;
    },
    isMuted: () => audio.muted,
    isPlaying: () => !audio.paused,
    cycleMode() {
      const order = [PLAY_MODE.SEQUENCE, PLAY_MODE.LOOP_ONE, PLAY_MODE.SHUFFLE];
      mode = order[(order.indexOf(mode) + 1) % order.length];
      upcoming = -1;
      emit('modechange', { mode });
    },
    getMode: () => mode,
    getIndex: () => index,
    getQueue: () => queue,
    /** 预览下一首/上一首的索引（不切歌），供唱片轮播展示相邻唱片 */
    peekNext: () => pickNextIndex(),
    peekPrev: () => (queue.length ? (index - 1 + queue.length) % queue.length : -1),
  };
}
