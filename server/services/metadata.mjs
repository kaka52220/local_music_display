/**
 * 服务层：元数据解析
 * 封装 music-metadata，作为唯一的元数据来源；任何解析失败都安全回退，不中断建库。
 */
import { parseFile } from 'music-metadata';

/**
 * @returns {{title?:string, artist?:string, album?:string, duration:number,
 *            cover:{mime:string, data:Buffer}|null}}
 */
export async function readMetadata(filePath) {
  try {
    const meta = await parseFile(filePath, { duration: true });
    const common = meta.common ?? {};
    const picture = Array.isArray(common.picture) ? common.picture[0] : null;
    return {
      title: common.title ?? '',
      artist: common.artist ?? '',
      album: common.album ?? '',
      duration: meta.format?.duration ?? 0,
      cover: picture ? { mime: picture.format, data: picture.data } : null,
    };
  } catch {
    // 解析失败时返回空值，由调用方沿用文件名回退结果。
    return { title: '', artist: '', album: '', duration: 0, cover: null };
  }
}
