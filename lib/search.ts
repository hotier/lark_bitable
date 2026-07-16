import { pinyin } from 'pinyin-pro';

/** 拼音搜索键：原文 / 全拼 / 首字母 */
interface SearchKeys {
  original: string;
  pinyin: string;
  initials: string;
}

/** 带缓存的拼音查找 */
const keyCache = new Map<string, SearchKeys>();

function getSearchKeys(name: string): SearchKeys {
  const cached = keyCache.get(name);
  if (cached) return cached;

  const lower = name.toLowerCase();
  const py = pinyin(name, { toneType: 'none' }).replace(/\s+/g, '');
  const init = pinyin(name, { pattern: 'first', toneType: 'none' }).replace(/\s+/g, '');
  const pySpaced = pinyin(name, { toneType: 'none' }).trim();

  const keys: SearchKeys = {
    original: lower,
    pinyin: pySpaced.includes(' ') ? `${py}|${pySpaced}` : py,
    initials: init,
  };
  keyCache.set(name, keys);
  return keys;
}

/**
 * 对列表按模糊搜索排序：优先级 原文 > 全拼 > 首字母
 * 无匹配的项会被过滤掉
 */
export function fuzzySort<T>(
  items: T[],
  getName: (item: T) => string,
  query: string,
): T[] {
  // 移除 IME 组合输入时拼音间的分隔符（如 ni'hao → nihao）
  const q = query.toLowerCase().trim().replace(/'/g, '');
  if (!q) return items;

  const scored: { item: T; score: number }[] = [];

  for (const item of items) {
    const name = getName(item);
    const keys = getSearchKeys(name);
    let score = 0;

    if (keys.original.includes(q)) {
      if (keys.original === q) {
        score = 3_000;
      } else if (keys.original.startsWith(q)) {
        score = 2_000;
      } else {
        score = 1_000;
      }
    }

    const pyParts = keys.pinyin.split('|');
    for (const part of pyParts) {
      const idx = part.indexOf(q);
      if (idx !== -1) {
        const pyScore = 500 + (part.length - idx);
        if (pyScore > score) score = pyScore;
      }
    }

    if (score === 0 && keys.initials.includes(q)) {
      score = 100 + keys.initials.indexOf(q);
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

/**
 * 模糊匹配布尔判断（用于复合条件 filter 场景）
 * 匹配顺序：原文 > 全拼 > 首字母
 */
export function fuzzyMatch(name: string, query: string): boolean {
  const q = query.toLowerCase().trim().replace(/'/g, '');
  if (!q) return true;
  const keys = getSearchKeys(name);

  if (keys.original.includes(q)) return true;

  const pyParts = keys.pinyin.split('|');
  for (const part of pyParts) {
    if (part.includes(q)) return true;
  }

  return keys.initials.includes(q);
}
