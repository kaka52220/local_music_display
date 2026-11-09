/**
 * UI 组件：播放主界面（网易云风格）——组装层
 * - 通用控制走 bindTransport；唱片轮播 discCarousel；歌词 lyricsView；
 * - 背景：封面主色（压暗/降饱和）渐变 + 双层模糊封面交叉淡入 + 缓慢流动的光晕；
 * - 切歌：标题/歌手/背景在唱片落定后交叉淡入（不在拖动过程中变化）。
 */
import { bindTransport } from './transport.mjs';
import { ICONS } from './icons.mjs';
import { createDiscCarousel } from './discCarousel.mjs';
import { createLyricsView } from './lyricsView.mjs';

const DEFAULT_TINT = { h: 330, s: 7, l: 24 };

/** 从封面图提取一个"氛围色"：按饱和度加权平均，避免被大片黑白主导。 */
function extractTint(img) {
  try {
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let r = 0; let g = 0; let b = 0; let w = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      const weight = 1 + ((max - min) / 255) * 4;
      r += data[i] * weight; g += data[i + 1] * weight; b += data[i + 2] * weight; w += weight;
    }
    return rgbToHsl(r / w, g / w, b / w);
  } catch {
    return DEFAULT_TINT;
  }
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function createNowPlaying(engine) {
  const app = document.getElementById('app');
  const covers = [document.getElementById('bg-cover-a'), document.getElementById('bg-cover-b')];
  const meta = document.getElementById('meta');
  const bigTitle = document.getElementById('big-title');
  const bigSub = document.getElementById('big-sub');
  const barTrack = document.querySelector('.bar-track');
  const barTitle = document.getElementById('bar-title');
  const barArtist = document.getElementById('bar-artist');
  const qualityTag = document.getElementById('quality-tag');
  const btnLyric = document.getElementById('btn-lyric');
  const btnVolume = document.getElementById('btn-volume');
  const volumeSlider = document.getElementById('volume-slider');

  applyTint(DEFAULT_TINT);

  bindTransport(engine, {
    play: document.getElementById('now-play'),
    prev: document.getElementById('now-prev'),
    next: document.getElementById('now-next'),
    playlist: document.getElementById('now-playlist'),
    mode: document.getElementById('now-mode'),
    slider: document.getElementById('now-slider'),
    cur: document.getElementById('now-cur'),
    total: document.getElementById('now-total'),
  });

  createDiscCarousel(engine);
  const lyrics = createLyricsView(engine);

  /* ---------------- 背景氛围色 ---------------- */
  function applyTint({ h, s }) {
    const sat = Math.min(s, 22) * 0.55;
    const hue = h.toFixed(0);
    app.style.setProperty('--tint-top', `hsl(${hue} ${sat.toFixed(1)}% 24%)`);
    app.style.setProperty('--tint-bottom', `hsl(${hue} ${(sat * 0.8).toFixed(1)}% 13%)`);
    app.style.setProperty('--glow', `hsl(${hue} ${Math.min(72, s * 2 + 28).toFixed(0)}% 52%)`);
  }

  let coverLayer = 0;
  function setBackground(track) {
    if (!track.coverUrl) {
      covers.forEach((c) => c.classList.remove('is-on'));
      applyTint(DEFAULT_TINT);
      return;
    }
    const img = new Image();
    img.onload = () => {
      applyTint(extractTint(img));
      coverLayer = 1 - coverLayer;
      const next = covers[coverLayer];
      next.style.backgroundImage = `url("${track.coverUrl}")`;
      next.classList.add('is-on');
      covers[1 - coverLayer].classList.remove('is-on');
    };
    img.src = track.coverUrl;
  }

  /* ---------------- 标题信息交叉淡入 ---------------- */
  let metaTimer = 0;
  function setMeta(track, animate) {
    const apply = () => {
      bigTitle.textContent = track.title;
      bigTitle.title = track.title;
      bigSub.innerHTML = '';
      [['专辑', track.album || '未知专辑'], ['歌手', track.artist], ['来源', '本地音乐']].forEach(([k, v]) => {
        const span = document.createElement('span');
        span.textContent = `${k}：${v}`;
        bigSub.appendChild(span);
      });
      barTitle.textContent = track.title;
      barArtist.textContent = track.artist;
      qualityTag.hidden = false;
      qualityTag.textContent = track.format.toUpperCase() === 'FLAC' ? '无损 FLAC' : `标准 ${track.format.toUpperCase()}`;
      document.title = `${track.title} - ${track.artist}`;
      meta.classList.remove('is-swapping');
      barTrack.classList.remove('is-swapping');
    };
    clearTimeout(metaTimer);
    if (!animate) { apply(); return; }
    meta.classList.add('is-swapping');
    barTrack.classList.add('is-swapping');
    metaTimer = setTimeout(apply, 200);
  }

  /* ---------------- 歌词显隐（底栏"词"/歌单快捷操作） ---------------- */
  function toggleLyrics() {
    const hidden = app.classList.toggle('lyrics-off');
    btnLyric.classList.toggle('is-active', !hidden);
    btnLyric.setAttribute('aria-pressed', String(!hidden));
  }
  btnLyric.addEventListener('click', toggleLyrics);

  /* ---------------- 音量 ---------------- */
  function renderVolume() {
    const muted = engine.isMuted() || engine.getVolume() === 0;
    btnVolume.innerHTML = muted ? ICONS.mute : ICONS.volume;
    btnVolume.setAttribute('aria-label', muted ? '取消静音' : '静音');
    const v = engine.isMuted() ? 0 : Math.round(engine.getVolume() * 100);
    volumeSlider.value = v;
    volumeSlider.style.setProperty('--p', `${v}%`);
  }
  btnVolume.addEventListener('click', () => {
    if (engine.getVolume() === 0) { engine.setVolume(0.6); engine.setMuted(false); } else engine.setMuted(!engine.isMuted());
  });
  volumeSlider.addEventListener('input', () => {
    engine.setMuted(false);
    engine.setVolume(Number(volumeSlider.value) / 100);
  });
  engine.on('volumechange', renderVolume);
  renderVolume();

  /* ---------------- 切歌 ---------------- */
  let first = true;
  engine.on('trackchange', ({ track }) => {
    setMeta(track, !first);
    setBackground(track);
    lyrics.render(track);
    first = false;
    // 设置 src 会触发媒体加载算法，丢弃尚未派发的 volumechange；此处补一次同步
    renderVolume();
  });

  engine.on('playstate', ({ playing }) => app.classList.toggle('is-playing', playing));

  return {
    toggleLyrics,
    isLyricsOn: () => !app.classList.contains('lyrics-off'),
  };
}
