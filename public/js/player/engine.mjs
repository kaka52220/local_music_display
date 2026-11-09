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
 *
 * 音量包络（v6）：界面在点击当帧响应，只有声音做短淡入淡出，避免"瞬间跳变"——
 *  - 暂停：淡出后才真正 pause；继续：从 0 淡入；拖动定位：先短暂压低 → 定位 → 落点后淡入；切歌：旧曲淡出、新曲淡入。
 *  - 优先用 Web Audio（MediaElementSource → GainNode，采样级平滑、无爆音），首次用户手势时创建/恢复 AudioContext；
 *    之前或不支持时退回逐帧改 element.volume（iOS 忽略 volume 时则不做淡变，直接暂停）。
 *  - 快速连点：每个元素只有一条当前包络，新的淡变从"此刻的实际电平"接着走，被取代的淡变不会执行其后续动作。
 */
export const PLAY_MODE = {
  SEQUENCE: 'sequence', // 列表循环：播完最后一首回到第一首
  LOOP_ONE: 'loop_one', // 单曲循环
  SHUFFLE: 'shuffle', // 随机播放
};

const POOL_SIZE = 3; // 当前 + 下一首 + 上一首

/** 淡入淡出时长（ms）。网易云实测见 docs/smoothness-v6.md */
export const FADE = { pauseOut: 280, resumeIn: 360, seekOut: 120, seekIn: 200, switchOut: 180, switchIn: 260 };

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
// ?webaudio=0 或 localStorage 'local-player/webaudio'='0' 可强制关闭 Web Audio（排障用）
const WEB_AUDIO_ALLOWED = params.get('webaudio') !== '0'
  && (typeof localStorage === 'undefined' || localStorage.getItem('local-player/webaudio') !== '0');
