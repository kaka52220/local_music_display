/** API：高潮点。GET → { time, source, ... } 或 { time: null }；POST { time, source, energy?, v } 写入缓存。 */
import { sendJson } from '../core/http-util.mjs';
import { library } from '../services/library.mjs';
import { getChorus, putChorus } from '../services/chorus.mjs';

export async function getChorusApi(req, res) {
  const track = library.getById(req.params.id);
  if (!track) return sendJson(res, 404, { error: 'track not found' });
  const result = await getChorus(track);
  return sendJson(res, 200, result || { time: null });
}

function readBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function postChorusApi(req, res) {
  const track = library.getById(req.params.id);
  if (!track) return sendJson(res, 404, { error: 'track not found' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  try {
    const entry = await putChorus(track, body);
    return sendJson(res, 200, entry);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
}
