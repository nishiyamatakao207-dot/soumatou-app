import { listDatedItems, monthDayOf, type DatedItem } from '../data/repository';
import type { MediaItem } from '../data/types';
import { toMemoryFilter } from './filter';
import { readSetting } from './settings';

/* ◯年前の今日：去年・おととし…の同じ月日の記録を探す */

export interface OnThisDay {
  /** 今日の 'MM-DD' */
  day: string;
  /** 何年前か（新しい順：1, 2, …） */
  yearsAgo: number[];
  /** 写真・記録の数 */
  count: number;
  /** カードに出す写真（最大4枚） */
  thumbs: MediaItem[];
  items: DatedItem[];
}

/** 今日の日付（この端末の時刻で） */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const SHOWN_KEY = 'meguru.otd.shown';
const DISMISSED_KEY = 'meguru.otd.dismissed';

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 保存できなくても動く */
  }
};

export async function findOnThisDay(now = Date.now()): Promise<OnThisDay | null> {
  const day = monthDayOf(now);
  const items = await listDatedItems(toMemoryFilter({ tags: [], period: 'all', day }));
  if (!items.length) return null;
  const thisYear = new Date(now).getFullYear();
  const yearsAgo = [...new Set(items.map((it) => thisYear - new Date(it.date).getFullYear()))].filter((n) => n > 0).sort((a, b) => a - b);
  if (!yearsAgo.length) return null;
  const thumbs = items.filter((it) => it.media && !it.media.missing).map((it) => it.media!).slice(0, 4);
  return { day, yearsAgo, count: items.length, thumbs, items };
}

/** 「1年前・3年前の今日」 */
export const yearsLabel = (y: number[]) => `${y.map((n) => `${n}年前`).join('・')}の今日`;

/** 今日もう大きなお知らせを出したか */
export const shownToday = () => get(SHOWN_KEY) === todayKey();
export const markShown = () => set(SHOWN_KEY, todayKey());
/** 今日はカードを閉じたか */
export const dismissedToday = () => get(DISMISSED_KEY) === todayKey();
export const dismissToday = () => set(DISMISSED_KEY, todayKey());

/** アプリを開いたときに、大きなお知らせを出すべきか（ひとめぐりより優先する） */
export async function shouldAnnounce(): Promise<boolean> {
  if (!readSetting('onThisDay') || shownToday() || dismissedToday()) return false;
  return !!(await findOnThisDay());
}
