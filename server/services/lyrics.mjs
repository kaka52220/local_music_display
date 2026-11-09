/**
 * 服务层：歌词
 * parseLrc 为纯函数，把 LRC 文本解析为按时间排序的行；loadLyrics 读取同名 .lrc。
 * 兼容：一行多时间标签、两位/三位小数、UTF-8 BOM、无时间标签的纯文本。
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, basename, extname } from 'node:path';

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
// 增强型 LRC（A2 扩展）的逐字时间：<mm:ss.xx>
const WORD_TAG = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const toSeconds = (m, s, f) => Number(m) * 60 + Number(s) + (f ? Number(f) / (f.length === 3 ? 1000 : f.length === 2 ? 100 : 10) : 0);

/** 解析一行里的逐字时间标签；没有则返回 null */
function parseWords(content) {
  const tags = [...content.matchAll(WORD_TAG)];
  if (!tags.length) return null;
  const words = [];
  for (let i = 0; i < tags.length; i++) {
    const start = tags[i].index + tags[i][0].length;
    const end = i + 1 < tags.length ? tags[i + 1].index : content.length;
    const text = content.slice(start, end);
    const time = Math.round(toSeconds(tags[i][1], tags[i][2], tags[i][3]) * 1000) / 1000;
    if (text) words.push({ time, text });
    else if (words.length && i === tags.length - 1) words.push({ time, text: '' }); // 行尾结束标签
  }
  // 第一个标签之前的文字并入第一个词
  const lead = content.slice(0, tags[0].index);
  if (lead && words.length) words[0].text = lead + words[0].text;
  return words.length ? words : null;
}

// 手动指定高潮起点：[chorus:mm:ss] 或 [chorus:mm:ss.xx]（扩展 ID 标签）
const CHORUS_TAG = /^\s*\[chorus:\s*(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\s*\]/im;

/** 读出 [chorus:] 标签（秒），没有返回 null */
export function parseChorusTag(rawText) {
  const m = CHORUS_TAG.exec(rawText || '');
  return m ? Math.round(toSeconds(m[1], m[2], m[3]) * 1000) / 1000 : null;
}

export function parseLrc(rawText) {
  const text = rawText.replace(/^\uFEFF/, '');
  const timed = [];
  const chorus = parseChorusTag(text);

  for (const rawLine of text.split(/\r?\n/)) {
    const tags = [...rawLine.matchAll(TIME_TAG)];
    if (!tags.length) continue; // 忽略 JSON 富文本行与无标签行
    const withWords = rawLine.replace(TIME_TAG, '').trim();
    const words = parseWords(withWords);
    const content = withWords.replace(WORD_TAG, '').trim();
    for (const tag of tags) {
      const minute = Number(tag[1]);
      const second = Number(tag[2]);
      const fraction = tag[3]
        ? Number(tag[3]) / (tag[3].length === 3 ? 1000 : 100)
        : 0;
      const time = minute * 60 + second + fraction;
      const line = { time: Math.round(time * 1000) / 1000, text: content };
      if (words && tags.length === 1) line.words = words;
      timed.push(line);
    }
  }

  if (timed.length) {
    timed.sort((a, b) => a.time - b.time);
    return chorus !== null ? { synced: true, lines: timed, chorus } : { synced: true, lines: timed };
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
