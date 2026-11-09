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
const thin = (d, extra = '') =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
// 回环：左右半圆 + 上下直线组成的跑道形，右上留口，上沿末端接实心三角箭头
const LOOP = `<path d="M19.4 11.4A4.7 4.7 0 0 1 15.2 16.8H8.8A4.7 4.7 0 0 1 8.8 7.4h5.6" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path fill="currentColor" d="M14.2 4.9Q14.2 4.4 14.7 4.7L18.3 7Q18.8 7.4 18.3 7.8L14.7 10.1Q14.2 10.4 14.2 9.9Z"/>`;
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
  // 歌单：▶ + 短线，下方两条长线（细线条，仿网易云）
  playlist: wrap(
    solid([[4.2, 4.9], [4.2, 9.1], [7.8, 7]], 0.6) +
    thin('M10.6 7h9.2M4.4 12.2h15.4M4.4 17.4h15.4'),
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
    // 顺序（列表循环样式）：跑道形回环，开口在右上，箭头指向右
    sequence: wrap(LOOP),
    // 单曲循环：同一个回环，中间一个小"1"
    loop_one: wrap(LOOP + thin('M11.1 10.9l1.35-1.05v4.7', ' stroke-width="1.4"')),
    // 随机播放：两条交叉曲线 + 实心箭头，线宽与回环一致
    shuffle: wrap(
      thin('M3.8 7.6h2.6c4.6 0 6.4 8.8 11 8.8h1.2M3.8 16.4h2.6c1.6 0 2.8-1.1 3.8-2.5M13.8 10.1c1-1.4 2.2-2.5 3.6-2.5h1.2') +
      solid([[17.6, 5.4], [21, 7.6], [17.6, 9.8]], 0.6) +
      solid([[17.6, 14.2], [21, 16.4], [17.6, 18.6]], 0.6),
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
