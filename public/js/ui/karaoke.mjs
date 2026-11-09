/**
 * 逐字（卡拉 OK）高亮：当前行随演唱从左到右"点亮"。
 *
 * 时间：.lrc 带逐字时间（增强型 LRC <mm:ss.xx>，服务端解析为 line.words）时直接使用；
 *       否则把本行时长（到下一行，且设上限）按"字"分配：中日韩每字一个单位，拉丁文按词（按字母数加权），
 *       空格与标点不占时间（并入前一个字）。
 * 绘制：文字是一个行内元素 .kara，背景渐变 + background-clip:text。行内元素换行后，背景按
 *       box-decoration-break: slice 把各个视觉行"首尾相接"成一条横带，所以一个横向渐变就能按阅读顺序
 *       跨行填充。逐帧只改 CSS 变量 --fill（px），只触发该行重绘，不触发布局。
 * 几何：每个字在横带上的起点用 canvas measureText 量（不碰布局），再按真实横带总长
 *       （各视觉行 getClientRects 宽度之和，只在该行变成当前行或尺寸变化时量一次）等比校正。
 */
const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\u3040-\u30FF\uAC00-\uD7AF]/;
const LATIN_WORD = /[A-Za-z0-9\u00C0-\u024F'’]+/y;
const SKIP = /[\s\p{P}\p{S}]/u;

/** 切成"演唱单位"：[{ text, weight }]，权重 0 的（空格/标点）不占时间 */
export function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (CJK.test(ch)) { out.push({ text: ch, weight: 1 }); i++; continue; }
    LATIN_WORD.lastIndex = i;
    const m = LATIN_WORD.exec(text);
    if (m) { out.push({ text: m[0], weight: 0.55 + 0.12 * m[0].length }); i += m[0].length; continue; }
    // 空格 / 标点：并入前一个单位（不占时间）
    if (out.length && SKIP.test(ch)) out[out.length - 1].text += ch;
    else out.push({ text: ch, weight: SKIP.test(ch) ? 0 : 1 });
    i++;
  }
  return out;
}

/** 生成逐字时间：[{ text, start, end }] */
export function buildTiming(line, nextTime) {
  if (line.words?.length) {
    const ws = line.words;
    const lineEnd = Number.isFinite(nextTime) ? nextTime : ws[ws.length - 1].time + 1;
    return ws.filter((w) => w.text).map((w) => {
      const k = ws.indexOf(w);
      const end = k + 1 < ws.length ? ws[k + 1].time : Math.min(lineEnd, w.time + 1.2);
      return { text: w.text, start: w.time, end: Math.max(w.time + 0.05, end) };
    });
  }
  const toks = tokenize(line.text);
  const units = toks.reduce((a, t) => a + t.weight, 0) || 1;
  const gap = Number.isFinite(nextTime) ? nextTime - line.time : units * 0.5 + 1;
  // 演唱时长：一般占到下一行前 0.2s；遇到长间奏（间隔远大于字数所需）时按每单位最多 0.6s 封顶
  const dur = Math.max(0.4, Math.min(gap - 0.2, Math.max(1.2, units * 0.6)));
  let t = line.time;
  return toks.map((tok) => {
    const d = (tok.weight / units) * dur;
    const r = { text: tok.text, start: t, end: t + d };
    t += d;
    return r;
  });
}

let ctx2d = null;
/** 量出每个单位在"横带"上的起止（px） */
export function measure(kara, timing) {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(kara);
  ctx2d.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ls = parseFloat(cs.letterSpacing) || 0;
  let x = 0;
  const geo = timing.map((tok) => {
    const w = ctx2d.measureText(tok.text).width + ls * [...tok.text].length;
    const g = { x0: x, x1: x + w };
    x += w;
    return g;
  });
  // 真实横带总长（各视觉行宽度之和；缩放 transform 会同时作用于文字与背景，按未缩放尺寸算）
  const rects = [...kara.getClientRects()];
  const scale = kara.parentElement.getBoundingClientRect().width / (kara.parentElement.offsetWidth || 1) || 1;
  const real = rects.reduce((a, r) => a + r.width, 0) / scale;
  const k = x > 0 && real > 0 ? real / x : 1;
  geo.forEach((g) => { g.x0 *= k; g.x1 *= k; });
  return { geo, total: real || x };
}

/** 时间 t 时应点亮到横带上的位置（px） */
export function fillAt(timing, geo, t) {
  if (!timing.length) return 0;
  if (t <= timing[0].start) return 0;
  for (let i = 0; i < timing.length; i++) {
    const tok = timing[i];
    if (t < tok.end) {
      if (t < tok.start) return geo[i].x0; // 字与字之间的停顿
      const k = (t - tok.start) / (tok.end - tok.start);
      return geo[i].x0 + (geo[i].x1 - geo[i].x0) * k;
    }
  }
  return geo[geo.length - 1].x1;
}
