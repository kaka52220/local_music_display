/** API：曲目列表。 */
import { sendJson } from '../core/http-util.mjs';
import { library } from '../services/library.mjs';

export function listTracks(req, res) {
  sendJson(res, 200, { tracks: library.listPublic() });
}
