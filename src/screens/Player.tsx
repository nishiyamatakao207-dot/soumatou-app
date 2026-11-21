import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMediaFor, listMemories } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { describeFilter, filterFromQuery, toMemoryFilter } from '../lib/filter';
import { formatDate } from '../lib/format';
import { useObjectUrl } from '../lib/useObjectUrl';

const PHOTO_MS = 5000; // 写真1枚の表示時間
const VIDEO_MAX_MS = 20000; // 動画はここまでで次へ
const FADE_MS = 1200; // 切り替えのフェード時間

interface Slide {
  memory: Memory;
  media?: MediaItem;
}

const textOnlyMs = (t: string) => Math.min(9000, Math.max(4000, t.length * 120));

export function Player({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [slides, setSlides] = useState<Slide[]>();
  const [memCount, setMemCount] = useState(0);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0); // 0〜1（今のスライド）
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    (async () => {
      const memories = await listMemories(toMemoryFilter(filter)); // 古い順
      const list: Slide[] = [];
      for (const m of memories) {
        const media = await getMediaFor(m);
        if (media.length) media.forEach((x) => list.push({ memory: m, media: x }));
        else list.push({ memory: m });
      }
      setMemCount(memories.length);
      setSlides(list);
    })();
  }, [filter]);

  // 再生中は画面を消さない
  useEffect(() => {
    if (!started || finished) return;
    let lock: { release(): Promise<void> } | undefined;
    (navigator as unknown as { wakeLock?: { request(t: string): Promise<typeof lock> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [started, finished]);

  const go = useCallback(
    (to: number) => {
      if (!slides) return;
      if (to >= slides.length) {
        setFinished(true);
        return;
      }
      to = Math.max(0, to);
      if (to === index) return;
      setPrev(index);
      setIndex(to);
      setProgress(0);
    },
    [slides, index],
  );

  // 前のスライドはフェードが終わったら消す
  useEffect(() => {
    if (prev === null) return;
    const t = setTimeout(() => setPrev(null), FADE_MS);
    return () => clearTimeout(t);
  }, [prev, index]);

  const current = slides?.[index];
  const isVideo = current?.media?.kind === 'video';

  // 写真・文字だけのスライドのタイマー（一時停止に対応）
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [index, finished]);
  useEffect(() => {
    if (!started || finished || paused || !current || isVideo) return;
    const total = current.media ? PHOTO_MS : textOnlyMs(current.memory.text);
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const p = elapsed.current / total;
      setProgress(Math.min(1, p));
      if (p >= 1) go(index + 1);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, finished, paused, current, isVideo, index, go]);

  // キーボード操作（PCで確認するとき用）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === ' ') setPaused((p) => !p);
      else if (e.key === 'Escape') history.back();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [go, index]);

  const restart = () => {
    setFinished(false);
    setPrev(null);
    setIndex(0);
    setProgress(0);
    setPaused(false);
  };

  const onTap = (e: React.MouseEvent) => {
    const x = e.clientX / window.innerWidth;
    if (x < 0.25) go(index - 1);
    else if (x > 0.75) go(index + 1);
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

  return (
    <div className={`player ${paused ? 'is-paused' : ''}`}>
      <div className="stage" onClick={finished ? undefined : onTap}>
        {prev !== null && slides[prev] && <SlideLayer key={`s${prev}`} slide={slides[prev]} n={prev} leaving muted />}
        {current && (
          <SlideLayer
            key={`s${index}`}
            slide={current}
            n={index}
            paused={paused || finished}
            muted={muted}
            onProgress={setProgress}
            onEnded={() => go(index + 1)}
          />
        )}
        {/* 同じ記録の写真が続く間は字幕を出しっぱなしにし、記録が変わったらフェードイン */}
        {current && !finished && (
          <div key={current.memory.id} className="caption">
            <div className="caption-date">{formatDate(current.memory.date)}</div>
            {current.memory.text && <p className="caption-text">{current.memory.text}</p>}
            {current.memory.tags.length > 0 && <div className="caption-tags">{current.memory.tags.map((t) => `#${t}`).join('  ')}</div>}
          </div>
        )}
        {paused && !finished && <div className="pause-mark">❚❚</div>}
      </div>

      <div className="player-top">
        <div className="progress">
          <div className="progress-bar" style={{ width: `${((index + (finished ? 1 : progress)) / slides.length) * 100}%` }} />
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

function SlideLayer({
  slide,
  n,
  leaving,
  paused,
  muted,
  onProgress,
  onEnded,
}: {
  slide: Slide;
  n: number;
  leaving?: boolean;
  paused?: boolean;
  muted?: boolean;
  onProgress?: (p: number) => void;
  onEnded?: () => void;
}) {
  const src = useObjectUrl(slide.media?.blob);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 動画の再生・一時停止・消音
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (leaving || paused) {
      v.pause();
      return;
    }
    v.muted = !!muted;
    v.play().catch(() => {
      // 音ありの自動再生がブラウザに止められたら、消音で再生
      v.muted = true;
      v.play().catch(() => {});
    });
  }, [leaving, paused, muted, src]);

  // 長い動画は途中で次へ
  const onTime = () => {
    const v = videoRef.current;
    if (!v || leaving) return;
    const limit = Math.min(v.duration || Infinity, VIDEO_MAX_MS / 1000);
    onProgress?.(Math.min(1, v.currentTime / limit));
    if (v.currentTime >= limit) onEnded?.();
  };

  const kenBurns = `kb${n % 4}`;
  const media = slide.media;

  return (
    <div className={`layer ${leaving ? 'leaving' : 'entering'}`}>
      {!media && <div className="layer-text" />}
      {media && src && media.kind === 'photo' && (
        <>
          <img className="backdrop" src={src} alt="" />
          <img className={`photo ${kenBurns}`} src={src} alt="" style={{ animationPlayState: paused ? 'paused' : 'running' }} />
        </>
      )}
      {media && src && media.kind === 'video' && (
        <video
          ref={videoRef}
          className="video"
          src={src}
          playsInline
          muted={muted}
          onTimeUpdate={onTime}
          onEnded={() => !leaving && onEnded?.()}
          onError={() => !leaving && onEnded?.()}
        />
      )}
    </div>
  );
}
