/**
 * 基础层：静态文件服务
 * 限制在根目录内，防止目录穿越；默认路径映射到 index.html。
 */
import { createReadStream, stat, readFile, readdirSync, statSync } from 'node:fs';
import { resolve, normalize, join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { mimeFor } from './mime.mjs';

/**
 * 构建号：public 下所有文件的 路径+大小+修改时间 的哈希。git pull 后任一文件变化都会变。
 * 注入到 index.html 的 CSS / 入口脚本地址（?v=构建号），保证平板等设备不会继续用旧的 JS/CSS；
 * 其余模块依赖 no-cache + ETag 每次协商（改了才下载，没改 304）。
 */
function buildId(root) {
  const h = createHash('sha1');
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(`${p}:${st.size}:${Math.floor(st.mtimeMs)};`);
    }
  };
  try { walk(root); } catch { /* ignore */ }
  return h.digest('hex').slice(0, 10);
}

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
      if (target === join(root, 'index.html')) return serveIndex(req, res, target);
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

  function serveIndex(req, res, file) {
    const v = buildId(root);
    const etag = `"idx-${v}"`;
    const headers = { 'Cache-Control': 'no-cache', ETag: etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    readFile(file, 'utf8', (err, html) => {
      if (err) { res.writeHead(500); return res.end('error'); }
      const body = html.replace(/(href|src)="(\/(?:styles|js)\/[^"?]+\.(?:css|mjs))"/g, `$1="$2?v=${v}"`);
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  }
}
