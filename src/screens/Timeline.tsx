import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listDatedItems, listTags } from '../data/repository';
import { FilterBar } from '../components/FilterBar';
import { describeFilter, filterFromQuery, filterToQuery, toMemoryFilter, type FilterState } from '../lib/filter';
import { groupByMonth, monthKeyOf, monthLabel, toEntries, type Entry } from '../lib/entries';
import { navigate } from '../router';
import { startVoice } from '../lib/voiceSession';
import { keyboardVoiceNow } from '../lib/voiceMethod';
import { StarSky } from '../components/StarSky';
import { OnThisDayCard } from '../components/OnThisDayCard';
import { LetterShelf } from '../components/LetterShelf';
import { BackupReminder } from '../components/BackupReminder';
import { EntryCard } from '../components/timeline/EntryCard';
import { MonthPicker } from '../components/timeline/MonthPicker';
import { MonthScrubber } from '../components/timeline/MonthScrubber';
import { CalendarView } from '../components/timeline/CalendarView';

type View = 'list' | 'calendar';
const VIEW_KEY = 'meguru.view';
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    return 'list';
  }
};

/** 上の帯（見出しの下に隠れない位置へ移動するため） */
const topOffset = () => (document.querySelector('.topbar')?.getBoundingClientRect().height ?? 60) + 2;

