/** API：内嵌封面（独立接口，避免列表携带大体积二进制）。 */
import { library } from '../services/library.mjs';

export function coverTrack(req, res) {
  const track = library.getById(req.params.id);
  if (!track || !track.cover) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, {
    'Content-Type': track.cover.mime,
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(Buffer.from(track.cover.data));
}
