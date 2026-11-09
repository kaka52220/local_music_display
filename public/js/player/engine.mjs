/**
 * 引擎层：播放引擎
 * 只封装 HTMLAudioElement 与播放队列/模式，通过事件对外通知。
 * 不引用任何 DOM 界面元素，因此 UI 可独立替换或单测。
 *
 * 低延迟设计（v4.1）：
 *  - 播放意图（playstate）与实际出声（audible）分开：点击当下就切换意图，界面同帧响应；
 *  - 预加载池：除当前曲目外，再用两个隐藏的 Audio 预先加载"下一首 / 上一首"（preload=auto），
 *    切歌时直接把已缓冲好的元素换上来播放，不再"换 src → 重新请求 → 等元数据"；
 *  - 时钟：播放中用 requestAnimationFrame 读取 audio.currentTime 逐帧派发 timeupdate
 *    （原生 timeupdate 只有约 250ms 一次，进度条/歌词会一顿一顿地滞后）；
 *  - 拖动定位：seek 后立即按目标时间派发 timeupdate（乐观更新），不等 seeked；
 *  - buffered：progress / 切歌 / seek 时派发已缓冲区间，供进度条绘制缓存段。
 */
export const PLAY_MODE = {
  SEQUENCE: 'sequence', // 顺序播放，播完最后一首停止
  LOOP_ONE: 'loop_one', // 单曲循环
  SHUFFLE: 'shuffle', // 随机播放
};

const POOL_SIZE = 3; // 当前 + 下一首 + 上一首

