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
}

export const EMPTY_FILTER: FilterState = { tags: [], period: 'all' };

export function toMemoryFilter(f: FilterState): MemoryFilter {
  const y = new Date().getFullYear();
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
  return q.toString();
}

export function filterFromQuery(s: string): FilterState {
  const q = new URLSearchParams(s);
  return {
    tags: q.get('tags')?.split(',').filter(Boolean) ?? [],
    period: (q.get('period') as PeriodKey) ?? 'all',
    from: q.get('from') ?? undefined,
    to: q.get('to') ?? undefined,
  };
}

export function describeFilter(f: FilterState): string {
  const parts: string[] = [];
  if (f.period !== 'all') parts.push(f.period === 'custom' ? `${f.from ?? ''}〜${f.to ?? ''}` : PERIOD_LABELS[f.period]);
  if (f.tags.length) parts.push(f.tags.map((t) => `#${t}`).join(' '));
  return parts.join(' ・ ') || 'すべての思い出';
}
