import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getMediaFor, listMemories } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { describeFilter, filterFromQuery, toMemoryFilter } from '../lib/filter';
import { formatDate } from '../lib/format';
import { useObjectUrl } from '../lib/useObjectUrl';

/* 走馬灯：写真が左から右へゆっくり流れていく。
 * 1枚ずつ中央で少し止まり（ゆっくり漂う）、その間だけ下にコメントがフェードインする。
 * 中央から離れた写真はぼけて薄くなり、写真と写真の間が幻想的にかすむ。 */

const TRAVEL_MS = 2200; // 次の写真へ流れる時間
const DWELL_MS = 4500; // 中央で見せる時間（コメントなし）
const VIDEO_MAX_MS = 20000; // 動画はここまでで次へ
const DRIFT = 0.04; // 止まっている間もわずかに流れ続ける量（1枚分に対する割合）

interface Slide {
  memory: Memory;
  media?: MediaItem;
  /** 写真の下に出すコメント */
  comment: string;
  /** 思い出の最初の1枚か */
  first: boolean;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const readingMs = (text: string) => Math.min(9000, Math.max(DWELL_MS, 2500 + text.length * 110));

function useLayout() {
  const calc = () => {
    const w = Math.min(window.innerWidth * 0.76, 560);
    const h = Math.min(window.innerHeight * 0.5, w * 1.25);
    return { w, h, gap: w * 0.32 };
  };
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const on = () => setSize(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

export function Player({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [slides, setSlides] = useState<Slide[]>();
  const [memCount, setMemCount] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [finished, setFinished] = useState(false);
  /** 今中央にいる写真（流れている途中は直前の番号） */
  const [index, setIndex] = useState(-1);
  /** コメントを出している写真 */
  const [showing, setShowing] = useState<number | null>(null);
  const size = useLayout();

  useEffect(() => {
    (async () => {
      const memories = await listMemories(toMemoryFilter(filter)); // 古い順
      const list: Slide[] = [];
      for (const m of memories) {
        const media = await getMediaFor(m);
        if (!media.length) list.push({ memory: m, comment: '', first: true });
        media.forEach((x, i) =>
          list.push({ memory: m, media: x, first: i === 0, comment: x.caption || (i === 0 ? m.text : '') }),
        );
      }
      setMemCount(memories.length);
      setSlides(list);
    })();
  }, [filter]);

  // ---- 動きの計算（毎フレーム、画面の再描画なしで位置だけ動かす） ----
  const engine = useRef({ i: -1, phase: 'travel' as 'travel' | 'dwell', t: 0, dwellMs: DWELL_MS, p: -1 });
  const itemEls = useRef(new Map<number, HTMLDivElement>());
  const videoEls = useRef(new Map<number, HTMLVideoElement>());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const dwellFor = useCallback(
    (i: number) => {
      const s = slides?.[i];
      if (!s) return DWELL_MS;
      if (s.media?.kind === 'video') return VIDEO_MAX_MS;
      return readingMs(s.comment || (s.media ? '' : s.memory.text));
    },
    [slides],
  );

  const place = useCallback(() => {
    const { p } = engine.current;
    const slot = size.w + size.gap;
    itemEls.current.forEach((el, n) => {
      const d = p - n; // 0 で中央。正なら右側、負なら左側
      const ad = Math.abs(d);
      const x = d * slot;
      const blur = Math.min(16, ad * 16);
      const scale = 1 - Math.min(0.14, ad * 0.12);
      el.style.transform = `translate3d(calc(-50% + ${x}px), -50%, 0) scale(${scale})`;
      el.style.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : 'none';
      el.style.opacity = String(Math.max(0, 1 - ad * 0.7));
    });
  }, [size]);

  const startDwell = useCallback(
    (i: number) => {
      const e = engine.current;
      e.i = i;
      e.phase = 'dwell';
      e.t = 0;
      e.dwellMs = dwellFor(i);
      setIndex(i);
      setShowing(i);
    },
    [dwellFor],
  );

  const startTravel = useCallback(() => {
    const e = engine.current;
    e.phase = 'travel';
    e.t = 0;
    setShowing(null);
  }, []);

  useEffect(() => {
    if (!started || finished || !slides) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const e = engine.current;
      if (!pausedRef.current) {
        e.t += dt;
        if (e.phase === 'dwell' && e.t >= e.dwellMs) {
          if (e.i >= slides.length - 1) {
            setShowing(null);
            setFinished(true);
            return;
          }
          startTravel();
        } else if (e.phase === 'travel' && e.t >= TRAVEL_MS) {
          startDwell(e.i + 1);
        }
        const f = e.phase === 'dwell' ? e.t / e.dwellMs : ease(Math.min(1, e.t / TRAVEL_MS));
        e.p = e.phase === 'dwell' ? e.i - DRIFT + 2 * DRIFT * Math.min(1, f) : e.i + DRIFT + (1 - 2 * DRIFT) * f;
      }
      place();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, finished, slides, place, startDwell, startTravel]);

  useLayoutEffect(() => {
    place();
  });

  // 動画：中央に来たら再生、離れたら止める
  useEffect(() => {
    videoEls.current.forEach((v, n) => {
      if (n === showing && !paused && !finished) {
        v.muted = muted;
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => {});
        });
      } else v.pause();
    });
  }, [showing, paused, muted, finished]);

  const onVideoTime = (n: number) => {
    const v = videoEls.current.get(n);
    const e = engine.current;
    if (!v || e.i !== n || e.phase !== 'dwell') return;
    const limit = Math.min(v.duration || Infinity, VIDEO_MAX_MS / 1000);
    // 動画の長さに合わせて止まる時間を決める
    e.dwellMs = limit * 1000;
    e.t = v.currentTime * 1000;
  };
  const onVideoEnded = (n: number) => {
    const e = engine.current;
    if (e.i === n && e.phase === 'dwell') e.t = e.dwellMs;
  };

  // 画面を消さない
  useEffect(() => {
    if (!started || finished) return;
    let lock: { release(): Promise<void> } | undefined;
    (navigator as unknown as { wakeLock?: { request(t: string): Promise<typeof lock> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [started, finished]);

  const next = useCallback(() => {
    const e = engine.current;
    if (!slides || finished) return;
    if (e.phase === 'travel') startDwell(e.i + 1);
    else if (e.i >= slides.length - 1) e.t = e.dwellMs;
    else startTravel();
  }, [slides, finished, startDwell, startTravel]);

  const prev = useCallback(() => {
    const e = engine.current;
    const to = Math.max(0, e.phase === 'travel' ? e.i : e.i - 1);
    startDwell(to);
    e.p = to - DRIFT;
  }, [startDwell]);

  useEffect(() => {
    const on = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowRight') next();
      else if (ev.key === 'ArrowLeft') prev();
      else if (ev.key === ' ') setPaused((p) => !p);
      else if (ev.key === 'Escape') history.back();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [next, prev]);

  const restart = () => {
    engine.current = { i: -1, phase: 'travel', t: 0, dwellMs: DWELL_MS, p: -1 };
    setIndex(-1);
    setShowing(null);
    setPaused(false);
    setFinished(false);
  };

  const onTap = (e: React.MouseEvent) => {
    const x = e.clientX / window.innerWidth;
    if (x < 0.25) prev();
    else if (x > 0.75) next();
    else setPaused((p) => !p);
  };

  if (!slides) return <div className="player" />;

  if (!slides.length) {
    return (
      <div className="player center">
        <p>再生できる思い出がありません</p>
        <button className="btn" onClick={() => history.back()}>
          戻る
        </button>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="player center intro">
        <div className="intro-mark" />
        <p className="intro-sub">{describeFilter(filter)}</p>
        <p className="intro-count">
          {formatDate(slides[0].memory.date)}
          {memCount > 1 && <> 〜 {formatDate(slides.at(-1)!.memory.date)}</>}
          <br />
          {memCount}つの思い出
        </p>
        <button className="btn primary big" onClick={() => setStarted(true)}>
          ▶ はじめる
        </button>
        <button className="btn ghost" onClick={() => history.back()}>
          戻る
        </button>
      </div>
    );
  }

  // 前後2枚ずつだけ画面に置く（たくさんあっても軽く動くように）
  const center = Math.max(0, index);
  const visible: number[] = [];
  for (let n = center - 2; n <= center + 2; n++) if (n >= 0 && n < slides.length) visible.push(n);
  const current = slides[center];
  const progress = finished ? 1 : (Math.max(0, index) + (showing === null ? 0.5 : 0)) / slides.length;

  return (
    <div className={`player dreamy ${paused ? 'is-paused' : ''}`}>
      <Backdrop slide={current} />
      <div className="bokeh" aria-hidden="true">
        {Array.from({ length: 14 }, (_, k) => (
          <span key={k} style={{ ['--k' as string]: k }} />
        ))}
      </div>

      <div className="stage" onClick={finished ? undefined : onTap}>
        <div key={current.memory.id} className="memory-date">
          {formatDate(current.memory.date)}
          {current.memory.tags.length > 0 && <span>{current.memory.tags.map((t) => `#${t}`).join('  ')}</span>}
        </div>

        {visible.map((n) => (
          <div
            key={n}
            className="flow-item"
            ref={(el) => {
              if (el) itemEls.current.set(n, el);
              else itemEls.current.delete(n);
            }}
            style={{ width: size.w }}
          >
            <FlowMedia
              slide={slides[n]}
              height={size.h}
              videoRef={(v) => {
                if (v) videoEls.current.set(n, v);
                else videoEls.current.delete(n);
              }}
              onTime={() => onVideoTime(n)}
              onEnded={() => onVideoEnded(n)}
            />
            <p className={`flow-comment ${showing === n ? 'show' : ''}`}>{slides[n].comment}</p>
          </div>
        ))}

        {paused && !finished && <div className="pause-mark">❚❚</div>}
      </div>

      <div className="player-top">
        <div className="progress">
          <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="player-buttons">
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? '音を出す' : '消音'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button onClick={() => history.back()} aria-label="閉じる">
            ✕
          </button>
        </div>
      </div>

      {finished && (
        <div className="ending">
          <p className="ending-title">おしまい</p>
          <div className="row">
            <button className="btn primary" onClick={restart}>
              ↻ もう一度
            </button>
            <button className="btn" onClick={() => history.back()}>
              一覧へ戻る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 中央の写真を大きくぼかした背景（写真が変わるとゆっくり入れ替わる） */
function Backdrop({ slide }: { slide: Slide }) {
  const blob = slide.media?.kind === 'photo' ? slide.media.blob : slide.media?.thumb;
  const src = useObjectUrl(blob);
  return <div className="backdrop-wrap">{src && <img key={src} className="backdrop" src={src} alt="" />}</div>;
}

function FlowMedia({
  slide,
  height,
  videoRef,
  onTime,
  onEnded,
}: {
  slide: Slide;
  height: number;
  videoRef: (v: HTMLVideoElement | null) => void;
  onTime: () => void;
  onEnded: () => void;
}) {
  const src = useObjectUrl(slide.media?.blob);
  const media = slide.media;
  return (
    <div className="flow-frame">
      {!media && (
        <div className="flow-text" style={{ maxHeight: height }}>
          {slide.memory.text}
        </div>
      )}
      {media?.kind === 'photo' && src && <img className="flow-photo" src={src} alt="" style={{ maxHeight: height }} />}
      {media?.kind === 'video' && src && (
        <video
          ref={videoRef}
          className="flow-photo"
          src={src}
          style={{ maxHeight: height }}
          playsInline
          onTimeUpdate={onTime}
          onEnded={onEnded}
          onError={onEnded}
        />
      )}
    </div>
  );
}
