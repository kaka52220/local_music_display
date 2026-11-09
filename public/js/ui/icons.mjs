/**
 * 共享图标库：集中管理 SVG 字符串（24×24 网格）
 * v4 按网易云平板端重画：播放/暂停/上一首/下一首为饱满的实心圆角块面（无外圈），
 * 模式/列表等次要图标为 1.9 线宽的粗线条、圆头圆角。
 */
const wrap = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const line = (d, extra = '') =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

// 实心圆角多边形：每个顶点用二次曲线倒角，得到网易云那种"饱满、边角柔和"的块面。
// （不用"填充 + 同色粗描边"的做法：颜色带透明度时描边与填充叠加会出现一圈亮边。）
function roundedPoly(pts, r) {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[(i + 1) % n];
    const l1 = Math.hypot(px - cx, py - cy);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const a = [cx + ((px - cx) / l1) * r, cy + ((py - cy) / l1) * r];
    const b = [cx + ((nx - cx) / l2) * r, cy + ((ny - cy) / l2) * r];
    d += `${i ? 'L' : 'M'}${a[0].toFixed(2)} ${a[1].toFixed(2)}Q${cx} ${cy} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
  }
  return `${d}Z`;
}
const solid = (pts, r) => `<path fill="currentColor" d="${roundedPoly(pts, r)}"/>`;
const bold = (d, extra = '') =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

export const ICONS = {
  // 播放：饱满的圆角三角（视觉重心右移 0.6 补偿）
  play: wrap(solid([[7.4, 4.3], [7.4, 19.7], [20.2, 12]], 2.3)),
  // 暂停：两根粗圆角竖条
  pause: wrap('<rect x="6.3" y="4.6" width="3.9" height="14.8" rx="1.5" fill="currentColor"/><rect x="13.8" y="4.6" width="3.9" height="14.8" rx="1.5" fill="currentColor"/>'),
  // 上一首 / 下一首：实心圆角三角 + 圆头竖条
  prev: wrap('<rect x="4.5" y="5" width="2.7" height="14" rx="1.35" fill="currentColor"/>' + solid([[19.3, 5.2], [19.3, 18.8], [8.9, 12]], 1.9)),
  next: wrap('<rect x="16.8" y="5" width="2.7" height="14" rx="1.35" fill="currentColor"/>' + solid([[4.7, 5.2], [4.7, 18.8], [15.1, 12]], 1.9)),
  heart: wrap(bold('M12 19.2s-7.2-4.3-7.2-9.4A3.9 3.9 0 0 1 8.7 5.9c1.4 0 2.6.7 3.3 1.9.7-1.2 1.9-1.9 3.3-1.9a3.9 3.9 0 0 1 3.9 3.9c0 5.1-7.2 9.4-7.2 9.4z')),
  heartOn: wrap('<path fill="currentColor" d="M12 19.2s-7.2-4.3-7.2-9.4A3.9 3.9 0 0 1 8.7 5.9c1.4 0 2.6.7 3.3 1.9.7-1.2 1.9-1.9 3.3-1.9a3.9 3.9 0 0 1 3.9 3.9c0 5.1-7.2 9.4-7.2 9.4z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'),
  // 布局样式：左右分栏的窗口
  layout: wrap(bold('M5.5 4.8h13a1.7 1.7 0 0 1 1.7 1.7v11a1.7 1.7 0 0 1-1.7 1.7h-13a1.7 1.7 0 0 1-1.7-1.7v-11a1.7 1.7 0 0 1 1.7-1.7zM10.6 4.8v14.4') + '<circle cx="7.2" cy="10.4" r="1.6" fill="currentColor"/>' + bold('M13.4 9.2h4M13.4 12h4M13.4 14.8h2.6', ' stroke-width="1.6"')),
  playlist: wrap(
    solid([[4.4, 4.7], [4.4, 9.3], [8, 7]], 0.7) +
    bold('M10.8 7h9M4.6 12h15.2M4.6 17h15.2'),
  ),
  library: wrap(line('M4 6.5h16M4 12h16M4 17.5h10')),
  playAll: wrap(line('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z') + '<path fill="currentColor" d="M10 8.6v6.8c0 .5.55.8.98.53l5.2-3.4a.63.63 0 0 0 0-1.06l-5.2-3.4c-.43-.27-.98.03-.98.53z"/>'),
  locate: wrap(line('M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5') + '<circle cx="12" cy="12" r="2.2" fill="currentColor"/>'),
  lyric: wrap(line('M5 5.5h14v10H11l-4 3.5v-3.5H5z') + line('M8.5 9.3h7M8.5 12h4.5')),
  search: wrap(line('M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6zM15.8 15.8 20 20')),
  volume: wrap(
    line('M4.5 9.5h3l4-3.5v12l-4-3.5h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z') +
    line('M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4'),
  ),
  mute: wrap(
    line('M4.5 9.5h3l4-3.5v12l-4-3.5h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z') +
    line('M15.5 9.5l5 5M20.5 9.5l-5 5'),
  ),
  mode: {
    // 顺序播放：列表 + 向下箭头
    sequence: wrap(
      bold('M4 6.5h10M4 12h10M4 17.5h7') +
      bold('M18 5.5v12.5M15.6 15.8l2.4 2.4 2.4-2.4'),
    ),
    // 单曲循环：回环 + 数字 1
    loop_one: wrap(
      bold('M17.5 7.5H8a4.5 4.5 0 0 0-4.5 4.5v.5M6.5 16.5H16a4.5 4.5 0 0 0 4.5-4.5v-.5') +
      bold('M15 5l2.5 2.5L15 10M9 19l-2.5-2.5L9 14') +
      bold('M11.2 11.2l1.3-1v4.4', ' stroke-width="1.6"'),
    ),
    // 随机播放：交叉箭头
    shuffle: wrap(
      bold('M3.5 7.5h3c4.5 0 6.5 9 11 9h2.5M3.5 16.5h3c1.6 0 2.8-1.1 3.8-2.5M13.7 10c1-1.4 2.2-2.5 3.8-2.5h2.5') +
      bold('M18 5.2l2.3 2.3L18 9.8M18 14.2l2.3 2.3L18 18.8'),
    ),
  },
};

export const MODE_LABEL = {
  sequence: '顺序播放',
  loop_one: '单曲循环',
  shuffle: '随机播放',
};

export const FALLBACK_COVER =
  '<svg viewBox="0 0 24 24" class="cover-note" aria-hidden="true"><path fill="currentColor" d="M12 3v10.55A4 4 0 1014 17V7h4V3z"/></svg>';
