import { useEffect, useMemo, useState } from 'react';
import { getMedia, listMemories, listTags } from '../data/repository';
import type { Memory } from '../data/types';
import { FilterBar } from '../components/FilterBar';
import { Thumb } from '../components/Thumb';
import { describeFilter, filterFromQuery, filterToQuery, toMemoryFilter, type FilterState } from '../lib/filter';
import { formatDate, formatMonth } from '../lib/format';
import { navigate } from '../router';

export function Timeline({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [memories, setMemories] = useState<Memory[]>();
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    listMemories(toMemoryFilter(filter)).then((m) => setMemories(m.reverse())); // 一覧は新しい順
  }, [filter]);
  useEffect(() => {
    listTags().then(setTags);
  }, []);

  const setFilter = (f: FilterState) => navigate(`/?${filterToQuery(f)}`, true);

  const groups = useMemo(() => {
    const g: { month: string; items: Memory[] }[] = [];
    for (const m of memories ?? []) {
      const month = formatMonth(m.date);
      if (g.at(-1)?.month !== month) g.push({ month, items: [] });
      g.at(-1)!.items.push(m);
    }
    return g;
  }, [memories]);

  const hasFilter = filter.tags.length > 0 || filter.period !== 'all';

  return (
    <div className="screen">
      <header className="topbar">
        <div className="brand">
          <h1 className="logo">めぐる</h1>
          <p className="tagline">声と写真の思い出ムービー</p>
        </div>
        <button className="btn primary" disabled={!memories?.length} onClick={() => navigate(`/play?${filterToQuery(filter)}`)}>
          ▶ 再生
        </button>
      </header>

      <FilterBar value={filter} onChange={setFilter} tags={tags} />
      {hasFilter && (
        <p className="filter-note">
          {describeFilter(filter)}（{memories?.length ?? 0}件）
          <button className="link" onClick={() => setFilter({ tags: [], period: 'all' })}>
            解除
          </button>
        </p>
      )}

      <main className="timeline">
        {memories && memories.length === 0 && (
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
            {g.items.map((m) => (
              <button key={m.id} className="card" onClick={() => navigate(`/edit/${encodeURIComponent(m.id)}`)}>
                <div className="card-media">
                  {m.mediaIds[0] ? <Thumb id={m.mediaIds[0]} /> : <div className="thumb text-only">✎</div>}
                  {m.mediaIds.length > 1 && <span className="count">{m.mediaIds.length}</span>}
                </div>
                <div className="card-body">
                  <div className="card-date">{formatDate(m.date)}</div>
                  <CardText memory={m} />
                  {m.tags.length > 0 && <div className="card-tags">{m.tags.map((t) => `#${t}`).join(' ')}</div>}
                </div>
              </button>
            ))}
          </section>
        ))}
      </main>

      <button className="fab" onClick={() => navigate('/new')} aria-label="思い出を記録">
        ＋
      </button>
    </div>
  );
}

/** 一覧に出す文章：ひとこと、なければ最初の写真のコメント */
function CardText({ memory }: { memory: Memory }) {
  const [caption, setCaption] = useState<string>();
  useEffect(() => {
    if (!memory.text && memory.mediaIds[0]) getMedia(memory.mediaIds[0]).then((x) => setCaption(x?.caption));
  }, [memory]);
  const t = memory.text || caption;
  return t ? <p className="card-text">{t}</p> : null;
}
