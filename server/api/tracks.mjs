/** API：曲目列表（带库版本号，供 SSE 断线重连后判断是否需要重新拉取）。 */
import { sendJson } from '../core/http-util.mjs';
import { library } from '../services/library.mjs';

export function listTracks(req, res) {
  sendJson(res, 200, { version: library.version, tracks: library.listPublic() });
}
