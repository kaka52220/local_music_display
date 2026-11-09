/**
 * 启动入口：组装 HTTP 服务
 * 先扫描建库，再挂载 API 路由与静态托管，最后监听端口。
 */
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './core/config.mjs';
import { createRouter } from './core/router.mjs';
import { serveStatic } from './core/static.mjs';
import { listTracks } from './api/tracks.mjs';
import { streamTrack } from './api/stream.mjs';
import { coverTrack } from './api/cover.mjs';
import { getLyrics } from './api/lyrics.mjs';
import { library } from './services/library.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');
const staticHandler = serveStatic(publicDir);

const apiRouter = createRouter([
  { method: 'GET', pattern: '/api/tracks', handler: listTracks },
  { method: 'GET', pattern: '/api/stream/:id', handler: streamTrack },
  { method: 'GET', pattern: '/api/cover/:id', handler: coverTrack },
  { method: 'GET', pattern: '/api/lyrics/:id', handler: getLyrics },
]);

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    return apiRouter(req, res);
  }
  return staticHandler(req, res, url.pathname);
});

const count = await library.scan();
server.listen(config.port, config.host, () => {
  console.log(`Local Player ready, ${count} tracks indexed.`);
  console.log(`Listening on http://${config.host}:${config.port}`);
  console.log(`本机访问 http://localhost:${config.port}`);
});