export function createPlayerEngine() {
  const listeners = new Map();
  const pool = [];          // 所有 Audio 元素
  const slotOf = new Map(); // Audio → 预加载的曲目索引
  let audio = null;         // 当前元素
  let queue = [];
  let index = -1;
  let mode = PLAY_MODE.SEQUENCE;
  let upcoming = -1; // 随机模式下预先抽好的"下一首"，保证唱片预览与实际切换一致
  let volume = 1;
  let muted = false;
  // 播放意图（用户想要播放）与实际出声分开：切歌加载期间意图不变，按钮/唱臂不会闪烁
  let intent = false;
  let switching = false; // 正在为自动播放而切换音源，期间忽略浏览器派发的 pause
  let audible = false;   // 音频真的在走（playing 之后、waiting/pause 之前）
  let seekTarget = null; // 乐观定位：seeked 之前 getCurrentTime 返回目标时间
  let raf = 0;
  let preloadTimer = 0;
  audio = makeAudio();

  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
  }
  function emit(event, payload) {
    listeners.get(event)?.forEach((fn) => fn(payload));
  }

  function makeAudio() {
    const el = new Audio();
    el.preload = 'auto';
    el.volume = volume;
    pool.push(el);
    bind(el);
    return el;
  }

  function setIntent(value) {
    if (intent === value) return;
    intent = value;
    emit('playstate', { playing: value });
    syncClock();
  }
  function setAudible(value) {
    if (audible === value) return;
    audible = value;
    emit('audible', { audible: value });
    syncClock();
  }
  function tryPlay() {
    const el = audio;
    return el.play().then(() => { if (el === audio) switching = false; }).catch((error) => {
      if (el !== audio) return;
      if (error && error.name === 'AbortError') return; // 被下一次切歌打断，交给下一次
      switching = false;
      setIntent(false);
    });
  }

  /* ---------------- 时钟：播放中逐帧派发进度 ---------------- */
  const duration = () => (Number.isFinite(audio.duration) ? audio.duration : queue[index]?.duration || 0);
  const currentTime = () => (seekTarget ?? audio.currentTime);
  function emitTime() {
    emit('timeupdate', { currentTime: currentTime(), duration: duration() });
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    emitTime();
  }
  function syncClock() {
    const run = intent && audible;
    if (run && !raf) raf = requestAnimationFrame(frame);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function emitBuffered() {
    const d = duration();
    const ranges = [];
    try {
      for (let i = 0; i < audio.buffered.length; i++) ranges.push([audio.buffered.start(i), audio.buffered.end(i)]);
    } catch { /* 未加载 */ }
    emit('buffered', { ranges, duration: d });
  }

  /* ---------------- 事件：只处理当前元素 ---------------- */
  function bind(el) {
    const cur = (fn) => (e) => { if (el === audio) fn(e); };
    el.addEventListener('ended', cur(() => {
      if (mode === PLAY_MODE.LOOP_ONE) {
        el.currentTime = 0;
        tryPlay();
      } else if (mode === PLAY_MODE.SEQUENCE && index === queue.length - 1) {
        emit('finished', {}); // 顺序模式到末尾停止
      } else {
        next();
      }
    }));
    el.addEventListener('timeupdate', cur(() => { if (!raf) emitTime(); }));
    el.addEventListener('play', cur(() => setIntent(true)));
    el.addEventListener('pause', cur(() => { setAudible(false); if (!switching) setIntent(false); }));
    el.addEventListener('playing', cur(() => { switching = false; setAudible(true); }));
    ['waiting', 'stalled', 'ended'].forEach((type) => el.addEventListener(type, cur(() => setAudible(false))));
    el.addEventListener('seeked', cur(() => { seekTarget = null; emitTime(); emitBuffered(); }));
    el.addEventListener('progress', cur(emitBuffered));
    el.addEventListener('loadedmetadata', cur(() => { emitTime(); emitBuffered(); }));
    el.addEventListener('volumechange', cur(() => emit('volumechange', { volume: el.volume, muted: el.muted })));
  }

  /* ---------------- 预加载池 ---------------- */
  function peekNextIndex() { return pickNextIndex(); }
  function peekPrevIndex() { return queue.length ? (index - 1 + queue.length) % queue.length : -1; }

  function preloadNeighbors() {
    clearTimeout(preloadTimer);
    if (queue.length < 2) return;
    const wanted = [...new Set([peekNextIndex(), peekPrevIndex()])].filter((i) => i >= 0 && i !== index);
    // 已经在池里的就保留；其余空闲元素拿来加载缺的
    const have = new Set();
    for (const el of pool) if (el !== audio && wanted.includes(slotOf.get(el))) have.add(slotOf.get(el));
    for (const i of wanted) {
      if (have.has(i)) continue;
      let el = pool.find((x) => x !== audio && !wanted.includes(slotOf.get(x)));
      if (!el && pool.length < POOL_SIZE) el = makeAudio();
      if (!el) break;
      el.pause();
      slotOf.set(el, i);
      el.src = queue[i].streamUrl;
      el.load();
      have.add(i);
    }
  }
  // 只在当前曲目已经出声、且缓冲领先播放位置足够多（或已整首缓冲）后才预加载邻居，
  // 绝不和当前曲目抢带宽（慢网下否则会拖慢当前曲目的起播与拖动）
  function aheadSeconds() {
    const t = audio.currentTime;
    try {
      for (let i = 0; i < audio.buffered.length; i++) {
        if (audio.buffered.start(i) <= t + 0.5 && audio.buffered.end(i) >= t) return audio.buffered.end(i) - t;
      }
    } catch { /* ignore */ }
    return 0;
  }
  function schedulePreload() {
    clearTimeout(preloadTimer);
    const d = duration();
    const enough = aheadSeconds() >= Math.min(30, Math.max(0, d - audio.currentTime - 0.5));
    if (audible && enough) { preloadNeighbors(); return; }
    preloadTimer = setTimeout(schedulePreload, 1000);
  }

  function loadAt(nextIndex, autoplay = true) {
    if (nextIndex < 0 || nextIndex >= queue.length) return;
    const prevEl = audio;
    const prevIndex = index;
    index = nextIndex;
    upcoming = -1;
    seekTarget = null;
    const track = queue[index];
    switching = autoplay;
    // 优先使用已预加载的元素
    const ready = pool.find((el) => el !== prevEl && slotOf.get(el) === index && el.src);
    if (ready) {
      audio = ready;
      prevEl.pause(); // 旧元素保留在池中（作为"上一首"的预加载）
      slotOf.set(prevEl, prevIndex);
      if (audio.currentTime > 0) audio.currentTime = 0;
    } else {
      audio.src = track.streamUrl;
    }
    slotOf.set(audio, index);
    audio.volume = volume;
    audio.muted = muted;
    emit('trackchange', { track, index }); // 先通知切歌（唱臂据此进入宽限期），再报告"暂未出声"
    setAudible(false);
    emitTime();
    emitBuffered();
    if (autoplay) { setIntent(true); tryPlay(); } else setIntent(false);
    schedulePreload();
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

  return {
    on,
    setQueue(tracks) {
      queue = tracks;
      index = -1;
      pool.forEach((el) => slotOf.delete(el));
    },
    playAt: loadAt,
    toggle() {
      if (!intent) {
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
    /** 定位：立即按目标时间更新界面；支持 fastSeek 的浏览器（Safari/Firefox）用它更快落点 */
    seek(seconds, { fast = false } = {}) {
      const d = duration();
      const t = Math.max(0, d ? Math.min(seconds, d - 0.05) : seconds);
      seekTarget = t;
      if (fast && typeof audio.fastSeek === 'function') audio.fastSeek(t);
      else audio.currentTime = t;
      emitTime();
      // 有些情况下不会触发 seeked（例如未加载完元数据）：兜底清除乐观值
      setTimeout(() => { if (seekTarget === t && !audio.seeking) seekTarget = null; }, 1500);
    },
    getCurrentTime: currentTime,
    getDuration: duration,
    setVolume(value) {
      volume = Math.min(1, Math.max(0, value));
      audio.volume = volume;
    },
    getVolume: () => volume,
    setMuted(value) {
      muted = value;
      audio.muted = value;
    },
    isMuted: () => muted,
    /** 播放意图（含切歌加载中）；isAudible 为音频实际在走 */
    isPlaying: () => intent,
    isAudible: () => audible,
    cycleMode() {
      const order = [PLAY_MODE.SEQUENCE, PLAY_MODE.LOOP_ONE, PLAY_MODE.SHUFFLE];
      mode = order[(order.indexOf(mode) + 1) % order.length];
      upcoming = -1;
      emit('modechange', { mode });
      schedulePreload();
    },
    getMode: () => mode,
    getIndex: () => index,
    getQueue: () => queue,
    /** 预览下一首/上一首的索引（不切歌），供唱片轮播展示相邻唱片 */
    peekNext: () => pickNextIndex(),
    peekPrev: () => peekPrevIndex(),
  };
}
