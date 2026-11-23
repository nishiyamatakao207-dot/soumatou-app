import { useEffect, useMemo, useRef, useState } from 'react';
import { listDatedItems } from '../data/repository';
import { describeFilter, filterFromQuery, toMemoryFilter } from '../lib/filter';
import { buildSlides, type Slide } from '../lib/movie';
import { useSetting } from '../lib/settings';
import type { ExportProgress, ExportResult } from '../lib/exporter';

/* 思い出ムービーを動画ファイルにして、LINE などに共有する画面。
 * 書き出しの部品は大きいので、この画面を開いたときに初めて読み込む。 */

type Phase = { kind: 'ready' } | { kind: 'working'; progress: ExportProgress } | { kind: 'done'; result: ExportResult; url: string } | { kind: 'error'; message: string };

const loadExporter = () => import('../lib/exporter');

const mmss = (sec: number) => `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, '0')}秒`;

export function Export({ query }: { query: string }) {
  const filter = useMemo(() => filterFromQuery(query), [query]);
  const [slides, setSlides] = useState<Slide[]>();
  const [estimate, setEstimate] = useState<number>();
  const [method, setMethod] = useState<'fast' | 'realtime' | 'none'>();
  const [showDate, setShowDate] = useSetting('showDate');
  const [phase, setPhase] = useState<Phase>({ kind: 'ready' });
  const [notice, setNotice] = useState<string>();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    (async () => {
      const list = buildSlides(await listDatedItems(toMemoryFilter(filter)));
      setSlides(list);
      const ex = await loadExporter();
      setEstimate(ex.estimateDurationSec(list));
      setMethod(await ex.exportMethod());
    })();
  }, [filter]);

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
  useEffect(() => () => void (phase.kind === 'done' && URL.revokeObjectURL(phase.url)), [phase]);

  async function start() {
    if (!slides?.length) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ kind: 'working', progress: { ratio: 0 } });
    try {
      const ex = await loadExporter();
      const result = await ex.exportMovie({
        slides,
        showDate,
        signal: ctrl.signal,
        onProgress: (progress) => setPhase({ kind: 'working', progress }),
      });
      setPhase({ kind: 'done', result, url: URL.createObjectURL(result.blob) });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setPhase({ kind: 'ready' });
      else setPhase({ kind: 'error', message: e instanceof Error ? e.message : '書き出しに失敗しました' });
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
            写真・動画 {slides ? count : '…'}枚 ・ 長さ {estimate == null ? '計算中…' : `約${mmss(estimate)}`}（動画の長さにより変わります）・ 縦長 720×1280
          </p>
        </section>

        {phase.kind === 'ready' && (
          <>
            <label className="switch dark">
              <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
              <span>写真の日付を入れる</span>
            </label>
            <button className="btn primary big" onClick={start} disabled={!count || method === 'none' || method === undefined}>
              🎬 動画を書き出す
            </button>
            <ul className="notes small muted">
              {method === 'fast' && <li>この端末では、動画の長さより短い時間で書き出せます。</li>}
              {method === 'realtime' && <li>この端末では、動画の長さと同じくらいの時間がかかります。</li>}
              {method === 'none' && <li className="error">この端末・ブラウザは動画の書き出しに対応していません。</li>}
              <li>書き出し中はアプリを開いたままにしてください（画面が消えたり別のアプリに切り替えると止まることがあります）。</li>
              <li>動画の中の音は、今は入りません（BGMの追加は次の段階で対応予定）。</li>
            </ul>
          </>
        )}

        {working && (
          <section className="export-progress" aria-live="polite">
            <div className="bar">
              <div className="bar-fill" style={{ transform: `scaleX(${phase.progress.ratio.toFixed(3)})` }} />
            </div>
            <p>
              書き出し中… {Math.floor(phase.progress.ratio * 100)}%
              {phase.progress.remainingSec != null && <span className="muted">（残り約{mmss(phase.progress.remainingSec)}）</span>}
            </p>
            <button className="btn" onClick={() => abort.current?.abort()}>
              中止する
            </button>
          </section>
        )}

        {phase.kind === 'done' && (
          <section className="export-done">
            <video className="export-preview" src={phase.url} controls playsInline />
            <p className="muted small">
              できあがり：長さ {mmss(phase.result.durationSec)}・大きさ {(phase.result.blob.size / 1024 / 1024).toFixed(1)}MB
            </p>
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
