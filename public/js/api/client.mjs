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

/** 高潮点：服务端缓存 / 歌词 [chorus:] 覆盖；没有时 time 为 null */
export async function fetchChorus(id) {
  try {
    const res = await fetch(`/api/chorus/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Number.isFinite(data?.time) ? data : null;
  } catch { return null; }
}

export async function saveChorus(id, result) {
  try {
    await fetch(`/api/chorus/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  } catch { /* 离线等：只留在本地缓存 */ }
}
