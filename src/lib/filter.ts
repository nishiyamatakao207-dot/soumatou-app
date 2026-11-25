import type { MemoryFilter } from '../data/types';

export type PeriodKey = 'all' | 'thisYear' | 'lastYear' | 'last30' | 'custom';

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  all: 'すべての期間',
  thisYear: '今年',
  lastYear: '去年',
  last30: '最近30日',
  custom: '期間を指定',
};

/** 画面の選択状態（URLにも載せられる形） */
export interface FilterState {
  tags: string[];
  period: PeriodKey;
  /** custom のとき 'YYYY-MM-DD' */
  from?: string;
  to?: string;
  /** ◯年前の今日：'MM-DD'（その月日の、去年より前の記録） */
  day?: string;
  /** この記録だけ（未来への手紙を開けたあとに流す） */
  memory?: string;
  /** キーワード検索（気持ちの言葉とタグ） */
  q?: string;
}

/** 2/29 の記録は、うるう年でない年は 2/28 に出す */
export function monthDaysFor(day: string, year = new Date().getFullYear()): string[] {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day === '02-28' && !leap ? ['02-28', '02-29'] : [day];
}

export const EMPTY_FILTER: FilterState = { tags: [], period: 'all' };

export function toMemoryFilter(f: FilterState): MemoryFilter {
  const base = baseMemoryFilter(f);
  return f.q?.trim() ? { ...base, keyword: f.q.trim() } : base;
}

function baseMemoryFilter(f: FilterState): MemoryFilter {
  const y = new Date().getFullYear();
  if (f.memory) return { tags: [], memoryId: f.memory };
  if (f.day) {
    // 今日より前（＝去年以前）の、同じ月日の記録
    const today = new Date();
    return { tags: f.tags, monthDays: monthDaysFor(f.day), to: new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - 1 };
  }
  switch (f.period) {
    case 'thisYear':
      return { tags: f.tags, from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() - 1 };
    case 'lastYear':
      return { tags: f.tags, from: new Date(y - 1, 0, 1).getTime(), to: new Date(y, 0, 1).getTime() - 1 };
    case 'last30':
      return { tags: f.tags, from: Date.now() - 30 * 864e5 };
    case 'custom':
      return {
        tags: f.tags,
        from: f.from ? new Date(`${f.from}T00:00:00`).getTime() : undefined,
        to: f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : undefined,
      };
    default:
      return { tags: f.tags };
  }
}

export function filterToQuery(f: FilterState): string {
  const q = new URLSearchParams();
  if (f.tags.length) q.set('tags', f.tags.join(','));
  if (f.period !== 'all') q.set('period', f.period);
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.day) q.set('day', f.day);
  if (f.memory) q.set('memory', f.memory);
  if (f.q?.trim()) q.set('q', f.q.trim());
  return q.toString();
}

export function filterFromQuery(s: string): FilterState {
  const q = new URLSearchParams(s);
  return {
    tags: q.get('tags')?.split(',').filter(Boolean) ?? [],
    period: (q.get('period') as PeriodKey) ?? 'all',
    from: q.get('from') ?? undefined,
    to: q.get('to') ?? undefined,
    day: q.get('day') ?? undefined,
    memory: q.get('memory') ?? undefined,
    q: q.get('q') ?? undefined,
  };
}

export function describeFilter(f: FilterState): string {
  if (f.memory) return '未来への手紙';
  if (f.day) {
    const [m, d] = f.day.split('-').map(Number);
    return `◯年前の今日（${m}月${d}日）`;
  }
  const parts: string[] = [];
  if (f.period !== 'all') parts.push(f.period === 'custom' ? `${f.from ?? ''}〜${f.to ?? ''}` : PERIOD_LABELS[f.period]);
  if (f.tags.length) parts.push(f.tags.map((t) => `#${t}`).join(' '));
  if (f.q?.trim()) parts.push(`「${f.q.trim()}」で検索`);
  return parts.join(' ・ ') || 'すべての思い出';
}
