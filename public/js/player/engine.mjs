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
  // 播放意图（用户想要播放）与实际出声分开：切歌加载期间意图不变，按钮/唱臂不会闪烁
  let intent = false;
  let switching = false; // 正在为自动播放而切换音源，期间忽略浏览器派发的 pause
  let audible = false;   // 音频真的在走（playing 之后、waiting/pause 之前）

  function setIntent(value) {
    if (intent === value) return;
    intent = value;
    emit('playstate', { playing: value });
  }
  function setAudible(value) {
    if (audible === value) return;
    audible = value;
    emit('audible', { audible: value });
  }
  function tryPlay() {
    return audio.play().then(() => { switching = false; }).catch((error) => {
      if (error && error.name === 'AbortError') return; // 被下一次切歌打断，交给下一次
      switching = false;
      setIntent(false);
    });
  }

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
    switching = autoplay;
    audio.src = track.streamUrl;
    emit('trackchange', { track, index }); // 先通知切歌（唱臂据此进入宽限期），再报告"暂未出声"
    setAudible(false);
    if (autoplay) { setIntent(true); tryPlay(); } else setIntent(false);
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
      tryPlay();
    } else if (mode === PLAY_MODE.SEQUENCE && index === queue.length - 1) {
      emit('finished', {}); // 顺序模式到末尾停止
    } else {
      next();
    }
  });
  audio.addEventListener('timeupdate', () => {
    emit('timeupdate', { currentTime: audio.currentTime, duration: audio.duration });
  });
  audio.addEventListener('play', () => setIntent(true));
  audio.addEventListener('pause', () => { setAudible(false); if (!switching) setIntent(false); });
  audio.addEventListener('playing', () => { switching = false; setAudible(true); });
  ['waiting', 'emptied', 'stalled', 'ended'].forEach((type) => audio.addEventListener(type, () => setAudible(false)));
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
        else { setIntent(true); tryPlay(); }
      } else {
        switching = false;
        audio.pause();
        setIntent(false);
      }
    },
    next,
    prev,
    // 仅在已加载曲目时继续播放，供会话恢复使用；自动播放被拦截时静默
    resume() {
      if (index >= 0) tryPlay();
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
    /** 播放意图（含切歌加载中）；isAudible 为音频实际在走 */
    isPlaying: () => intent,
    isAudible: () => audible,
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
