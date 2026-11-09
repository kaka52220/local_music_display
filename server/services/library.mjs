/**
 * 服务层：音乐库
 * 负责扫描目录、合并元数据、以 id 索引内部 Track；对外只给 DTO。
 * 单例，供 API 层、启动流程与目录监听（libraryWatcher）共享。
 *
 * 增量重扫（v9）：按"路径 + 大小 + 修改时间"复用已解析的曲目，只解析新增/变化的文件；
 * 仍在写入（复制中）的文件由调用方通过 skip 传入，本轮保持旧状态（新文件暂不加入）。
 */
import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { config } from '../core/config.mjs';
import { createTrack, toPublicTrack } from '../domain/track.mjs';
import { readMetadata } from './metadata.mjs';

/** 递归列出目录下所有文件；遍历中途被删掉的目录直接跳过。 */
export async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (dir !== config.musicDir && (error.code === 'ENOENT' || error.code === 'EPERM' || error.code === 'EACCES')) return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export const isAudioFile = (p) => config.supportedFormats.includes(extname(p).toLowerCase());

class Library {
  constructor() {
    this._byId = new Map();
    this._sig = new Map(); // id → "size:mtime"（判断文件是否变化）
    this.version = 0;      // 每次曲目列表有变化 +1
  }

  /**
   * 扫描音乐目录。
   * @param {{ skip?: Set<string> }} opts skip：尚未写完的文件路径（保持旧状态）
   * @returns {Promise<{ count:number, changed:boolean }>}
   */
  async scan({ skip } = {}) {
    const all = await walk(config.musicDir);
    const wanted = all.filter(isAudioFile);
    const next = new Map();
    const nextSig = new Map();
    let changed = false;

    for (const filePath of wanted) {
      const id = createTrack(filePath, extname(filePath).toLowerCase()).id;
      const old = this._byId.get(id);
      if (skip?.has(filePath)) {
        if (old) { next.set(id, old); nextSig.set(id, this._sig.get(id)); }
        continue;
      }
      let st;
      try { st = await stat(filePath); } catch { continue; } // 扫描途中被删除
      const sig = `${st.size}:${Math.round(st.mtimeMs)}`;
      if (old && this._sig.get(id) === sig) {
        next.set(id, old); nextSig.set(id, sig);
        continue;
      }
      const track = await this._load(filePath);
      track.rev = Math.round(st.mtimeMs).toString(36); // 封面 URL 带版本：同名文件被替换后不吃浏览器旧缓存
      next.set(id, track);
      nextSig.set(id, sig);
      changed = true;
    }
    if (next.size !== this._byId.size || [...this._byId.keys()].some((id) => !next.has(id))) changed = true;
    // 顺序也算变化（例如重命名后排序位置变化）
    if (!changed) {
      const a = [...this._byId.keys()]; const b = [...next.keys()];
      changed = a.some((id, i) => id !== b[i]);
    }
    this._byId = next;
    this._sig = nextSig;
    if (changed) this.version++;
    return { count: next.size, changed };
  }

  async _load(filePath) {
    const track = createTrack(filePath, extname(filePath).toLowerCase());
    const meta = await readMetadata(filePath);
    if (meta.title) track.title = meta.title;
    if (meta.artist) track.artist = meta.artist;
    if (meta.album) track.album = meta.album;
    if (meta.duration) track.duration = Math.round(meta.duration * 1000) / 1000;
    if (meta.cover) {
      track.cover = meta.cover;
      track.hasCover = true;
    }
    return track;
  }

  /** 对外 DTO 列表。 */
  listPublic() {
    return [...this._byId.values()].map(toPublicTrack);
  }

  /** 内部 Track（含路径/封面），仅 stream/cover 路由使用。 */
  getById(id) {
    return this._byId.get(id) ?? null;
  }

  /** 内部 Track 列表（监听器按 .lrc 找对应曲目用） */
  all() {
    return [...this._byId.values()];
  }
}

export const library = new Library();
