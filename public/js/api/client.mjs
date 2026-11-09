/**
 * 接口层：前端与后端通信的唯一出口
 * UI/引擎不直接拼 URL，只调用这里的方法；后端接口变更时只改本文件。
 */
export async function fetchTracks() {
  const res = await fetch('/api/tracks');
  if (!res.ok) throw new Error('加载曲目失败');
  const data = await res.json();
  return data.tracks;
}

export async function fetchLyrics(id) {
  const res = await fetch(`/api/lyrics/${id}`);
  if (!res.ok) throw new Error('加载歌词失败');
  return res.json();
}
