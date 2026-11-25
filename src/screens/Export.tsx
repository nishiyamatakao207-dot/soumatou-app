import { useEffect, useMemo, useRef, useState } from 'react';
import { listDatedItems } from '../data/repository';
import { describeFilter, filterFromQuery, toMemoryFilter } from '../lib/filter';
import { buildSlides, type Slide } from '../lib/movie';
import { useSetting } from '../lib/settings';
import type { ExportCaps, ExportProgress, ExportResult } from '../lib/exporter';
import { BgmPicker } from '../components/BgmPicker';
import { createExportAudioContext } from '../lib/bgm';
import { SHAPE_OPTIONS } from '../lib/shape';

/* 思い出ムービーを動画ファイルにして、LINE などに共有する画面。
 * 書き出しの部品は大きいので、この画面を開いたときに初めて読み込む。 */

type Phase = { kind: 'ready' } | { kind: 'working'; progress: ExportProgress } | { kind: 'done'; result: ExportResult; url: string } | { kind: 'error'; message: string };

const loadExporter = () => import('../lib/exporter');

const mmss = (sec: number) => `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, '0')}秒`;
/**
 * 残り時間の表示：細かい秒は出さず「約◯分」（1分未満は「1分以内」）。
 * 見積もりが分の境目を行ったり来たりしても数字がぶれないよう、増やすのは見積もりがはっきり長くなったときだけ。
 */
function useRemainingText() {
  const last = useRef<number | null>(null);
  return (sec: number | undefined) => {
    if (sec == null) {
      last.current = null;
      return null;
    }
    let min = sec < 50 ? 0 : Math.round(sec / 60) || 1;
    const prev = last.current;
    if (prev != null && min > prev && sec < (prev + 0.8) * 60) min = prev;
    last.current = min;
    return min === 0 ? '1分以内' : `約${min}分`;
  };
}

