/**
 * API：服务端推送（SSE，text/event-stream）
 * 前端用 EventSource 订阅；音乐库变化时推送：
 *   event: hello   连接（含断线重连）时发当前库版本，前端版本不同就重新拉列表（补上断线期间的变化）
 *   event: library 曲目列表有变化（data 带完整列表 + 版本号）
 *   event: lyrics  某些曲目的 .lrc 被新增/修改/删除（data.ids），正在显示的歌词据此重新加载
 * 每 25 秒发一行注释心跳，防止代理/系统把空闲连接断掉。
 */
import { library } from '../services/library.mjs';

const clients = new Set();

export function eventsApi(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ version: library.version })}\n\n`);
  clients.add(res);
  const drop = () => clients.delete(res);
  req.on('close', drop);
  res.on('error', drop);
}

export function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { clients.delete(res); }
  }
}

setInterval(() => {
  for (const res of clients) {
    try { res.write(': ping\n\n'); } catch { clients.delete(res); }
  }
}, 25000).unref();
