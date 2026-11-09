/**
 * 接口层：前端与后端通信的唯一出口
 * UI/引擎不直接拼 URL，只调用这里的方法；后端接口变更时只改本文件。
 */
export async function fetchTracks() {
  const res = await fetch('/api/tracks');
  if (!res.ok) throw new Error('加载曲目失败');
  return res.json(); // { version, tracks }
}

/**
 * 订阅服务端推送（SSE）：音乐库变化 / 歌词文件变化。EventSource 断线后自动重连；
 * 每次（重新）连上都会收到 hello（含库版本），版本不同说明断线期间有变化，交给调用方重新拉取。
 */
export function subscribeEvents({ onHello, onLibrary, onLyrics }) {
  if (typeof EventSource === 'undefined') return () => {};
  const es = new EventSource('/api/events');
  const parse = (fn) => (e) => { try { fn(JSON.parse(e.data)); } catch { /* 忽略坏消息 */ } };
  es.addEventListener('hello', parse(onHello));
  es.addEventListener('library', parse(onLibrary));
  es.addEventListener('lyrics', parse(onLyrics));
  return () => es.close();
}

export async function fetchLyrics(id) {
  const res = await fetch(`/api/lyrics/${id}`);
  if (!res.ok) throw new Error('加载歌词失败');
  return res.json();
}

