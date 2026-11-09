/**
 * 服务层：高潮点缓存
 * 歌曲文件里没有高潮信息，由前端在首次播放时解码分析（见 public/js/util/chorus.mjs），结果 POST 回来
 * 存进 cache/chorus.json，换设备 / 清浏览器缓存也不用重新分析。
 * 以 文件大小+修改时间 作为签名：文件被替换后旧结果自动失效。
 * 歌词里写了 [chorus:mm:ss] 时以它为准（手动覆盖）。
 */
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../core/config.mjs';
import { loadLyrics } from './lyrics.mjs';

const FILE = () => join(config.cacheDir, 'chorus.json');
const SOURCES = new Set(['lyrics+energy', 'lyrics', 'energy']);
let cache = null;
let saveTimer = 0;

async function load() {
  if (cache) return cache;
  try { cache = JSON.parse(await readFile(FILE(), 'utf8')) || {}; } catch { cache = {}; }
  return cache;
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir(config.cacheDir, { recursive: true });
      const tmp = `${FILE()}.tmp`;
      await writeFile(tmp, JSON.stringify(cache, null, 1));
      await rename(tmp, FILE());
    } catch (e) { console.warn('[chorus] 缓存写入失败：', e.message); }
  }, 300);
}
async function signature(track) {
  try { const st = await stat(track.filePath); return `${st.size}-${Math.floor(st.mtimeMs)}`; } catch { return ''; }
}

/** → { time, source, energy?, v? } | null */
export async function getChorus(track) {
  let lyrics = null;
  try { lyrics = await loadLyrics(track); } catch { /* ignore */ }
  if (lyrics && Number.isFinite(lyrics.chorus)) return { time: lyrics.chorus, source: 'lrc' };
  const c = await load();
  const entry = c[track.id];
  if (!entry || entry.sig !== (await signature(track))) return null;
  const { time, source, energy, v } = entry;
  return { time, source, energy, v };
}

export async function putChorus(track, body) {
  const time = Number(body?.time);
  const duration = track.duration || Infinity;
  if (!Number.isFinite(time) || time < 0 || time > duration) throw new Error('invalid time');
  if (!SOURCES.has(body.source)) throw new Error('invalid source');
  const entry = {
    time: Math.round(time * 100) / 100,
    source: body.source,
    v: Number.isInteger(body.v) ? body.v : 0,
    sig: await signature(track),
  };
  if (Number.isFinite(Number(body.energy))) entry.energy = Math.round(Number(body.energy) * 1000) / 1000;
  const c = await load();
  c[track.id] = entry;
  scheduleSave();
  return entry;
}
