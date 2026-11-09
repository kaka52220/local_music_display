/** API：歌词。返回 { synced, lines:[{time,text}] }；无歌词时返回空结构。 */
import { sendJson } from '../core/http-util.mjs';
import { library } from '../services/library.mjs';
import { loadLyrics } from '../services/lyrics.mjs';

export async function getLyrics(req, res) {
  const track = library.getById(req.params.id);
  if (!track) return sendJson(res, 404, { error: 'track not found' });

  const lyrics = await loadLyrics(track);
  if (!lyrics) return sendJson(res, 200, { synced: false, lines: [] });
  return sendJson(res, 200, lyrics);
}
