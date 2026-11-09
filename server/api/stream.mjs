/**
 * API：音频流
 * - 支持 HTTP Range（206，含 "bytes=-N" 后缀区间与 If-Range），浏览器才能拖动进度条并分段缓冲；
 * - 带 ETag / Last-Modified / Cache-Control：平板经局域网访问时，重复播放、上一首/下一首预加载
 *   可直接命中浏览器缓存或得到 304，不再每次整首重新下载；
 * - 直接流式读文件，不做任何逐请求的元数据解析（元数据在启动扫描时已读好）；
 * - MP3 跳过文件开头的 ID3v2 标签（里面常塞着几百 KB 的封面图）：Chrome 遇到内嵌封面时
 *   要先下载完整个标签再多读约 1MB 才报 loadedmetadata，局域网下就是切歌/起播慢半拍的主因。
 *   封面与歌名等信息已由 /api/cover、/api/tracks 单独提供，音频流里不需要。
 */
import { createReadStream, stat, open, read, close } from 'node:fs';
import { extname } from 'node:path';
import { mimeFor } from '../core/mime.mjs';
import { library } from '../services/library.mjs';

const audioOffsets = new Map(); // filePath + mtime → 音频数据起始偏移

/** 读取 ID3v2 头，返回音频帧起始字节（无标签返回 0）。 */
function audioOffset(filePath, info, cb) {
  if (!/\.mp3$/i.test(filePath)) return cb(0);
  const key = `${filePath}:${info.mtimeMs}`;
  if (audioOffsets.has(key)) return cb(audioOffsets.get(key));
  open(filePath, 'r', (err, fd) => {
    if (err) return cb(0);
    const head = Buffer.alloc(10);
    read(fd, head, 0, 10, 0, (rerr, n) => {
      close(fd, () => {});
      let offset = 0;
      if (!rerr && n === 10 && head.toString('latin1', 0, 3) === 'ID3') {
        const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
        const footer = head[5] & 0x10 ? 10 : 0;
        offset = 10 + size + footer;
        if (offset >= info.size) offset = 0;
      }
      audioOffsets.set(key, offset);
      cb(offset);
    });
  });
}

export function streamTrack(req, res) {
  const track = library.getById(req.params.id);
  if (!track) {
    res.writeHead(404);
    return res.end('not found');
  }
  stat(track.filePath, (err, info) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    audioOffset(track.filePath, info, (offset) => send(req, res, track, info, offset));
  });
}

function send(req, res, track, info, offset) {
  const total = info.size - offset;
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}-${offset.toString(16)}"`;
  const lastModified = info.mtime.toUTCString();
  const common = {
    'Content-Type': mimeFor(extname(track.filePath)),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
    ETag: etag,
    'Last-Modified': lastModified,
  };

  // 条件请求：文件没变 → 304
  const inm = req.headers['if-none-match'];
  if (inm && inm.split(/\s*,\s*/).includes(etag) && !req.headers.range) {
    res.writeHead(304, common);
    return res.end();
  }

  // If-Range 不匹配时忽略 Range，返回整个文件
  const ifRange = req.headers['if-range'];
  const rangeOk = !ifRange || ifRange === etag || ifRange === lastModified;
  const match = rangeOk ? /^bytes=(\d*)-(\d*)$/.exec((req.headers.range ?? '').trim()) : null;

  if (match && (match[1] || match[2])) {
    let start;
    let end;
    if (!match[1]) { // 后缀区间：最后 N 字节
      start = Math.max(0, total - Number(match[2]));
      end = total - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    }
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    res.writeHead(206, {
      ...common,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(track.filePath, { start: start + offset, end: end + offset, highWaterMark: 256 * 1024 }).pipe(res);
  } else {
    res.writeHead(200, { ...common, 'Content-Length': total });
    if (req.method === 'HEAD') return res.end();
    createReadStream(track.filePath, { start: offset, highWaterMark: 256 * 1024 }).pipe(res);
  }
}
