import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listDatedItems, thumbKey } from '../data/repository';
import { describeFilter, filterFromQuery, toMemoryFilter } from '../lib/filter';
import { formatDate, formatDot } from '../lib/format';
import { useSetting } from '../lib/settings';
import { navigate } from '../router';
import { useStoredUrl } from '../lib/useStoredUrl';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '../lib/palette';
import { CircleImage, CircleVideo } from '../components/Circle';
import { BgmPicker } from '../components/BgmPicker';
import { BgmPlayer } from '../lib/bgm';
import { BG_FADE_MS, FADE_MS, MOTES, VIDEO_MAX_MS, PHOTO_MS, buildSlides, driftMs, photoDwell, place, type Slide } from '../lib/movie';

/* 走馬灯：丸く切り抜いた写真が、画面のあちこちにふわっと現れては消えていく。
 * 前の写真が消えるのと次の写真が現れるのを重ねて、途切れずに流れる。
 * 背景は写真の色合いから作り、写真が変わるとゆっくり色が移り変わる。
 *
 * なめらかに動かすため、動き（フェード・漂い・光の粒）はすべてCSSのアニメーションで行い、
 * JavaScript は「いつ次へ進むか」だけを数える。 */

const moteStyle = (m: (typeof MOTES)[number]): React.CSSProperties => ({
  width: m.size,
  height: m.size,
  left: `${m.left.toFixed(1)}%`,
  top: `${m.top.toFixed(1)}%`,
  animationDuration: `${m.dur.toFixed(1)}s`,
  animationDelay: `${(-m.delay).toFixed(1)}s`,
});

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
  const [showDate, setShowDate] = useSetting('showDate');
  const [bgmChoice] = useSetting('bgm');
  const bgm = useRef<BgmPlayer | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      // 写真・動画1枚ごとの日付で、古い順に並べる
      const list = buildSlides(await listDatedItems(toMemoryFilter(filter)));
      setMemCount(new Set(list.map((x) => x.memory.id)).size);
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

  // ---- BGM：一時停止・消音・終わりに合わせる ----
  useEffect(() => () => bgm.current?.dispose(), []);
  useEffect(() => {
    if (!bgm.current || finished) return;
    if (paused) bgm.current.pause();
    else bgm.current.resume();
  }, [paused, finished]);
  useEffect(() => bgm.current?.setMuted(muted), [muted]);
  useEffect(() => {
    if (finished) bgm.current?.fadeOut(2.5);
  }, [finished]);
  // 音のある動画が流れている間は BGM を小さく
  const curIsVideo = slides?.[cur]?.media?.kind === 'video';
  useEffect(() => bgm.current?.duck(curIsVideo && !muted), [curIsVideo, muted]);

  const restart = () => {
    if (bgm.current) {
      bgm.current.resume();
      void bgm.current.play(bgmChoice);
    }
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
          {formatDate(slides[0].date)}
          {slides.at(-1)!.date - slides[0].date > 864e5 / 2 && <> 〜 {formatDate(slides.at(-1)!.date)}</>}
          <br />
          {memCount}つの思い出
        </p>
        <button
          className="btn primary big"
          onClick={() => {
            clock.current = { t: 0, dwell: dwellFor(0), leaving: false };
            if (bgmChoice !== 'none') {
              // iPhone では、このタップの中で音を起こしておく必要がある
              const p = new BgmPlayer();
              p.unlock();
              bgm.current = p;
              void p.play(bgmChoice);
            }
            setStarted(true);
          }}
        >
          ▶ はじめる
        </button>
        <BgmPicker dark />
        <button className="btn" onClick={() => navigate(`/export?${query}`)}>
          🎬 動画にして共有
        </button>
        <label className="switch">
          <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
          <span>再生中に写真の日付を表示する</span>
        </label>
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
            <span key={k} style={moteStyle(m)} />
          ))}
        </div>
        <div className="motes-b" style={{ color: curPalette.glow2 }}>
          {MOTES.filter((_, k) => k % 2 === 1).map((m, k) => (
            <span key={k} style={moteStyle(m)} />
          ))}
        </div>
      </div>

      <div className="stage" onClick={finished ? undefined : onTap}>
        {current.memory.tags.length > 0 && (
          <div key={current.memory.id} className="memory-date">
            <span>{current.memory.tags.map((t) => `#${t}`).join('  ')}</span>
          </div>
        )}

        {prev !== null && slides[prev] && (
          <SlideView key={slides[prev].key} slide={slides[prev]} index={prev} vw={vw} vh={vh} leaving playing={false} muted showDate={showDate} />
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
          showDate={showDate}
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
          <button
            className={`pill ${showDate ? 'on' : ''}`}
            onClick={() => setShowDate(!showDate)}
            aria-pressed={showDate}
            aria-label="日付の表示"
          >
            日付
          </button>
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
  showDate,
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
  showDate: boolean;
  onImage?: (key: string, img: HTMLImageElement) => void;
  onVideoDuration?: (i: number, sec: number) => void;
  onVideoEnded?: (i: number) => void;
}) {
  const p = useMemo(() => place(slide.key, vw, vh), [slide.key, vw, vh]);
  const media = slide.media;
  const { url, missing } = useStoredUrl(media && !media.missing ? media.id : undefined);
  const lost = !!media && (media.missing || missing);

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
          ['--dur' as string]: `${driftMs(slide)}ms`,
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
        {((slide.comment && media) || showDate) && (
          <div className="slide-caption" style={{ left: p.commentLeft, width: p.commentWidth, top: p.d * 0.92 - 6 }}>
            {showDate && <p className="slide-date">{formatDot(slide.date)}</p>}
            {slide.comment && media && <p className="slide-comment">{slide.comment}</p>}
          </div>
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
