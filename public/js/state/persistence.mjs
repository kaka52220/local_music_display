/**
 * 状态层：本地会话持久化
 * 唯一职责是封装 localStorage 的读写，保存上次播放的曲目/位置/音量。
 * 不引用引擎与 DOM；存储不可用（隐私模式等）时静默降级，不影响播放。
 */
const STORAGE_KEY = 'local-player/session/v1';

const EMPTY_SESSION = {
  trackId: null,
  position: 0,
  volume: 1,
};

// 探测 localStorage 是否真正可写；不可用时返回 null，后续读写全部安全降级
function getStorage() {
  try {
    const probe = '__lp_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSession() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // 以默认结构兜底，避免旧数据缺字段时产生 undefined
    return { ...EMPTY_SESSION, ...parsed };
  } catch {
    return null;
  }
}

export function saveSession(patch) {
  const storage = getStorage();
  if (!storage) return;
  try {
    const current = loadSession() || { ...EMPTY_SESSION };
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // 写入失败（配额/禁用）时静默，不阻断播放流程
  }
}

export function clearSession() {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
