/**
 * 领域层：Track 领域模型与格式归一
 * 纯逻辑、不依赖 HTTP/框架，负责把磁盘文件统一为内部 Track，并提供对外 DTO。
 * 内部 Track 含绝对路径与封面数据，仅服务端可见；对外 DTO 不含任何文件系统信息。
 */
import { basename, extname } from 'node:path';

/** 基于绝对路径生成稳定 id，保证重复扫描时 id 不变（URL 安全的 36 进制）。 */
export function stableId(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return 't' + h.toString(36);
}

/** 文件名回退解析：兼容 "歌手 - 歌名"，否则把整名当作歌名。 */
export function parseFileName(fileName) {
  const stem = basename(fileName, extname(fileName));
  const marker = stem.indexOf(' - ');
  if (marker >= 0) {
    return {
      artist: stem.slice(0, marker).trim(),
      title: stem.slice(marker + 3).trim(),
    };
  }
  return { artist: '未知艺术家', title: stem.trim() };
}

/** 构造内部 Track（此时只有文件信息，元数据由 library 后续填充）。 */
export function createTrack(filePath, format) {
  const fileName = basename(filePath);
  const fallback = parseFileName(fileName);
  return {
    id: stableId(filePath),
    title: fallback.title,
    artist: fallback.artist,
    album: '',
    duration: 0,
    format: format.replace('.', ''),
    fileName,
    filePath,
    cover: null,
    hasCover: false,
  };
}

/** 转为对外 DTO：剥离绝对路径与封面二进制，只暴露 URL。 */
export function toPublicTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    format: track.format,
    hasCover: track.hasCover,
    streamUrl: `/api/stream/${track.id}`,
    coverUrl: track.hasCover ? `/api/cover/${track.id}` : null,
  };
}