export function Timeline({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [entries, setEntries] = useState<Entry[]>();
  const [tags, setTags] = useState<string[]>([]);
  /** 気持ちが未入力の記録だけを表示 */
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [view, setViewState] = useState<View>(readView);
  const [picker, setPicker] = useState(false);
  const [calMonth, setCalMonth] = useState<string>();
  const [current, setCurrent] = useState<string>();

  useEffect(() => {
    let alive = true;
    listDatedItems(toMemoryFilter(filter)).then((items) => alive && setEntries(toEntries(items)));
    return () => {
      alive = false;
    };
  }, [filter]);
  useEffect(() => {
    listTags().then(setTags);
  }, []);

  const setFilter = (f: FilterState) => navigate(`/?${filterToQuery(f)}`, true);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* 保存できなくても今回は切り替わる */
    }
  };

  // ---- 検索（打つたびに少し待ってから探す）
  const [q, setQ] = useState(filter.q ?? '');
  /** 最後にこの画面から検索した言葉（打っている途中の文字を、画面の切り替わりで上書きしないため） */
  const sent = useRef(filter.q ?? '');
  useEffect(() => {
    if ((filter.q ?? '') !== sent.current) {
      sent.current = filter.q ?? '';
      setQ(filter.q ?? '');
    }
  }, [filter.q]);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  useEffect(() => {
    const want = q.trim();
    if ((filterRef.current.q ?? '') === want) return;
    const t = setTimeout(() => {
      sent.current = want;
      navigate(`/?${filterToQuery({ ...filterRef.current, q: want || undefined })}`, true);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const searching = !!filter.q;

  const missingCount = useMemo(() => new Set((entries ?? []).filter((e) => e.needsFeeling).map((e) => e.memory.id)).size, [entries]);
  const shown = useMemo(() => (onlyMissing ? (entries ?? []).filter((e) => e.needsFeeling) : entries ?? []), [entries, onlyMissing]);
  const groups = useMemo(() => groupByMonth(shown), [shown]);
  const months = useMemo(() => groups.map((g) => ({ key: g.key, count: g.items.length })), [groups]);

  // ---- 月へ移動
  const jumpTo = useCallback((key: string) => {
    const el = document.getElementById(`m-${key}`);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - topOffset(), behavior: 'auto' });
    setCurrent(key);
  }, []);
  const pick = (key: string) => {
    setPicker(false);
    if (view === 'calendar') setCalMonth(key);
    else requestAnimationFrame(() => jumpTo(key));
  };

  // ---- 今見えている月（右端のスクロールバーの印に使う）
  useEffect(() => {
    if (view !== 'list' || !groups.length) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = topOffset() + 8;
        let cur = groups[0].key;
        for (const g of groups) {
          const el = document.getElementById(`m-${g.key}`);
          if (!el) continue;
          if (el.getBoundingClientRect().top <= top) cur = g.key;
          else break;
        }
        setCurrent(cur);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
    };
  }, [groups, view]);

  /** 「声で入力」：iPhone ではこのタップの中で録音を始める必要がある */
  const kbInput = useRef<HTMLInputElement>(null);
  const recordVoice = () => {
    if (keyboardVoiceNow()) {
      // キーボードの音声入力：このタップの中でキーボードを出しておき、次の画面の入力欄へ引き継ぐ
      kbInput.current?.focus();
      navigate('/new?kb=1');
      return;
    }
    startVoice();
    navigate('/new?voice=1');
  };

  const hasFilter = filter.tags.length > 0 || filter.period !== 'all' || searching;
  const calendarMonth = calMonth ?? groups[0]?.key ?? monthKeyOf(Date.now());
  const memoryCount = useMemo(() => new Set(shown.map((e) => e.memory.id)).size, [shown]);
  const searchBox = useRef<HTMLInputElement>(null);

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

      <div className="search-bar">
        <form
          className="search-box"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            searchBox.current?.blur();
            sent.current = q.trim();
            setFilter({ ...filter, q: q.trim() || undefined });
          }}
        >
          <span aria-hidden="true">🔍</span>
          <input
            ref={searchBox}
            type="search"
            enterKeyHint="search"
            placeholder="言葉・タグで探す"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="言葉やタグで探す"
          />
          {q && (
            <button type="button" className="search-clear" aria-label="検索をやめる" onClick={() => ((sent.current = ''), setQ(''), setFilter({ ...filter, q: undefined }))}>
              ✕
            </button>
          )}
        </form>
        <div className="view-switch" role="tablist" aria-label="表示">
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            一覧
          </button>
          <button role="tab" aria-selected={view === 'calendar'} className={view === 'calendar' ? 'on' : ''} onClick={() => {
              setView('calendar');
              // カレンダーが上の飾りの下に隠れないよう、見える位置へ
              requestAnimationFrame(() => {
                const el = document.querySelector('.calendar, .timeline');
                if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - topOffset() - 8 });
              });
            }}>
            カレンダー
          </button>
        </div>
      </div>

      {!searching && (
        <>
          <StarSky />
          <LetterShelf />
          <OnThisDayCard />
          <BackupReminder />
        </>
      )}

      <FilterBar value={filter} onChange={setFilter} tags={tags} />
      {hasFilter && (
        <div className="filter-note">
          <span>
            {describeFilter(filter)}（{entries ? `${memoryCount}件` : '探しています…'}）
          </span>
          {!!entries?.length && (
            <button className="btn small primary" onClick={() => navigate(`/play?${filterToQuery(filter)}`)}>
              ▶ この結果を再生
            </button>
          )}
          <button className="link" onClick={() => ((sent.current = ''), setQ(''), setFilter({ tags: [], period: 'all' }))}>
            解除
          </button>
        </div>
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

      <main className={`timeline ${view === 'list' && months.length >= 3 ? 'with-scrubber' : ''}`}>
        {entries && entries.length === 0 && (
          <div className="empty">
            {searching ? (
              <p>「{filter.q}」に合う記録は見つかりませんでした。別の言葉やタグでお試しください。</p>
            ) : hasFilter ? (
              <p>この条件の思い出はまだありません。</p>
            ) : (
              <>
                <p className="empty-title">最初の思い出を残しましょう</p>
                <p className="muted">写真や動画と、その時の気持ちを記録すると、あとで思い出ムービーとして見返せます。</p>
              </>
            )}
          </div>
        )}
        {view === 'calendar' && !!entries?.length && (
          <CalendarView entries={shown} month={calendarMonth} onMonth={setCalMonth} onPickMonth={() => setPicker(true)} />
        )}
        {view === 'list' &&
          groups.map((g) => (
            <section key={g.key} id={`m-${g.key}`} className="month-section">
              <button className="month" onClick={() => setPicker(true)} aria-label={`${monthLabel(g.key)}（タップで年・月を選んで移動）`}>
                {monthLabel(g.key)}
                <span className="month-count">{g.items.length}件 ▾</span>
              </button>
              {g.items.map((e) => (
                <EntryCard key={e.key} e={e} />
              ))}
            </section>
          ))}
      </main>

      {view === 'list' && months.length >= 3 && <MonthScrubber months={months.map((m) => m.key)} current={current} onJump={jumpTo} />}
      {picker && (
        <MonthPicker
          months={months}
          current={view === 'calendar' ? calendarMonth : current}
          onPick={pick}
          onClose={() => setPicker(false)}
        />
      )}

      <input ref={kbInput} className="kb-catcher" aria-hidden="true" tabIndex={-1} />
      <div className="record-bar">
        <button className="btn primary big voice-btn" onClick={recordVoice}>
          <span>🎙 声で入力</span>
          <small className="voice-hint">話した言葉が文字になります</small>
        </button>
        <button className="btn big photo-btn" onClick={() => navigate('/new')} aria-label="思い出を記録">
          ＋ 写真で
        </button>
      </div>
    </div>
  );
}
