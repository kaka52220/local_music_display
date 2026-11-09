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
      res.writeHead(200, {
        'Content-Type': mimeFor(extname(target)),
        'Content-Length': info.size,
      });
      createReadStream(target).pipe(res);
    });
  };
}