const AUDIO_DEBUG = params.has('audiodebug');
const SUPPORTS_VOLUME = (() => {
  try { const a = new Audio(); a.volume = 0.5; return Math.abs(a.volume - 0.5) < 0.01; } catch { return false; }
})();
const clamp01 = (x) => Math.min(1, Math.max(0, x));
// 电平 0..1 → 增益：平方曲线，听感上更接近均匀的淡变（线性增益前半段几乎听不出变化）
const shape = (level) => level * level;

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
  let pendingFadeIn = null; // { el, ms }：该元素真正出声（playing）时开始淡入
  let seekDip = null;       // { el, target, fast }：拖动定位的"压低-定位-淡入"进行中
  let stopAfterCurrent = false; // 定时关闭"播完本首后关闭"：本首播完即停，不切下一首
  /* ---- 音量包络 ---- */
  let actx = null;
  let master = null;
  let analyser = null;
  const gains = new Map();  // el → GainNode（已接入 Web Audio 的元素）
  const env = new Map();    // el → { from, to, t0, dur, token, resolve }
  let fadeToken = 0;
  let fallbackTimer = 0;

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
    pool.push(el);
    env.set(el, { from: 1, to: 1, t0: 0, dur: 0, token: 0, resolve: null });
    bind(el);
    attach(el);
    applyGain(el);
    return el;
  }

  /* ---------------- 音量包络 ---------------- */
  function levelAt(el, now = performance.now()) {
    const e = env.get(el);
    if (!e) return 1;
    if (!e.dur || now >= e.t0 + e.dur) return e.to;
    const k = clamp01((now - e.t0) / e.dur);
    return e.from + (e.to - e.from) * k;
  }
  const gainAt = (el, now) => (muted ? 0 : volume * shape(levelAt(el, now)));
  const canFade = (el) => gains.has(el) || SUPPORTS_VOLUME;

  /** 按当前包络把增益写到输出：Web Audio 预排自动化曲线；否则逐帧改 element.volume */
  function applyGain(el) {
    const g = gains.get(el);
    const now = performance.now();
    if (g) {
      const p = g.gain;
      const t = actx.currentTime;
      if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
      else p.cancelScheduledValues(t);
      p.setValueAtTime(gainAt(el, now), t);
      const e = env.get(el);
      const end = e.t0 + e.dur;
      if (e.dur && now < end) {
        const steps = Math.max(2, Math.ceil((end - now) / 15)); // 15ms 一段折线逼近平方曲线
        for (let i = 1; i <= steps; i++) {
          const tm = now + ((end - now) * i) / steps;
          p.linearRampToValueAtTime(gainAt(el, tm), t + (tm - now) / 1000);
        }
      }
      return;
    }
    el.volume = clamp01(gainAt(el, now));
    if (!fallbackTimer && [...env.keys()].some((x) => !gains.has(x) && isRamping(x, now))) {
      fallbackTimer = setTimeout(fallbackTick, 16);
    }
  }
  function isRamping(el, now = performance.now()) {
    const e = env.get(el);
    return e && e.dur && now < e.t0 + e.dur;
  }
  function fallbackTick() {
    fallbackTimer = 0;
    const now = performance.now();
    let more = false;
    for (const el of env.keys()) {
      if (gains.has(el)) continue;
      el.volume = clamp01(gainAt(el, now));
      if (isRamping(el, now)) more = true;
    }
    if (more) fallbackTimer = setTimeout(fallbackTick, 16);
  }

  /**
   * 把元素电平从"此刻的实际值"淡到 to，用时 ms × 剩余比例。
   * 返回 Promise<boolean>：完成为 true；被新的淡变取代为 false（调用方据此放弃后续动作）。
   */
  function fadeTo(el, to, ms) {
    const e = env.get(el);
    const now = performance.now();
    const from = levelAt(el, now);
    e.resolve?.(false);
    const token = ++fadeToken;
    const dur = canFade(el) ? ms * Math.abs(to - from) : 0;
    Object.assign(e, { from, to, t0: now, dur, token, resolve: null });
    applyGain(el);
    if (!dur) return Promise.resolve(true);
    return new Promise((resolve) => {
      e.resolve = resolve;
      setTimeout(() => {
        if (e.token !== token) return;
        e.resolve = null;
        e.dur = 0; e.from = to;
        resolve(true);
      }, dur);
    });
  }
  /** 立即设定电平（取消进行中的淡变） */
  function setLevel(el, level) {
    const e = env.get(el);
    e.resolve?.(false);
    Object.assign(e, { from: level, to: level, t0: 0, dur: 0, token: ++fadeToken, resolve: null });
    applyGain(el);
  }

  /** 接入 Web Audio（只在 AudioContext 已运行时；否则保持原生输出，避免无声） */
  function attach(el) {
    if (!actx || actx.state !== 'running' || gains.has(el)) return;
    try {
      const src = actx.createMediaElementSource(el);
      const g = actx.createGain();
      src.connect(g).connect(master);
      gains.set(el, g);
      el.volume = 1; // 音量与静音统一由增益节点负责
      el.muted = false;
      applyGain(el);
    } catch { /* 个别浏览器不支持：继续用 element.volume */ }
  }
  /** 在用户手势里调用：创建/恢复 AudioContext（自动播放策略要求） */
  function unlock() {
    if (!WEB_AUDIO_ALLOWED) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!actx) {
      // interactive = 低延迟输出路径。安卓 Chrome 的 <audio> 原生输出走大缓冲（实测平板上点击到出声/停声 0.5–1s），
      // 经 Web Audio 输出后停/起都跟手得多
      try { actx = new AC({ latencyHint: 'interactive' }); } catch { return; }
      master = actx.createGain();
      master.connect(actx.destination);
      if (AUDIO_DEBUG) {
        analyser = actx.createAnalyser();
        analyser.fftSize = 512;
        master.connect(analyser);
      }
      actx.addEventListener('statechange', () => {
        if (actx.state === 'running') pool.forEach(attach);
        // 被系统打断（来电/切后台）后，若仍想播放则尝试恢复
        else if (intent && gains.size) actx.resume().catch(() => {});
      });
    }
    if (actx.state === 'running') pool.forEach(attach);
    else actx.resume().then(() => pool.forEach(attach)).catch(() => {});
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
    const run = audible; // 暂停淡出期间声音仍在走，进度也照实走
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
      if (stopAfterCurrent) {
        stopAfterCurrent = false;
        switching = false;
        pendingFadeIn = null;
        setIntent(false);
        emit('sleepstop', { reason: 'track-end' });
        return;
      }
      if (mode === PLAY_MODE.LOOP_ONE) {
        el.currentTime = 0;
        tryPlay();
      } else {
        next();
      }
    }));
    el.addEventListener('timeupdate', cur(() => { if (!raf) emitTime(); }));
    el.addEventListener('play', cur(() => setIntent(true)));
    el.addEventListener('pause', cur(() => { setAudible(false); if (!switching) setIntent(false); }));
    el.addEventListener('playing', cur(() => {
      switching = false;
      setAudible(true);
      if (pendingFadeIn?.el === el) { const { ms } = pendingFadeIn; pendingFadeIn = null; if (intent) fadeTo(el, 1, ms); }
    }));
    ['waiting', 'stalled', 'ended'].forEach((type) => el.addEventListener(type, cur(() => setAudible(false))));
    el.addEventListener('seeked', cur(() => { seekTarget = null; emitTime(); emitBuffered(); }));
    el.addEventListener('progress', cur(emitBuffered));
    el.addEventListener('loadedmetadata', cur(() => { emitTime(); emitBuffered(); }));
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
    seekDip = null;
    const track = queue[index];
    switching = autoplay;
    // 旧曲在出声：交给它自己淡出后再暂停（新曲用另一个元素，两者短暂交叉）
    const fadeOld = !prevEl.paused && !prevEl.ended && canFade(prevEl);
    // 优先使用已预加载的元素；否则找一个空闲元素换源（让旧元素可以淡出）
    const ready = pool.find((el) => el !== prevEl && slotOf.get(el) === index && el.src);
    if (ready) {
      audio = ready;
      if (audio.currentTime > 0) audio.currentTime = 0;
    } else {
      let spare = fadeOld ? pool.find((el) => el !== prevEl && el.paused) : null;
      if (!spare && fadeOld && pool.length < POOL_SIZE) spare = makeAudio();
      if (spare) audio = spare;
      audio.src = track.streamUrl;
    }
    if (audio !== prevEl) {
      slotOf.set(prevEl, prevIndex); // 旧元素保留在池中（作为"上一首"的预加载）
      if (fadeOld) fadeTo(prevEl, 0, FADE.switchOut).then((done) => { if (done && prevEl !== audio) prevEl.pause(); });
      else prevEl.pause();
    }
    slotOf.set(audio, index);
    emit('trackchange', { track, index }); // 先通知切歌（唱臂据此进入宽限期），再报告"暂未出声"
    setAudible(false);
    emitTime();
    emitBuffered();
    if (autoplay) {
      setLevel(audio, canFade(audio) ? 0 : 1);
      pendingFadeIn = { el: audio, ms: FADE.switchIn };
      setIntent(true);
      tryPlay();
    } else {
      pendingFadeIn = null;
      setLevel(audio, 1);
      setIntent(false);
    }
    schedulePreload();
  }

  /* ---------------- 暂停 / 继续 / 定位（界面立即响应，声音做包络） ---------------- */
  function pauseSmooth() {
    switching = false;
    pendingFadeIn = null;
    setIntent(false);
    const el = audio;
    // 还没出声（加载/起播中）或无法淡变：直接暂停（也会取消挂起的 play()）
    if (el.paused || !audible || !canFade(el)) { el.pause(); return; }
    fadeTo(el, 0, FADE.pauseOut).then((done) => {
      // 被"继续播放"打断时 done=false，元素一直没停，直接淡回去即可
      if (done && (!intent || el !== audio)) el.pause();
    });
  }
  function playSmooth() {
    setIntent(true);
    const el = audio;
    if (!el.paused && !el.ended) {
      // 还在暂停淡出中：取消暂停，从当前电平淡回
      fadeTo(el, 1, FADE.resumeIn);
      return;
    }
    setLevel(el, canFade(el) ? 0 : 1);
    pendingFadeIn = { el, ms: FADE.resumeIn };
    tryPlay();
  }
  function applySeek(el, t, fast) {
    if (fast && typeof el.fastSeek === 'function') el.fastSeek(t);
    else el.currentTime = t;
  }
  function onceSeeked(el, fn) {
    let done = false;
    const run = () => { if (done) return; done = true; el.removeEventListener('seeked', run); fn(); };
    el.addEventListener('seeked', run);
    setTimeout(run, 1200); // 兜底
  }
  function seekSmooth(t, fast) {
    const el = audio;
    if (!(intent && audible && !el.paused && canFade(el))) { applySeek(el, t, fast); return; }
    if (seekDip && seekDip.el === el) { seekDip.target = t; seekDip.fast = fast; return; } // 压低中又拖了一次：只更新目标
    const dip = { el, target: t, fast };
    seekDip = dip;
    fadeTo(el, 0, FADE.seekOut).then(() => {
      if (seekDip !== dip) return; // 已切歌
      seekDip = null;
      applySeek(el, dip.target, dip.fast);
      onceSeeked(el, () => { if (intent && el === audio && !el.paused) fadeTo(el, 1, FADE.seekIn); });
    });
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

  audio = makeAudio();

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
        else playSmooth();
      } else pauseSmooth();
    },
    /** 在用户手势（pointerdown/keydown）中调用，解锁 Web Audio */
    unlock,
    next,
    prev,
    // 仅在已加载曲目时继续播放，供会话恢复使用；自动播放被拦截时静默
    resume() {
      if (index < 0) return;
      setLevel(audio, canFade(audio) ? 0 : 1);
      pendingFadeIn = { el: audio, ms: FADE.resumeIn };
      tryPlay();
    },
    /** 定位：立即按目标时间更新界面；支持 fastSeek 的浏览器（Safari/Firefox）用它更快落点 */
    seek(seconds, { fast = false } = {}) {
      const d = duration();
      const t = Math.max(0, d ? Math.min(seconds, d - 0.05) : seconds);
      seekTarget = t;
      seekSmooth(t, fast);
      emitTime();
      // 有些情况下不会触发 seeked（例如未加载完元数据）：兜底清除乐观值
      setTimeout(() => { if (seekTarget === t && !audio.seeking && !seekDip) seekTarget = null; }, 1500);
    },
    getCurrentTime: currentTime,
    /** 暂停（带短淡出），与 toggle 不同：已暂停时什么也不做 */
    pause() { if (intent) pauseSmooth(); },
    /**
     * 定时关闭：用 ms 毫秒把音量缓缓淡到 0，然后暂停（唱臂随播放状态抬起）。
     * 中途用户暂停/继续/切歌会接管包络，此时返回 false。
     */
    sleepFade(ms = 4000) {
      const el = audio;
      if (!intent) return Promise.resolve(false);
      if (el.paused || !audible || !canFade(el)) { pauseSmooth(); emit('sleepstop', { reason: 'timer' }); return Promise.resolve(true); }
      return fadeTo(el, 0, ms).then((done) => {
        if (!done || el !== audio || !intent) return false;
        switching = false;
        pendingFadeIn = null;
        setIntent(false);
        el.pause();
        emit('sleepstop', { reason: 'timer' });
        return true;
      });
    },
    /** 本首播完后停止（不切下一首） */
    setStopAfterCurrent(v) { stopAfterCurrent = Boolean(v); },
    getStopAfterCurrent: () => stopAfterCurrent,
    getDuration: duration,
    setVolume(value) {
      volume = clamp01(value);
      pool.forEach(applyGain);
      emit('volumechange', { volume, muted });
    },
    getVolume: () => volume,
    setMuted(value) {
      muted = Boolean(value);
      pool.forEach(applyGain);
      emit('volumechange', { volume, muted });
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
    /** 调试/测试：当前元素的包络电平、计划增益与（?audiodebug）实际输出 RMS */
    debugAudio() {
      let rms = null;
      if (analyser) {
        const buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        rms = Math.sqrt(buf.reduce((a, x) => a + x * x, 0) / buf.length);
      }
      return { webAudio: gains.has(audio), ctx: actx?.state || 'none', level: levelAt(audio), gain: gainAt(audio),
        paramGain: gains.get(audio)?.gain.value ?? null, elVolume: audio.volume, rms, paused: audio.paused, t: audio.currentTime };
    },
  };
}
