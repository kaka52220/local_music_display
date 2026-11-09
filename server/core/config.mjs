/**
 * 配置加载层（core）
 * 职责：读取默认配置，并允许用环境变量覆盖。
 * 环境差异（端口、音乐目录）只允许出现在这里，业务层只依赖导出的 config。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
const configFile = resolve(here, '../../config/default.json');
const fileConfig = JSON.parse(readFileSync(configFile, 'utf8'));

// 相对路径统一解析为相对项目根，保证从任意工作目录启动都能找到资源；
// 绝对路径（环境变量或本机定制配置）原样使用，行为不变。
const fromRoot = (p) => (p && isAbsolute(p) ? p : resolve(projectRoot, p || '.'));

export const config = {
  host: process.env.HOST ?? fileConfig.host,
  port: Number(process.env.PORT ?? fileConfig.port),
  musicDir: fromRoot(process.env.MUSIC_DIR ?? fileConfig.musicDir),
  supportedFormats: fileConfig.supportedFormats,
  // 分析结果缓存（高潮点等），默认项目根下 cache/
  cacheDir: fromRoot(process.env.CACHE_DIR ?? fileConfig.cacheDir ?? 'cache'),
};
