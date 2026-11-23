import { useEffect, useMemo, useState } from 'react';
import { listDatedItems, listTags, type DatedItem } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { FilterBar } from '../components/FilterBar';
import { Thumb } from '../components/Thumb';
import { describeFilter, filterFromQuery, filterToQuery, toMemoryFilter, type FilterState } from '../lib/filter';
import { dayKey, formatDate, formatMonth } from '../lib/format';
import { navigate } from '../router';

/** 一覧の1枚のカード：1つの記録のうち、同じ日の写真・動画のまとまり */
interface Entry {
  key: string;
  memory: Memory;
  media: MediaItem[];
  date: number;
  /** 同じ記録に、別の日のカードもある */
  split: boolean;
}

/** 写真1枚ごとの日付で、記録を「日ごと」のカードに分けて新しい順に並べる */
function toEntries(items: DatedItem[]): Entry[] {
  const map = new Map<string, Entry>();
  for (const it of items) {
    const key = `${it.memory.id}|${dayKey(it.date)}`;
    let e = map.get(key);
    if (!e) map.set(key, (e = { key, memory: it.memory, media: [], date: it.date, split: false }));
    if (it.media) e.media.push(it.media);
    e.date = Math.min(e.date, it.date);
  }
  const entries = [...map.values()];
  const perMemory = new Map<string, number>();
  entries.forEach((e) => perMemory.set(e.memory.id, (perMemory.get(e.memory.id) ?? 0) + 1));
  entries.forEach((e) => (e.split = (perMemory.get(e.memory.id) ?? 0) > 1));
  return entries.sort((a, b) => b.date - a.date);
}

export function Timeline({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [entries, setEntries] = useState<Entry[]>();
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    listDatedItems(toMemoryFilter(filter)).then((items) => setEntries(toEntries(items)));
  }, [filter]);
  useEffect(() => {
    listTags().then(setTags);
  }, []);

  const setFilter = (f: FilterState) => navigate(`/?${filterToQuery(f)}`, true);

  const groups = useMemo(() => {
    const g: { month: string; items: Entry[] }[] = [];
    for (const e of entries ?? []) {
      const month = formatMonth(e.date);
      if (g.at(-1)?.month !== month) g.push({ month, items: [] });
      g.at(-1)!.items.push(e);
    }
    return g;
  }, [entries]);

  const hasFilter = filter.tags.length > 0 || filter.period !== 'all';

  return (
    <div className="screen">
      <header className="topbar">
        <div className="brand">
          <h1 className="logo">めぐる</h1>
          <p className="tagline">声と写真の思い出ムービー</p>
        </div>
        <button className="btn primary" disabled={!entries?.length} onClick={() => navigate(`/play?${filterToQuery(filter)}`)}>
          ▶ 再生
        </button>
      </header>

      <FilterBar value={filter} onChange={setFilter} tags={tags} />
      {hasFilter && (
        <p className="filter-note">
          {describeFilter(filter)}（{entries?.length ?? 0}件）
          <button className="link" onClick={() => setFilter({ tags: [], period: 'all' })}>
            解除
          </button>
        </p>
      )}

      <main className="timeline">
        {entries && entries.length === 0 && (
          <div className="empty">
            {hasFilter ? (
              <p>この条件の思い出はまだありません。</p>
            ) : (
              <>
                <p className="empty-title">最初の思い出を残しましょう</p>
                <p className="muted">写真や動画と、その時の気持ちを記録すると、あとで思い出ムービーとして見返せます。</p>
              </>
            )}
          </div>
        )}
        {groups.map((g) => (
          <section key={g.month}>
            <h2 className="month">{g.month}</h2>
            {g.items.map((e) => {
              const text = e.media.find((m) => m.caption)?.caption || e.memory.text;
              return (
                <button key={e.key} className="card" onClick={() => navigate(`/edit/${encodeURIComponent(e.memory.id)}`)}>
                  <div className="card-media">
                    {e.media[0] ? <Thumb item={e.media[0]} /> : <div className="thumb text-only">✎</div>}
                    {e.media.length > 1 && <span className="count">{e.media.length}</span>}
                  </div>
                  <div className="card-body">
                    <div className="card-date">{formatDate(e.date)}</div>
                    {text && <p className="card-text">{text}</p>}
                    {e.memory.tags.length > 0 && <div className="card-tags">{e.memory.tags.map((t) => `#${t}`).join(' ')}</div>}
                    {e.split && <div className="card-split">ほかの日の写真も同じ記録にあります</div>}
                  </div>
                </button>
              );
            })}
          </section>
        ))}
      </main>

      <button className="fab" onClick={() => navigate('/new')} aria-label="思い出を記録">
        ＋
      </button>
    </div>
  );
}
