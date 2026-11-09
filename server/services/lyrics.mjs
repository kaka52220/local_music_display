/**
 * 服务层：歌词
 * parseLrc 为纯函数，把 LRC 文本解析为按时间排序的行；loadLyrics 读取同名 .lrc。
 * 兼容：一行多时间标签、两位/三位小数、UTF-8 BOM、无时间标签的纯文本。
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(rawText) {
  const text = rawText.replace(/^\uFEFF/, '');
  const timed = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const tags = [...rawLine.matchAll(TIME_TAG)];
    if (!tags.length) continue; // 忽略 JSON 富文本行与无标签行
    const content = rawLine.replace(TIME_TAG, '').trim();
    for (const tag of tags) {
      const minute = Number(tag[1]);
      const second = Number(tag[2]);
      const fraction = tag[3]
        ? Number(tag[3]) / (tag[3].length === 3 ? 1000 : 100)
        : 0;
      const time = minute * 60 + second + fraction;
      timed.push({ time: Math.round(time * 1000) / 1000, text: content });
    }
  }

  if (timed.length) {
    timed.sort((a, b) => a.time - b.time);
    return { synced: true, lines: timed };
  }

  // 无时间标签：作为纯文本歌词静态展示
  const plain = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('{'))
    .map((line) => ({ text: line }));
  return { synced: false, lines: plain };
}

/** 读取与音频同目录、同名的 .lrc；不存在返回 null。 */
export async function loadLyrics(track) {
  const lrcPath = join(
    dirname(track.filePath),
    basename(track.filePath, extname(track.filePath)) + '.lrc',
  );
  let raw;
  try {
    raw = await readFile(lrcPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return parseLrc(raw);
}
