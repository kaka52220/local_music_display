/**
 * UI 组件：进度条上的「高潮」提示点
 * - 优先用服务端结果（歌词 [chorus:mm:ss] 手动覆盖 / 已缓存的分析结果），其次本机 localStorage；
 * - 都没有时，在本首开始播放后的空闲时间里分析一次：下载音频 → OfflineAudioContext 以 8kHz 解码
 *   （浏览器原生解码，不依赖 ffmpeg，Windows/安卓都能用）→ 能量曲线 + 歌词重复段落 → 高潮起点，
 *   结果写回 localStorage 并 POST 给服务端缓存（cache/chorus.json）；
 * - 小白点位置与原生 range 拇指行程对齐；点它（或"高潮"小气泡）跳到高潮并播放。
 */
import { fetchChorus, saveChorus, fetchLyrics } from '../api/client.mjs';
import { ALGO_VERSION, rmsCurve, sustained, pickChorus } from '../util/chorus.mjs';
import { formatTime } from '../util/format.mjs';

const LOCAL_KEY = 'local-player/chorus/v1';
const ANALYZE_DELAY = 1500;
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));

function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch { return {}; } }
function writeLocal(id, v) {
  try { const all = readLocal(); all[id] = v; localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/** 下载并以低采样率解码，返回单声道能量曲线与时长 */
async function analyzeAudio(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('fetch failed');
  const bytes = await res.arrayBuffer();
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('no OfflineAudioContext');
  let ctx;
  try { ctx = new OAC(1, 1, 8000); } catch { ctx = new OAC(1, 1, 22050); }
  const audio = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
  const n = audio.length;
  let mono = audio.getChannelData(0);
  if (audio.numberOfChannels > 1) {
    const mix = new Float32Array(n);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < n; i++) mix[i] += d[i];
    }
    const k = 1 / audio.numberOfChannels;
    for (let i = 0; i < n; i++) mix[i] *= k;
    mono = mix;
  }
  return { curve: sustained(rmsCurve(mono, audio.sampleRate)), duration: audio.duration };
}

export function createChorusMarker(engine) {
  const dot = document.getElementById('chorus-dot');
  if (!dot) return null;
  let current = null;   // 当前曲目
  let chorus = null;    // { time, source }
  let token = 0;
  let pending = null;   // AbortController（分析中）
  let tipTimer = 0;
  const results = {};   // 调试：id → 结果
  window.__chorus = results;

  function hide() { dot.hidden = true; dot.classList.remove('show-tip'); }
  function flashTip(ms = 1600) {
    dot.classList.add('show-tip');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => dot.classList.remove('show-tip'), ms);
  }
  function show(result, announce) {
    chorus = result;
    const d = current?.duration || engine.getDuration() || 0;
    if (!d || !(result.time >= 0) || result.time >= d) { hide(); return; }
    dot.style.setProperty('--f', String(result.time / d));
    const label = `高潮 ${formatTime(result.time)}`;
    dot.title = label;
    dot.setAttribute('aria-label', `跳到高潮（${formatTime(result.time)}）`);
    if (dot.hidden) { dot.hidden = false; dot.style.animation = 'none'; void dot.offsetWidth; dot.style.animation = ''; }
    if (announce) flashTip();
  }

  async function analyze(track, my) {
    pending?.abort();
    const ac = new AbortController();
    pending = ac;
    let lines = [];
    try { const ly = await fetchLyrics(track.id); if (ly?.synced) lines = ly.lines; } catch { /* 无歌词 */ }
    let curve = null;
    let duration = track.duration || engine.getDuration() || 0;
    try {
      const a = await analyzeAudio(track.streamUrl, ac.signal);
      curve = a.curve;
      duration = a.duration || duration;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    } finally {
      if (pending === ac) pending = null;
    }
    const picked = pickChorus({ lines, curve, duration });
    const result = picked ? { ...picked, v: ALGO_VERSION } : { time: null, v: ALGO_VERSION };
    results[track.id] = { ...result, title: track.title };
    writeLocal(track.id, result);
    if (picked) saveChorus(track.id, result);
    if (my === token && picked) show(picked, true);
  }

  engine.on('trackchange', async ({ track }) => {
    const my = ++token;
    current = track;
    chorus = null;
    hide();
    pending?.abort();
    const server = await fetchChorus(track.id);
    if (my !== token) return;
    if (server && (server.source === 'lrc' || server.v === ALGO_VERSION)) {
      results[track.id] = { ...server, title: track.title };
      show(server, false);
      return;
    }
    const local = readLocal()[track.id];
    if (local && local.v === ALGO_VERSION) {
      results[track.id] = { ...local, title: track.title, from: 'local' };
      if (Number.isFinite(local.time)) { show(local, false); saveChorus(track.id, local); }
      return;
    }
    // 首次：稍等片刻，避开起播时的带宽 / CPU 高峰，再在空闲时分析
    setTimeout(() => { if (my === token) idle(() => { if (my === token) analyze(track, my); }); }, ANALYZE_DELAY);
  });

  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!chorus) return;
    engine.seek(chorus.time);
    if (!engine.isPlaying()) engine.toggle();
    flashTip(1200);
  });

  return { get: () => chorus };
}
