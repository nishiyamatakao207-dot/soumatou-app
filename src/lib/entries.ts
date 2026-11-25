import type { DatedItem } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { dayKey } from './format';

/** 一覧の1枚のカード：1つの記録のうち、同じ日の写真・動画のまとまり */
export interface Entry {
  key: string;
  memory: Memory;
  media: MediaItem[];
  date: number;
  /** 'YYYY-M-D'（日ごとにまとめるため） */
  day: string;
  /** 'YYYY-MM'（月ごとにまとめるため） */
  month: string;
  /** 同じ記録に、別の日のカードもある */
  split: boolean;
  /** 気持ちがまだ入っていない記録 */
  needsFeeling: boolean;
}

export const monthKeyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
/** 'YYYY-MM' → 「2026年8月」 */
export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
};

/** 写真1枚ごとの日付で、記録を「日ごと」のカードに分けて新しい順に並べる */
export function toEntries(items: DatedItem[]): Entry[] {
  // 記録ごとに、気持ち（ひとこと・写真のコメント）が入っているか
  const feeling = new Map<string, boolean>();
  for (const it of items) {
    const has = !!it.memory.text.trim() || !!it.media?.caption?.trim();
    feeling.set(it.memory.id, (feeling.get(it.memory.id) ?? false) || has);
  }
  const map = new Map<string, Entry>();
  for (const it of items) {
    const day = dayKey(it.date);
    const key = `${it.memory.id}|${day}`;
    let e = map.get(key);
    if (!e)
      map.set(
        key,
        (e = { key, memory: it.memory, media: [], date: it.date, day, month: monthKeyOf(it.date), split: false, needsFeeling: !feeling.get(it.memory.id) }),
      );
    if (it.media) e.media.push(it.media);
    if (it.date < e.date) e.date = it.date;
  }
  const entries = [...map.values()];
  const perMemory = new Map<string, number>();
  entries.forEach((e) => perMemory.set(e.memory.id, (perMemory.get(e.memory.id) ?? 0) + 1));
  entries.forEach((e) => (e.split = (perMemory.get(e.memory.id) ?? 0) > 1));
  return entries.sort((a, b) => b.date - a.date);
}

/** 月ごとのまとまり（新しい月から） */
export function groupByMonth(entries: Entry[]): { key: string; items: Entry[] }[] {
  const g: { key: string; items: Entry[] }[] = [];
  for (const e of entries) {
    if (g.at(-1)?.key !== e.month) g.push({ key: e.month, items: [] });
    g.at(-1)!.items.push(e);
  }
  return g;
}
