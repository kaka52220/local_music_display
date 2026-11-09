/**
 * 共享图标库：集中管理 SVG 字符串（24×24 网格）
 * 造型参考网易云桌面端：线性图标统一 1.6 线宽、圆头圆角；
 * 播放/暂停/切歌为实心块面，保证主操作更有分量。
 */
const wrap = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const line = (d, extra = '') =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

export const ICONS = {
  play: wrap('<path fill="currentColor" d="M8.5 6.1v11.8c0 .77.83 1.25 1.5.86l10.1-5.9a1 1 0 0 0 0-1.72L10 5.24c-.67-.39-1.5.09-1.5.86z"/>'),
  pause: wrap('<rect x="7" y="5.5" width="3" height="13" rx="1" fill="currentColor"/><rect x="14" y="5.5" width="3" height="13" rx="1" fill="currentColor"/>'),
  prev: wrap('<rect x="5.5" y="5.5" width="2.2" height="13" rx="1" fill="currentColor"/><path fill="currentColor" d="M18.5 6.4v11.2c0 .8-.9 1.27-1.56.82l-8.1-5.6a1 1 0 0 1 0-1.64l8.1-5.6c.66-.45 1.56.02 1.56.82z"/>'),
  next: wrap('<rect x="16.3" y="5.5" width="2.2" height="13" rx="1" fill="currentColor"/><path fill="currentColor" d="M5.5 6.4v11.2c0 .8.9 1.27 1.56.82l8.1-5.6a1 1 0 0 0 0-1.64l-8.1-5.6C6.4 5.13 5.5 5.6 5.5 6.4z"/>'),
  playlist: wrap(
    '<path fill="currentColor" d="M4 4.6v4.8l3.6-2.4z"/>' +
    line('M10.5 7h9.5M4.5 12h15.5M4.5 17h15.5'),
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
      line('M4 6.5h10M4 12h10M4 17.5h7') +
      line('M18 5.5v12.5M15.6 15.8l2.4 2.4 2.4-2.4'),
    ),
    // 单曲循环：回环 + 数字 1
    loop_one: wrap(
      line('M17.5 7.5H8a4.5 4.5 0 0 0-4.5 4.5v.5M6.5 16.5H16a4.5 4.5 0 0 0 4.5-4.5v-.5') +
      line('M15 5l2.5 2.5L15 10M9 19l-2.5-2.5L9 14') +
      line('M11.2 11.2l1.3-1v4.4', ' stroke-width="1.4"'),
    ),
    // 随机播放：交叉箭头
    shuffle: wrap(
      line('M3.5 7.5h3c4.5 0 6.5 9 11 9h2.5M3.5 16.5h3c1.6 0 2.8-1.1 3.8-2.5M13.7 10c1-1.4 2.2-2.5 3.8-2.5h2.5') +
      line('M18 5.2l2.3 2.3L18 9.8M18 14.2l2.3 2.3L18 18.8'),
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
