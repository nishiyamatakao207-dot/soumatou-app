import { useMemo, useState } from 'react';
import { Thumb } from '../Thumb';
import { EntryCard } from './EntryCard';
import { monthLabel, type Entry } from '../../lib/entries';
import { dayKey } from '../../lib/format';
import { navigate } from '../../router';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** 月のカレンダー。記録がある日に小さな写真。日付をタップするとその日の記録が開く */
export function CalendarView({
  entries,
  month,
  onMonth,
  onPickMonth,
}: {
  entries: Entry[];
  /** 'YYYY-MM' */
  month: string;
  onMonth: (key: string) => void;
  onPickMonth: () => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const [selected, setSelected] = useState<string | null>(null);

  // 日ごとの記録（古い順）
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      if (e.month !== month) continue;
      const list = map.get(e.day) ?? [];
      list.push(e);
      map.set(e.day, list);
    }
    map.forEach((l) => l.sort((a, b) => a.date - b.date));
    return map;
  }, [entries, month]);
  const count = [...byDay.values()].reduce((n, l) => n + l.length, 0);

  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const today = dayKey(Date.now());

  const shift = (d: number) => {
    const t = new Date(y, m - 1 + d, 1);
    setSelected(null);
    onMonth(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`);
  };

  const tap = (key: string) => {
    const list = byDay.get(key);
    if (!list?.length) return;
    // 1つだけならすぐ開く。いくつかあれば、下に並べて選んでもらう
    if (list.length === 1) navigate(`/edit/${encodeURIComponent(list[0].memory.id)}`);
    else setSelected(selected === key ? null : key);
  };

  return (
    <section className="calendar">
      <div className="cal-head">
        <button className="btn ghost small" onClick={() => shift(-1)} aria-label="前の月">
          ‹
        </button>
        <button className="cal-title" onClick={onPickMonth}>
          {monthLabel(month)} ▾<small>{count ? `${count}件の記録` : '記録なし'}</small>
        </button>
        <button className="btn ghost small" onClick={() => shift(1)} aria-label="次の月">
          ›
        </button>
      </div>
      <div className="cal-grid" role="grid">
        {WEEK.map((w, i) => (
          <div key={w} className={`cal-week ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d == null) return <div key={`e${i}`} className="cal-cell empty" />;
          const key = `${y}-${m}-${d}`;
          const list = byDay.get(key);
          const media = list?.flatMap((e) => e.media)[0];
          const n = list?.length ?? 0;
          return (
            <button
              key={key}
              className={`cal-cell ${n ? 'has' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'on' : ''}`}
              onClick={() => tap(key)}
              disabled={!n}
              aria-label={`${m}月${d}日${n ? `・記録${n}件` : ''}`}
            >
              {media ? <Thumb item={media} className="cal-thumb" /> : n ? <span className="cal-text">✎</span> : null}
              <span className="cal-day">{d}</span>
              {n > 1 && <span className="cal-count">{n}</span>}
            </button>
          );
        })}
      </div>
      {selected && byDay.get(selected) && (
        <div className="cal-list">
          <p className="muted small">この日の記録（{byDay.get(selected)!.length}件）</p>
          {byDay.get(selected)!.map((e) => (
            <EntryCard key={e.key} e={e} />
          ))}
        </div>
      )}
    </section>
  );
}
