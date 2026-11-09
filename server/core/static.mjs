/**
 * 基础层：静态文件服务
 * 限制在根目录内，防止目录穿越；默认路径映射到 index.html。
 */
import { createReadStream, stat } from 'node:fs';
import { resolve, normalize, join, extname } from 'node:path';
import { mimeFor } from './mime.mjs';

export function serveStatic(rootDir) {
  const root = resolve(rootDir);
  return function staticHandler(req, res, pathname) {
    const requested = pathname === '/' ? '/index.html' : pathname;
    const target = normalize(join(root, requested));
    if (!target.startsWith(root)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    stat(target, (err, info) => {
      if (err || !info.isFile()) {
        res.writeHead(404);
        return res.end('not found');
      }
      // 页面资源：每次用 ETag 协商（改了代码立即生效，没改则 304，省流量）
      const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      const headers = { 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': info.mtime.toUTCString() };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        return res.end();
      }
      res.writeHead(200, {
        ...headers,
        'Content-Type': mimeFor(extname(target)),
        'Content-Length': info.size,
      });
      createReadStream(target).pipe(res);
    });
  };
}
