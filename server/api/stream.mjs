/**
 * API：音频流
 * 支持 HTTP Range（206），浏览器才能拖动进度条并分段缓冲。
 */
import { createReadStream, stat } from 'node:fs';
import { extname } from 'node:path';
import { mimeFor } from '../core/mime.mjs';
import { library } from '../services/library.mjs';

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
    const total = info.size;
    const type = mimeFor(extname(track.filePath));
    const rangeHeader = req.headers.range;
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader ?? '');

    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : total - 1;
      if (start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': type,
      });
      createReadStream(track.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
        'Content-Type': type,
      });
      createReadStream(track.filePath).pipe(res);
    }
  });
}