export function Export({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [slides, setSlides] = useState<Slide[]>();
  const [estimate, setEstimate] = useState<number>();
  const [caps, setCaps] = useState<ExportCaps>();
  const [quality, setQuality] = useSetting('exportQuality');
  const [mode, setMode] = useSetting('exportMode');
  const [showDate, setShowDate] = useSetting('showDate');
  const [bgm] = useSetting('bgm');
  const [videoSound, setVideoSound] = useSetting('exportVideoSound');
  const [shape] = useSetting('photoShape');
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const [notice, setNotice] = useState<string>();
  const abort = useRef<AbortController | null>(null);
  const remainingText = useRemainingText();

  useEffect(() => {
    (async () => {
      const list = buildSlides(await listDatedItems(toMemoryFilter(filter)));
      setSlides(list);
      const ex = await loadExporter();
      setEstimate(ex.estimateDurationSec(list));
    })();
  }, [filter]);

  const hasVideos = !!slides?.some((s) => s.media?.kind === 'video' && !s.media.missing);
  const withSound = bgm !== 'none' || (videoSound && hasVideos);
  // この端末でできること（変換機能・高画質・録画）
  useEffect(() => {
    let alive = true;
    loadExporter()
      .then((ex) => ex.exportCapabilities())
      .then((c) => alive && setCaps(c));
    return () => {
      alive = false;
    };
  }, []);
  /** 実際に使う方法（変換機能がない端末では、再生しながら録画） */
  const effectiveMode = caps && !caps.encode ? 'realtime' : mode;
  const effectiveQuality = caps && !caps.high ? 'standard' : quality;
  const none = !!caps && !caps.encode && !caps.realtime;
  /** 選んだ書き出し方で、音を入れられるか（確かめ中は null） */
  const audioOk = !caps ? null : effectiveMode === 'encode' ? caps.encodeAudio : caps.realtimeAudio;
  const audioWarning =
    withSound && audioOk === false
      ? effectiveMode === 'encode' && caps?.realtimeAudio
        ? `この端末（${caps.device}）では、「きれいに書き出す」だと音（BGM・動画の音）が入りません。音を入れたいときは「速い書き出し」を選んでください。`
        : `この端末（${caps?.device}）では、音（BGM・動画の音）が入りません。映像だけの動画になります。`
      : null;

  // 書き出し中は画面を消さない。画面を離れたら中止
  useEffect(() => {
    if (phase.kind !== 'working') return;
    let lock: { release(): Promise<void> } | undefined;
    (navigator as unknown as { wakeLock?: { request(t: string): Promise<typeof lock> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [phase.kind]);
  useEffect(() => () => abort.current?.abort(), []);
  // 書き出し中にアプリから離れたら、戻ってきたときに知らせる
  const [leftWhileWorking, setLeftWhileWorking] = useState(false);
  useEffect(() => {
    if (phase.kind !== 'working') return;
    const on = () => document.visibilityState === 'hidden' && setLeftWhileWorking(true);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [phase.kind]);
  useEffect(() => () => void (phase.kind === 'done' && URL.revokeObjectURL(phase.url)), [phase]);

  async function start() {
    if (!slides?.length) return;
    // 実時間で録画するときの音の出口は、iPhone ではこのタップの中で作る必要がある
    const audioCtx = effectiveMode === 'realtime' && withSound ? createExportAudioContext() : undefined;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLeftWhileWorking(false);
    setPhase({ kind: 'working', progress: { ratio: 0 } });
    try {
      const ex = await loadExporter();
      const result = await ex.exportMovie({
        slides,
        showDate,
        bgm,
        videoSound,
        shape,
        quality: effectiveQuality,
        mode: effectiveMode,
        audioCtx,
        signal: ctrl.signal,
        onProgress: (progress) => setPhase({ kind: 'working', progress }),
      });
      setPhase({ kind: 'done', result, url: URL.createObjectURL(result.blob) });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setPhase({ kind: 'ready' });
      else setPhase({ kind: 'error', message: e instanceof Error ? e.message : '書き出しに失敗しました' });
    } finally {
      void audioCtx?.close().catch(() => {});
    }
  }

  const fileName = (r: ExportResult) => {
    const d = new Date();
    // ファイル名は英数字だけにする（機種によって日本語の名前が崩れるため）
    return `meguru_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.${r.ext}`;
  };

  const file = phase.kind === 'done' ? new File([phase.result.blob], fileName(phase.result), { type: phase.result.mime }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  async function share() {
    if (!file) return;
    setNotice(undefined);
    try {
      // 動画だけを渡す（題名などを一緒に渡すと、動画を受け取らないアプリがあるため）
      await navigator.share({ files: [file] });
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      // 共有メニューを閉じただけ（AbortError）のときは何もしない
      if (name === 'AbortError') return;
      const reason =
        name === 'NotAllowedError'
          ? 'スマホが共有を許可しませんでした。動画が大きすぎる可能性があります。'
          : name === 'DataError' || name === 'TypeError'
            ? 'この動画の形式・大きさでは共有できませんでした。'
            : '共有できませんでした。';
      setNotice(`${reason}「端末に保存する」から保存して、写真アプリから共有してください。（理由コード：${name}）`);
    }
  }

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const count = slides?.length ?? 0;
  const working = phase.kind === 'working';

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()} disabled={working}>
          戻る
        </button>
        <h1 className="title">動画にする</h1>
        <span style={{ width: 64 }} />
      </header>

      <main className="form export">
        <section className="export-summary">
          <p className="export-what">{describeFilter(filter)}</p>
          <p className="muted small">
            写真・動画 {slides ? count : '…'}枚 ・ 長さ {estimate == null ? '計算中…' : `約${mmss(estimate)}`}（動画の長さにより変わります）・ 縦長 {effectiveQuality === 'high' ? '1080×1920' : '720×1280'}
            ・ 写真の形：{SHAPE_OPTIONS.find((o) => o.value === shape)?.label}（設定で変えられます）
          </p>
        </section>

        {phase.kind === 'ready' && (
          <>
            <BgmPicker />
            <label className="switch dark">
              <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
              <span>写真の日付を入れる</span>
            </label>
            {hasVideos && (
              <label className="switch dark">
                <input type="checkbox" checked={videoSound} onChange={(e) => setVideoSound(e.target.checked)} />
                <span>動画素材の元の音（子どもの声など）を入れる</span>
              </label>
            )}
            <fieldset className="choice">
              <legend>書き出し方</legend>
              <label className={`choice-row ${caps && !caps.encode ? 'disabled' : ''}`}>
                <input type="radio" name="mode" checked={effectiveMode === 'encode'} disabled={!!caps && !caps.encode} onChange={() => setMode('encode')} />
                <span>
                  <strong>きれいに書き出す（おすすめ）</strong>
                  <small>1コマずつ丁寧に変換します。{caps && !caps.encode ? 'この端末ではできないため、下の方法になります。' : '多くの場合、動画の長さより短い時間で終わります。'}</small>
                </span>
              </label>
              <label className="choice-row">
                <input type="radio" name="mode" checked={effectiveMode === 'realtime'} onChange={() => setMode('realtime')} />
                <span>
                  <strong>速い書き出し（再生しながら録画）</strong>
                  <small>
                    動画の長さとほぼ同じ時間（約{estimate ? Math.ceil(estimate / 60) : '…'}分）で必ず終わります。書き出し中は画面をつけたまま、アプリを開いたままにしてください。
                  </small>
                </span>
              </label>
            </fieldset>
            <fieldset className="choice">
              <legend>画質</legend>
              <label className="choice-row">
                <input type="radio" name="quality" checked={effectiveQuality === 'standard'} onChange={() => setQuality('standard')} />
                <span>
                  <strong>標準（720p）</strong>
                  <small>スマホで見るのにちょうどよく、ファイルも小さめ（LINEで送りやすい）</small>
                </span>
              </label>
              <label className={`choice-row ${caps && !caps.high ? 'disabled' : ''}`}>
                <input type="radio" name="quality" checked={effectiveQuality === 'high'} disabled={!!caps && !caps.high} onChange={() => setQuality('high')} />
                <span>
                  <strong>高画質（1080p）</strong>
                  <small>{caps && !caps.high ? 'この端末では選べません' : 'テレビなど大きな画面向け。時間とファイルの大きさが約2倍になります'}</small>
                </span>
              </label>
            </fieldset>
            {withSound && !caps && <p className="muted small">この端末で音を入れられるか確かめています…</p>}
            {audioWarning && <p className="error small export-warn">⚠ {audioWarning}</p>}
            <button className="btn primary big" onClick={start} disabled={!count || !caps || none}>
              🎬 動画を書き出す
            </button>
            <ul className="notes small muted">
              {none && <li className="error">この端末・ブラウザは動画の書き出しに対応していません。</li>}
              <li>書き出し中にアプリを閉じたり、別のアプリに切り替えたり、画面が消えたりすると、止まることがあります。終わるまで、この画面のままにしてください。</li>
              <li>
                {bgm === 'none' ? 'BGMなし' : '選んだBGMが最初から最後まで流れ、最後はゆっくり小さくなって終わります'}
                {hasVideos && (videoSound ? '。動画素材の部分では、元の音が聞こえるようにBGMを小さくします。' : '。動画素材の元の音は入れません。')}
              </li>
            </ul>
          </>
        )}

        {working && (
          <section className="export-progress" aria-live="polite">
            <div className="bar">
              <div className="bar-fill" style={{ transform: `scaleX(${phase.progress.ratio.toFixed(3)})` }} />
            </div>
            <p className="export-pct">
              {Math.floor(phase.progress.ratio * 100)}%
              <span className="muted">
                {(() => {
                  const r = remainingText(phase.progress.remainingSec);
                  return r ? `　残り ${r}` : '　残り時間を計算中…';
                })()}
              </span>
            </p>
            {phase.progress.label && <p className="muted small">{phase.progress.label}</p>}
            <p className="muted small">この画面のまま、アプリを開いておいてください。画面は自動で消えないようにしています。</p>
            {leftWhileWorking && (
              <p className="error small">
                {effectiveMode === 'realtime'
                  ? '書き出し中にアプリから離れました。録画は画面に映っている間しか進まないため、動画が途中で止まって見えるかもしれません。できあがったら確認し、おかしければもう一度書き出してください。'
                  : 'アプリから離れている間は、書き出しが止まっていました。このまま続きから進みます。'}
              </p>
            )}
            <button className="btn" onClick={() => abort.current?.abort()}>
              中止する
            </button>
          </section>
        )}

        {phase.kind === 'done' && (
          <section className="export-done">
            {/* 「#t=2」：iPhone で、再生前から最初の写真が見えるようにする（何もしないと真っ黒のまま。最初の0.7秒は黒からのフェード） */}
            <video className="export-preview" src={`${phase.url}#t=2`} preload="metadata" controls playsInline />
            <p className="muted small">
              できあがり：長さ {mmss(phase.result.durationSec)}・大きさ {(phase.result.blob.size / 1024 / 1024).toFixed(1)}MB

              {phase.result.downgraded && '（この端末では高画質に対応していないため、標準画質で書き出しました）'}
            </p>
            <ExportCheck result={phase.result} />
            {leftWhileWorking && effectiveMode === 'realtime' && (
              <p className="error small">録画中にアプリから離れたため、動画の一部が止まって見えるかもしれません。おかしければ、もう一度書き出してください。</p>
            )}
            <details className="export-stats">
              <summary>かかった時間：{mmss(phase.result.stats.seconds)}（内訳）</summary>
              <p>方法：{phase.result.stats.method}・{phase.result.stats.quality}・{phase.result.stats.frames}コマ</p>
              <ul>
                {Object.entries(phase.result.stats.parts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <li key={k}>
                      {k}：{v.toFixed(1)}秒
                    </li>
                  ))}
              </ul>
            </details>
            {canShare && (
              <button className="btn primary big" onClick={share}>
                LINEなどに共有する
              </button>
            )}
            <a className={`btn big ${canShare ? '' : 'primary'}`} href={phase.url} download={file?.name}>
              端末に保存する
            </a>
            {!canShare && <p className="muted small">この画面からは共有メニューを開けません。保存してから、写真アプリなどで共有してください。</p>}
            {isIOS && (
              <p className="muted small">
                iPhoneで「端末に保存する」を押すと「ファイル」アプリの「ダウンロード」に入ります。写真アプリに入れるには、「ファイル」アプリでその動画を開き、共有ボタン →「ビデオを保存」を選んでください。
              </p>
            )}
            <button className="btn ghost" onClick={() => setPhase({ kind: 'ready' })}>
              もう一度書き出す
            </button>
          </section>
        )}

        {phase.kind === 'error' && (
          <section>
            <p className="error">{phase.message}</p>
            <button className="btn" onClick={() => setPhase({ kind: 'ready' })}>
              戻る
            </button>
          </section>
        )}
        {notice && <p className="error">{notice}</p>}
      </main>
    </div>
  );
}

/** できあがった動画の確認結果：BGM・動画素材・元の音が入ったか */
function ExportCheck({ result }: { result: ExportResult }) {
  const r = result.report;
  const shown = r.videos.filter((v) => v.shown).length;
  const soundIn = r.videos.filter((v) => v.sound === '入った').length;
  const ok = (b: boolean) => (b ? '✓' : '✕');
  return (
    <section className="export-check">
      <h2 className="label">確認結果</h2>
      <ul>
        <li>
          {r.bgm == null ? '－ BGM：なし' : `${ok(r.bgm)} BGM：${r.bgm ? '入りました' : '入りませんでした'}`}
        </li>
        {r.videos.length > 0 && (
          <li>
            {ok(shown === r.videos.length)} 動画素材：{r.videos.length}本中{shown}本が映りました
          </li>
        )}
        {r.videos.length > 0 && r.videos.some((v) => v.sound !== '入れない設定') && (
          <li>
            {soundIn > 0 ? '✓' : '－'} 動画素材の元の音：{soundIn}本分が入りました
          </li>
        )}
        {r.fileHasAudio === false && r.bgm != null && <li>✕ できあがった動画に音が入っていません</li>}
      </ul>
      {result.report.audioNote && <p className="error small">音について：{result.report.audioNote}</p>}
      {r.videos.length > 0 && (
        <details>
          <summary>動画素材ごとの結果</summary>
          <ul>
            {r.videos.map((v) => (
              <li key={v.n}>
                {v.n}本目：{v.shown ? '映った' : '映らなかった'}（{v.how}
                {v.note ? `・${v.note}` : ''}）・元の音：{v.sound}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">端末：{r.device}</p>
    </section>
  );
}
