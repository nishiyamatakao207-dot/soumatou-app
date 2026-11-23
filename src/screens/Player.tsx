import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMediaFor, listMemories, thumbKey } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { describeFilter, filterFromQuery, toMemoryFilter } from '../lib/filter';
import { formatDate } from '../lib/format';
import { useStoredUrl } from '../lib/useStoredUrl';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '../lib/palette';
import { CircleImage, CircleVideo } from '../components/Circle';

/* 走馬灯：丸く切り抜いた写真が、画面のあちこちにふわっと現れては消えていく。
 * 前の写真が消えるのと次の写真が現れるのを重ねて、途切れずに流れる。
 * 背景は写真の色合いから作り、写真が変わるとゆっくり色が移り変わる。
 *
 * なめらかに動かすため、動き（フェード・漂い・光の粒）はすべてCSSのアニメーションで行い、
 * JavaScript は「いつ次へ進むか」だけを数える。 */

const FADE_MS = 1800; // フェードの長さ（前後の写真が重なる時間）
const PHOTO_MS = 7000; // 写真1枚の表示時間（次の写真が出始めるまでの間隔）
const VIDEO_MAX_MS = 20000; // 動画はここまでで次へ
const BG_FADE_MS = 2600; // 背景の色が移り変わる時間
const COMMENT_SPACE = 150; // 写真の下にコメント用にあける高さ
const TOP_SPACE = 118; // 上のボタンと日付の分
const DRIFT = 16; // 漂う距離（px）

interface Slide {
  key: string;
  memory: Memory;
  media?: MediaItem;
  comment: string;
}

/** 写真の表示時間。フェードで重なる分を足して、写真と写真の間隔がちょうど PHOTO_MS になるようにする */
const photoDwell = () => PHOTO_MS + FADE_MS;

/** スライドごとに毎回同じになる乱数（戻っても同じ位置に出る） */
function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

interface Placement {
  d: number; // 直径
  x: number; // 円の左上
  y: number;
  dx: number; // 漂う向き
  dy: number;
  commentLeft: number; // 円の左端から見たコメントの位置
  commentWidth: number;
}

/** 写真が画面からはみ出さず、下のコメントとも重ならない範囲で位置を決める */
function place(key: string, vw: number, vh: number): Placement {
  const rnd = seeded(key);
  const margin = 8 + DRIFT; // 漂っても画面の端に当たらない余白
  // 円のいちばん外側（約8%）はほぼ透明なので、そこだけは画面の外に出てもよい
  const RIM = 0.08;
  const top = TOP_SPACE;
  const bottom = vh - 16;
  const fitW = (vw - margin * 2) / (1 - RIM * 2);
  const fitH = (bottom - top - COMMENT_SPACE) / (1 - RIM);
  const maxD = Math.max(160, Math.min(fitW, fitH));
  const d = Math.round(maxD * (0.88 + rnd() * 0.12));
  const rim = d * RIM;
  const xMin = margin - rim;
  const xMax = Math.max(xMin, vw - margin - d + rim);
  const yMin = top - rim;
  const yMax = Math.max(yMin, bottom - COMMENT_SPACE - d + rim);
  const x = xMin + (xMax - xMin) * rnd();
  const y = yMin + (yMax - yMin) * rnd();
  const ang = rnd() * Math.PI * 2;
  const commentWidth = Math.min(vw - 32, 520);
  const cx = x + d / 2;
  const left = Math.min(Math.max(cx - commentWidth / 2, 16), vw - 16 - commentWidth);
  return { d, x, y, dx: Math.cos(ang) * DRIFT, dy: Math.sin(ang) * DRIFT, commentLeft: left - x, commentWidth };
}

/** 光の粒（40個）の大きさ・位置・動く速さ。毎回同じ配置になるよう固定の乱数で決める */
const MOTE_COUNT = 40;
const MOTES: React.CSSProperties[] = (() => {
  const rnd = seeded('motes');
  return Array.from({ length: MOTE_COUNT }, () => {
    const size = 6 + Math.round(rnd() * rnd() * 34); // 小さい粒を多めに
    return {
      width: size,
      height: size,
      left: `${(rnd() * 104 - 2).toFixed(1)}%`,
      top: `${(rnd() * 104 - 2).toFixed(1)}%`,
      animationDuration: `${(11 + rnd() * 12).toFixed(1)}s`,
      animationDelay: `${(-rnd() * 20).toFixed(1)}s`,
    };
  });
})();

