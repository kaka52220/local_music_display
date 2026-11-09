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
import { eventsApi, broadcast } from './api/events.mjs';
import { library } from './services/library.mjs';
import { startLibraryWatcher } from './services/libraryWatcher.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');
const staticHandler = serveStatic(publicDir);

const apiRouter = createRouter([
  { method: 'GET', pattern: '/api/tracks', handler: listTracks },
  { method: 'GET', pattern: '/api/stream/:id', handler: streamTrack },
  { method: 'HEAD', pattern: '/api/stream/:id', handler: streamTrack },
  { method: 'GET', pattern: '/api/cover/:id', handler: coverTrack },
  { method: 'GET', pattern: '/api/lyrics/:id', handler: getLyrics },
  { method: 'GET', pattern: '/api/events', handler: eventsApi },
]);

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    return apiRouter(req, res);
  }
  return staticHandler(req, res, url.pathname);
});

const { count } = await library.scan();
// 监听音乐目录：增删/替换歌曲后自动重扫，经 SSE 推给前端（不打断正在播放的歌）
const watcher = await startLibraryWatcher(broadcast);
server.listen(config.port, config.host, () => {
  console.log(`Local Player ready, ${count} tracks indexed.`);
  console.log(`Listening on http://${config.host}:${config.port}`);
  console.log(`本机访问 http://localhost:${config.port}`);
  console.log(`音乐目录自动更新已开启（${watcher.mode === 'recursive' ? '递归监听' : '逐目录监听'} + 30 秒兜底轮询）`);
});
