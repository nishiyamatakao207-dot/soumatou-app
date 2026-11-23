import { useEffect, useMemo, useState } from 'react';
import { listDatedItems, listTags, type DatedItem } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { FilterBar } from '../components/FilterBar';
import { Thumb } from '../components/Thumb';
import { describeFilter, filterFromQuery, filterToQuery, toMemoryFilter, type FilterState } from '../lib/filter';
import { dayKey, formatDate, formatMonth } from '../lib/format';
import { navigate } from '../router';
import { startVoice } from '../lib/voiceSession';
import { StarSky } from '../components/StarSky';

/** 一覧の1枚のカード：1つの記録のうち、同じ日の写真・動画のまとまり */
interface Entry {
  key: string;
  memory: Memory;
  media: MediaItem[];
  date: number;
  /** 同じ記録に、別の日のカードもある */
  split: boolean;
  /** 気持ちがまだ入っていない記録 */
  needsFeeling: boolean;
}

/** 写真1枚ごとの日付で、記録を「日ごと」のカードに分けて新しい順に並べる */
function toEntries(items: DatedItem[]): Entry[] {
  // 記録ごとに、気持ち（ひとこと・写真のコメント）が入っているか
  const feeling = new Map<string, boolean>();
  for (const it of items) {
    const has = !!it.memory.text.trim() || !!it.media?.caption?.trim();
    feeling.set(it.memory.id, (feeling.get(it.memory.id) ?? false) || has);
  }
  const map = new Map<string, Entry>();
  for (const it of items) {
    const key = `${it.memory.id}|${dayKey(it.date)}`;
    let e = map.get(key);
    if (!e) map.set(key, (e = { key, memory: it.memory, media: [], date: it.date, split: false, needsFeeling: !feeling.get(it.memory.id) }));
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
  /** 気持ちが未入力の記録だけを表示 */
  const [onlyMissing, setOnlyMissing] = useState(false);

  useEffect(() => {
    listDatedItems(toMemoryFilter(filter)).then((items) => setEntries(toEntries(items)));
  }, [filter]);
  useEffect(() => {
    listTags().then(setTags);
  }, []);

  const setFilter = (f: FilterState) => navigate(`/?${filterToQuery(f)}`, true);

  const missingCount = useMemo(() => new Set((entries ?? []).filter((e) => e.needsFeeling).map((e) => e.memory.id)).size, [entries]);
  const shown = useMemo(() => (onlyMissing ? (entries ?? []).filter((e) => e.needsFeeling) : entries ?? []), [entries, onlyMissing]);

  const groups = useMemo(() => {
    const g: { month: string; items: Entry[] }[] = [];
    for (const e of shown) {
      const month = formatMonth(e.date);
      if (g.at(-1)?.month !== month) g.push({ month, items: [] });
      g.at(-1)!.items.push(e);
    }
    return g;
  }, [shown]);

  /** 「声で残す」：iPhone ではこのタップの中で録音を始める必要がある */
  const recordVoice = () => {
    startVoice();
    navigate('/new?voice=1');
  };
  const openEntry = (e: Entry) => navigate(`/edit/${encodeURIComponent(e.memory.id)}`);

  const hasFilter = filter.tags.length > 0 || filter.period !== 'all';

  return (
    <div className="screen">
      <header className="topbar">
        <div className="brand">
          <h1 className="logo">めぐる</h1>
          <p className="tagline">声と写真の思い出ムービー</p>
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="設定">
            ⚙
          </button>
          <button className="btn primary" disabled={!entries?.length} onClick={() => navigate(`/play?${filterToQuery(filter)}`)}>
            ▶ 再生
          </button>
        </div>
      </header>

      <StarSky />

      <FilterBar value={filter} onChange={setFilter} tags={tags} />
      {hasFilter && (
        <p className="filter-note">
          {describeFilter(filter)}（{entries?.length ?? 0}件）
          <button className="link" onClick={() => setFilter({ tags: [], period: 'all' })}>
            解除
          </button>
        </p>
      )}

      {(missingCount > 0 || onlyMissing) && (
        <div className="missing-bar">
          {onlyMissing ? (
            <>
              <span>気持ちが未入力の記録だけを表示中</span>
              <button className="link" onClick={() => setOnlyMissing(false)}>
                すべて表示
              </button>
            </>
          ) : (
            <>
              <span>気持ちが未入力の記録が {missingCount}件</span>
              <button className="link" onClick={() => setOnlyMissing(true)}>
                それだけ表示
              </button>
            </>
          )}
        </div>
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
                <div
                  key={e.key}
                  className={`card ${e.needsFeeling ? 'no-feeling' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEntry(e)}
                  onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && openEntry(e)}
                >
                  <div className="card-media">
                    {e.media[0] ? <Thumb item={e.media[0]} /> : <div className="thumb text-only">✎</div>}
                    {e.media.length > 1 && <span className="count">{e.media.length}</span>}
                  </div>
                  <div className="card-body">
                    <div className="card-date">{formatDate(e.date)}</div>
                    {text && <p className="card-text">{text}</p>}
                    {e.memory.tags.length > 0 && <div className="card-tags">{e.memory.tags.map((t) => `#${t}`).join(' ')}</div>}
                    {e.split && <div className="card-split">ほかの日の写真も同じ記録にあります</div>}
                    {e.needsFeeling && (
                      <button
                        className="btn small add-feel"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/feel/${encodeURIComponent(e.memory.id)}`);
                        }}
                      >
                        ✎ 気持ちを足す
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </main>

      <div className="record-bar">
        <button className="btn primary big voice-btn" onClick={recordVoice}>
          🎙 声で残す
        </button>
        <button className="btn big photo-btn" onClick={() => navigate('/new')} aria-label="思い出を記録">
          ＋ 写真で
        </button>
      </div>
    </div>
  );
}