function useViewport() {
  const get = () => ({ vw: window.innerWidth, vh: window.innerHeight });
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

export function Player({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [slides, setSlides] = useState<Slide[]>();
  const [memCount, setMemCount] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [cur, setCur] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [bgs, setBgs] = useState<number[]>([0]);
  const [palettes, setPalettes] = useState<Record<string, Palette>>({});
  const { vw, vh } = useViewport();
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const memories = await listMemories(toMemoryFilter(filter)); // 古い順
      const list: Slide[] = [];
      for (const m of memories) {
        const media = await getMediaFor(m);
        if (!media.length) list.push({ key: m.id, memory: m, comment: m.text });
        media.forEach((x, i) => list.push({ key: x.id, memory: m, media: x, comment: x.caption || (i === 0 ? m.text : '') }));
      }
      setMemCount(memories.length);
      setSlides(list);
    })();
  }, [filter]);

  // ---- 進行（いつ次へ進むか）----
  const clock = useRef({ t: 0, dwell: PHOTO_MS, leaving: false });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const dwellFor = useCallback(
    (i: number) => {
      const s = slides?.[i];
      if (!s) return photoDwell();
      if (s.media?.kind === 'video') return VIDEO_MAX_MS;
      return photoDwell();
    },
    [slides],
  );

  const goTo = useCallback(
    (n: number) => {
      if (!slides || n < 0 || n >= slides.length) return;
      setPrev(cur);
      setCur(n);
      setBgs((b) => [...b.filter((x) => x !== n).slice(-1), n]);
      clock.current = { t: 0, dwell: dwellFor(n), leaving: false };
    },
    [slides, cur, dwellFor],
  );

  // 前の写真はフェードが終わったら片付ける
  useEffect(() => {
    if (prev === null) return;
    const t = setTimeout(() => setPrev(null), FADE_MS + 100);
    return () => clearTimeout(t);
  }, [prev, cur]);
  // 背景も同じく
  useEffect(() => {
    if (bgs.length < 2) return;
    const t = setTimeout(() => setBgs((b) => b.slice(-1)), BG_FADE_MS + 200);
    return () => clearTimeout(t);
  }, [bgs]);

  useEffect(() => {
    if (!started || finished || !slides) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(80, now - last);
      last = now;
      const c = clock.current;
      if (!pausedRef.current) {
        c.t += dt;
        // 表示時間の終わりごろに次の写真を重ねて出す
        if (cur < slides.length - 1 && c.t >= c.dwell - FADE_MS) {
          goTo(cur + 1);
          return;
        }
        if (cur === slides.length - 1 && c.t >= c.dwell) {
          setFinished(true);
          return;
        }
      }
      if (progressRef.current) {
        const p = (cur + Math.min(1, c.t / c.dwell)) / slides.length;
        progressRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, finished, slides, cur, goTo, dwellFor]);

  // 動画は長さに合わせて表示時間を決め、終わったら次へ
  const onVideoDuration = (i: number, sec: number) => {
    if (i === cur && isFinite(sec) && sec > 0) clock.current.dwell = Math.min(VIDEO_MAX_MS, sec * 1000 + FADE_MS);
  };
  const onVideoEnded = (i: number) => {
    if (i !== cur) return;
    const c = clock.current;
    c.t = Math.max(c.t, c.dwell - FADE_MS);
  };

  const onPalette = useCallback((key: string, img: HTMLImageElement) => {
    setPalettes((p) => (p[key] ? p : { ...p, [key]: extractPalette(img) }));
  }, []);

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
    if (!slides || finished) return;
    if (cur >= slides.length - 1) setFinished(true);
    else goTo(cur + 1);
  }, [slides, finished, cur, goTo]);
  const back = useCallback(() => goTo(cur - 1), [cur, goTo]);

  useEffect(() => {
    const on = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowRight') next();
      else if (ev.key === 'ArrowLeft') back();
      else if (ev.key === ' ') setPaused((p) => !p);
      else if (ev.key === 'Escape') history.back();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [next, back]);

  const restart = () => {
    setPrev(null);
    setCur(0);
    setBgs([0]);
    clock.current = { t: 0, dwell: dwellFor(0), leaving: false };
    setPaused(false);
    setFinished(false);
  };

  const onTap = (e: React.MouseEvent) => {
    const x = e.clientX / window.innerWidth;
    if (x < 0.25) back();
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
        <p className="intro-brand">めぐる</p>
        <p className="intro-sub">{describeFilter(filter)}</p>
        <p className="intro-count">
          {formatDate(slides[0].memory.date)}
          {memCount > 1 && <> 〜 {formatDate(slides.at(-1)!.memory.date)}</>}
          <br />
          {memCount}つの思い出
        </p>
        <button
          className="btn primary big"
          onClick={() => {
            clock.current = { t: 0, dwell: dwellFor(0), leaving: false };
            setStarted(true);
          }}
        >
          ▶ はじめる
        </button>
        <button className="btn ghost" onClick={() => history.back()}>
          戻る
        </button>
      </div>
    );
  }

  const current = slides[cur];
  const curPalette = palettes[current.key] ?? DEFAULT_PALETTE;

  return (
    <div className={`player soumatou ${paused ? 'is-paused' : ''}`}>
      {/* 背景：写真の色から作ったグラデーション。切り替わるとゆっくり移り変わる */}
      {bgs.map((n) => (
        <Background key={`bg${n}`} slide={slides[n]} palette={palettes[slides[n].key] ?? DEFAULT_PALETTE} />
      ))}
      <div className="motes" aria-hidden="true">
        <div className="motes-a" style={{ color: curPalette.glow1 }}>
          {MOTES.filter((_, k) => k % 2 === 0).map((m, k) => (
            <span key={k} style={m} />
          ))}
        </div>
        <div className="motes-b" style={{ color: curPalette.glow2 }}>
          {MOTES.filter((_, k) => k % 2 === 1).map((m, k) => (
            <span key={k} style={m} />
          ))}
        </div>
      </div>

      <div className="stage" onClick={finished ? undefined : onTap}>
        <div key={current.memory.id} className="memory-date">
          {formatDate(current.memory.date)}
          {current.memory.tags.length > 0 && <span>{current.memory.tags.map((t) => `#${t}`).join('  ')}</span>}
        </div>

        {prev !== null && slides[prev] && (
          <SlideView key={slides[prev].key} slide={slides[prev]} index={prev} vw={vw} vh={vh} leaving playing={false} muted />
        )}
        <SlideView
          key={current.key}
          slide={current}
          index={cur}
          vw={vw}
          vh={vh}
          leaving={finished}
          playing={!paused && !finished}
          muted={muted}
          onImage={onPalette}
          onVideoDuration={onVideoDuration}
          onVideoEnded={onVideoEnded}
        />

        {paused && !finished && <div className="pause-mark">❚❚</div>}
      </div>

      <div className="player-top">
        <div className="progress">
          <div ref={progressRef} className="progress-bar" />
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

/** 写真1枚分：ふわっと現れ、漂い、ふわっと消える。コメントは写真の下についていく */
function SlideView({
  slide,
  index,
  vw,
  vh,
  leaving,
  playing,
  muted,
  onImage,
  onVideoDuration,
  onVideoEnded,
}: {
  slide: Slide;
  index: number;
  vw: number;
  vh: number;
  leaving: boolean;
  playing: boolean;
  muted: boolean;
  onImage?: (key: string, img: HTMLImageElement) => void;
  onVideoDuration?: (i: number, sec: number) => void;
  onVideoEnded?: (i: number) => void;
}) {
  const p = useMemo(() => place(slide.key, vw, vh), [slide.key, vw, vh]);
  const media = slide.media;
  const { url, missing } = useStoredUrl(media && !media.missing ? media.id : undefined);
  const lost = !!media && (media.missing || missing);
  const duration = media?.kind === 'video' ? VIDEO_MAX_MS : photoDwell();

  return (
    <div className={`slide ${leaving ? 'out' : 'in'}`}>
      <div
        className="drift"
        style={{
          left: p.x,
          top: p.y,
          width: p.d,
          ['--dx' as string]: `${p.dx.toFixed(1)}px`,
          ['--dy' as string]: `${p.dy.toFixed(1)}px`,
          ['--dur' as string]: `${duration + FADE_MS * 2}ms`,
        }}
      >
        <div className="circle-wrap" style={{ height: p.d }}>
          {(!media || lost) && (
            <div className="circle-text" style={{ width: p.d, height: p.d }}>
              {lost ? '画像が見つかりません' : slide.memory.text}
            </div>
          )}
          {!lost && media?.kind === 'photo' && url && (
            <CircleImage src={url} diameter={p.d} onLoad={(img) => onImage?.(slide.key, img)} />
          )}
          {!lost && media?.kind === 'video' && url && (
            <CircleVideo
              src={url}
              diameter={p.d}
              playing={playing}
              muted={muted}
              onDuration={(s) => onVideoDuration?.(index, s)}
              onEnded={() => onVideoEnded?.(index)}
            />
          )}
        </div>
        {slide.comment && media && (
          <p className="slide-comment" style={{ left: p.commentLeft, width: p.commentWidth, top: p.d * 0.92 - 6 }}>
            {slide.comment}
          </p>
        )}
      </div>
    </div>
  );
}

/** 写真の色合いで作る背景：ぼかした写真＋光のグラデーション */
function Background({ slide, palette }: { slide: Slide; palette: Palette }) {
  const m = slide.media;
  const { url } = useStoredUrl(m && !m.missing && m.hasThumb ? thumbKey(m.id) : undefined);
  return (
    <div className="bg" style={{ backgroundColor: palette.base }}>
      {url && <img className="bg-photo" src={url} alt="" />}
      <div
        className="bg-glow"
        style={{
          background: `radial-gradient(ellipse 70% 50% at 22% 28%, ${palette.glow1} 0%, transparent 70%),
            radial-gradient(ellipse 65% 55% at 80% 74%, ${palette.glow2} 0%, transparent 70%)`,
        }}
      />
      <div className="bg-vignette" />
    </div>
  );
}
