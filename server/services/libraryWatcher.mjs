/**
 * 服务层：音乐目录监听 → 自动重扫（v9）
 *
 * 监听方式（依次降级）：
 *   1. fs.watch(dir, { recursive: true })：Windows / macOS 一直支持，Linux 需 Node ≥ 20；
 *   2. 不支持递归时（Linux + Node 18/19）：给每个子目录各挂一个 fs.watch，每次重扫后同步目录集合；
 *   3. 兜底轮询：每 30 秒比对一次"文件路径 + 大小 + 修改时间"签名（网络盘/某些文件系统不发事件，
 *      或监听出错时也不会漏）。
 *
 * 防抖与"写完再收"：
 *   - 事件到来后等 1.2 秒无新事件才处理（复制一批文件只扫一次）；
 *   - 处理前取两次签名，间隔 1.5 秒，大小或修改时间还在变的文件视为"仍在复制"；
 *     Windows 上再尝试以只读方式打开（复制中的目标文件通常被独占，打开会失败）；
 *   - 仍在复制的文件本轮跳过（新文件暂不加入、旧文件保持原样），2 秒后再查，直到稳定。
 */
import { watch } from 'node:fs';
import { readdir, stat, open } from 'node:fs/promises';
import { join, extname, dirname, basename } from 'node:path';
import { config } from '../core/config.mjs';
import { library, isAudioFile } from './library.mjs';

const DEBOUNCE_MS = 1200;
const STABLE_GAP_MS = 1500;
const RETRY_MS = 2000;
const POLL_MS = 30000;

const isLrc = (p) => extname(p).toLowerCase() === '.lrc';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 递归列出目录与关心的文件（音频 + .lrc） */
async function listTree(dir, out = { dirs: [], files: [] }) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  out.dirs.push(dir);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await listTree(full, out);
    else if (e.isFile() && (isAudioFile(full) || isLrc(full))) out.files.push(full);
  }
  return out;
}

/** 签名：路径 → "大小:修改时间" */
async function snapshot() {
  const tree = await listTree(config.musicDir);
  const sig = new Map();
  for (const f of tree.files) {
    try { const st = await stat(f); sig.set(f, `${st.size}:${Math.round(st.mtimeMs)}`); } catch { /* 刚被删 */ }
  }
  return { sig, dirs: tree.dirs };
}

/** 复制中的文件在 Windows 上通常被独占，只读打开会失败 */
async function isLocked(file) {
  if (process.platform !== 'win32') return false;
  try { const h = await open(file, 'r'); await h.close(); return false; } catch (e) { return e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES'; }
}

/**
 * @param {(event:string, data:object) => void} emit 推送给前端（SSE）
 * @returns {{ mode:string, close():void }}
 */
export async function startLibraryWatcher(emit, log = console.log) {
  let last = await snapshot();         // 上次处理后的签名（用于找出变化的 .lrc 与轮询比对）
  let timer = 0;
  let running = false;
  let again = false;
  let closed = false;
  let mode = 'recursive';
  const dirWatchers = new Map();       // 降级模式：目录 → FSWatcher
  let rootWatcher = null;

  function kick(delay = DEBOUNCE_MS) {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; run(); }, delay);
  }

  async function run() {
    if (running) { again = true; return; }
    running = true;
    try {
      const a = await snapshot();
      await wait(STABLE_GAP_MS);
      const b = await snapshot();
      const unstable = new Set();
      for (const [f, s] of b.sig) {
        if (!isAudioFile(f)) continue;
        if (a.sig.get(f) !== s || (last.sig.get(f) !== s && await isLocked(f))) unstable.add(f);
      }
      const { changed, count } = await library.scan({ skip: unstable });
      if (changed) {
        log(`[library] 音乐库已更新：${count} 首（v${library.version}）`);
        emit('library', { version: library.version, tracks: library.listPublic() });
      }
      // .lrc 变化：找出对应曲目，通知前端重新加载正在显示的歌词
      const lrcChanged = new Set();
      for (const [f, s] of b.sig) if (isLrc(f) && last.sig.get(f) !== s) lrcChanged.add(f);
      for (const f of last.sig.keys()) if (isLrc(f) && !b.sig.has(f)) lrcChanged.add(f);
      if (lrcChanged.size) {
        const stems = new Set([...lrcChanged].map((f) => join(dirname(f), basename(f, extname(f)))));
        const ids = library.all()
          .filter((t) => stems.has(join(dirname(t.filePath), basename(t.filePath, extname(t.filePath)))))
          .map((t) => t.id);
        if (ids.length) emit('lyrics', { ids });
      }
      // 只把"已稳定"的文件记为已处理；仍在复制的下轮再看
      const done = new Map(b.sig);
      for (const f of unstable) { if (last.sig.has(f)) done.set(f, last.sig.get(f)); else done.delete(f); }
      last = { sig: done, dirs: b.dirs };
      if (mode === 'per-dir') syncDirWatchers(b.dirs);
      if (unstable.size) kick(RETRY_MS);
    } catch (e) {
      log(`[library] 重扫失败：${e.message}`);
    } finally {
      running = false;
      if (again) { again = false; kick(); }
    }
  }

  const onEvent = () => kick();

  function syncDirWatchers(dirs) {
    const want = new Set(dirs);
    for (const [d, w] of dirWatchers) if (!want.has(d)) { w.close(); dirWatchers.delete(d); }
    for (const d of want) {
      if (dirWatchers.has(d)) continue;
      try {
        const w = watch(d, onEvent);
        w.on('error', () => { w.close(); dirWatchers.delete(d); kick(); });
        dirWatchers.set(d, w);
      } catch { /* 目录刚被删 */ }
    }
  }

  try {
    // WATCH_MODE=per-dir：强制走降级路径（排查/测试用）
    if (process.env.WATCH_MODE === 'per-dir') throw new Error('forced');
    rootWatcher = watch(config.musicDir, { recursive: true }, onEvent);
    rootWatcher.on('error', (e) => {
      log(`[library] 目录监听出错（${e.code || e.message}），改用逐目录监听 + 轮询`);
      rootWatcher?.close(); rootWatcher = null;
      mode = 'per-dir';
      syncDirWatchers(last.dirs);
      kick();
    });
  } catch {
    mode = 'per-dir';
    syncDirWatchers(last.dirs);
  }

  // 兜底轮询：签名有变化就走同一套流程
  const poll = setInterval(async () => {
    if (running || timer) return;
    try {
      const cur = await snapshot();
      const same = cur.sig.size === last.sig.size && [...cur.sig].every(([f, s]) => last.sig.get(f) === s);
      if (!same) kick(0);
    } catch { /* ignore */ }
  }, POLL_MS);
  poll.unref();

  return {
    get mode() { return mode; },
    close() {
      closed = true;
      clearTimeout(timer); clearInterval(poll);
      rootWatcher?.close();
      for (const w of dirWatchers.values()) w.close();
    },
  };
}
