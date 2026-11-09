/**
 * 服务层：音乐库
 * 负责扫描目录、合并元数据、以 id 索引内部 Track；对外只给 DTO。
 * 单例，供 API 层与启动流程共享。
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { config } from '../core/config.mjs';
import { createTrack, toPublicTrack } from '../domain/track.mjs';
import { readMetadata } from './metadata.mjs';

/** 递归列出目录下所有文件。 */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
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

class Library {
  constructor() {
    this._byId = new Map();
  }

  async scan() {
    const all = await walk(config.musicDir);
    const wanted = all.filter((p) =>
      config.supportedFormats.includes(extname(p).toLowerCase()),
    );
    this._byId.clear();

    for (const filePath of wanted) {
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
      this._byId.set(track.id, track);
    }
    return this._byId.size;
  }

  /** 对外 DTO 列表。 */
  listPublic() {
    return [...this._byId.values()].map(toPublicTrack);
  }

  /** 内部 Track（含路径/封面），仅 stream/cover 路由使用。 */
  getById(id) {
    return this._byId.get(id) ?? null;
  }
}

export const library = new Library();
