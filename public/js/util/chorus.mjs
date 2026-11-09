/**
 * 工具：估算副歌/高潮起点（纯函数，浏览器与 Node 通用）。
 *
 * 歌曲文件本身没有"高潮"信息（MP3/FLAC 标签里没有这个字段；网易云的高潮点来自它服务端的分析），
 * 所以这里结合两路证据：
 *  1) 歌词：副歌的歌词会重复。把歌词行归一化后，找"连续两行一起重复出现"次数最多的段落，
 *     它的每一次出现都是候选起点（按时间排序）；
 *  2) 能量：解码后的音频按 0.5s 求 RMS，再求从 t 开始 15 秒的平均能量（相对整首最大值）。
 * 选择：候选里第一个能量足够高（≥ 0.72）的；都不够高时取候选中能量最高的（≥ 0.5）；
 * 再不行（无歌词 / 纯音乐）只看能量：前 20% 之后最响的连续 15 秒，并吸附到附近的歌词行首。
 * 版本号 ALGO_VERSION 变化会让旧缓存失效。
 */
export const ALGO_VERSION = 1;
export const HOP = 0.5;      // 能量曲线步长（秒）
export const WINDOW = 15;    // "持续"窗口（秒）

const norm = (text) => String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
// 署名/制作信息行（"混音：xxx""作词: xxx"）与"纯音乐，请欣赏"不算歌词
const isCredit = (text) => /^[^：:]{1,14}[：:]/.test(text) || /纯音乐/.test(text);

/** 歌词候选：返回 [{ time, count }]，按时间排序；count = 该两行段落的出现次数 */
export function lyricCandidates(lines) {
  const L = (lines || [])
    .filter((l) => Number.isFinite(l.time) && l.text && !isCredit(l.text))
    .map((l) => ({ time: l.time, key: norm(l.text) }))
    .filter((l) => l.key.length >= 2);
  if (L.length < 4) return [];
  const pair = (i) => (i + 1 < L.length ? `${L[i].key}\u0001${L[i + 1].key}` : null);
  const groups = new Map();
  for (let i = 0; i + 1 < L.length; i++) {
    const k = pair(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  let best = 1;
  for (const idx of groups.values()) best = Math.max(best, idx.length);
  if (best < 2) return [];
  const out = [];
  for (const idx of groups.values()) {
    if (idx.length !== best) continue;
    // 同一段落的相邻行也会各自成对重复：只保留段落首行（前一行不属于同一重复段的那一行）
    for (const i of idx) {
      const prev = i > 0 ? groups.get(pair(i - 1)) : null;
      if (prev && prev.length === best) continue;
      out.push({ time: L[i].time, count: best });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** 由单声道样本计算 RMS 曲线（每 HOP 秒一个值） */
export function rmsCurve(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate * HOP));
  const n = Math.floor(samples.length / hop);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let acc = 0;
    const base = k * hop;
    for (let i = 0; i < hop; i++) { const x = samples[base + i]; acc += x * x; }
    out[k] = Math.sqrt(acc / hop);
  }
  return out;
}

/** 15 秒滑动平均，并归一化到 [0,1]（相对整首最大窗口） */
export function sustained(rms) {
  const w = Math.max(1, Math.round(WINDOW / HOP));
  const n = rms.length;
  const out = new Float32Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) { // out[i] = 从 i 开始（最多）w 个点的平均
    acc += rms[i];
    if (i + w < n) acc -= rms[i + w];
    out[i] = acc / Math.min(w, n - i);
  }
  let max = 0;
  for (let i = 0; i + w <= n; i++) max = Math.max(max, out[i]);
  if (!max) for (let i = 0; i < n; i++) max = Math.max(max, out[i]);
  if (max > 0) for (let i = 0; i < n; i++) out[i] /= max;
  return out;
}

const energyAt = (curve, t) => {
  if (!curve || !curve.length) return 0;
  const i = Math.min(curve.length - 1, Math.max(0, Math.round(t / HOP)));
  return curve[i];
};

/**
 * 选择高潮起点。
 * @param {{ lines?: {time:number,text:string}[], curve?: Float32Array|null, duration: number }} p
 * @returns {{ time:number, source:'lyrics+energy'|'lyrics'|'energy', energy?:number } | null}
 */
export function pickChorus({ lines = [], curve = null, duration }) {
  const cands = lyricCandidates(lines).filter((c) => c.time < duration - 8);
  if (cands.length) {
    if (!curve || !curve.length) return { time: cands[0].time, source: 'lyrics' };
    const scored = cands.map((c) => ({ ...c, e: energyAt(curve, c.time) }));
    const strong = scored.find((c) => c.e >= 0.72);
    if (strong) return { time: strong.time, source: 'lyrics+energy', energy: +strong.e.toFixed(3) };
    const top = scored.reduce((a, b) => (b.e > a.e ? b : a));
    if (top.e >= 0.5) return { time: top.time, source: 'lyrics+energy', energy: +top.e.toFixed(3) };
  }
  if (!curve || !curve.length || duration < 40) return null;
  // 只看能量：前 20% 之后、留出窗口长度的范围里最响的连续 15 秒
  const lo = Math.round((duration * 0.2) / HOP);
  const hi = Math.max(lo, Math.min(curve.length - 1, Math.round((duration - WINDOW) / HOP)));
  let bi = lo;
  for (let i = lo; i <= hi; i++) if (curve[i] > curve[bi]) bi = i;
  let time = bi * HOP;
  // 吸附到 ±4 秒内最近的歌词行首（同步歌词时）
  let snap = null;
  for (const l of lines) {
    if (!Number.isFinite(l.time) || !l.text || isCredit(l.text)) continue;
    const d = Math.abs(l.time - time);
    if (d <= 4 && (!snap || d < Math.abs(snap - time))) snap = l.time;
  }
  if (snap !== null) time = snap;
  return { time: Math.round(time * 100) / 100, source: 'energy', energy: +curve[bi].toFixed(3) };
}
