import { useEffect, useRef, useState } from 'react';
import {
  NeedPasswordError,
  WrongPasswordError,
  backupFileName,
  backupSummary,
  createBackup,
  inspectBackup,
  lastBackupAt,
  markBackedUp,
  restoreBackup,
  type BackupProgress,
  type RestoreResult,
} from '../lib/backup';
import { formatDate } from '../lib/format';

/** バックアップを作る・戻す画面 */
export function Backup() {
  const [summary, setSummary] = useState<{ memories: number; media: number; files: number; bytes: number }>();
  const [last, setLast] = useState(lastBackupAt());
  const [usePassword, setUsePassword] = useState(true);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [made, setMade] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState<string>();

  // 戻す
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [restorePw, setRestorePw] = useState('');
  const [restored, setRestored] = useState<RestoreResult | null>(null);

  useEffect(() => {
    backupSummary().then(setSummary);
  }, []);
  useEffect(() => () => void (made && URL.revokeObjectURL(made.url)), [made]);

  const pwOk = !usePassword || (pw.length >= 6 && pw === pw2);
  const busy = !!progress;

  async function make() {
    setError(undefined);
    setMade(null);
    setProgress({ ratio: 0, label: '準備中…' });
    try {
      const blob = await createBackup(usePassword ? pw : null, setProgress);
      const file = new File([blob], backupFileName(), { type: 'application/zip' });
      setMade({ file, url: URL.createObjectURL(file) });
    } catch (e) {
      setError(`バックアップを作れませんでした（${e instanceof Error ? e.message : e}）`);
    }
    setProgress(null);
  }

  const done = () => {
    markBackedUp();
    setLast(Date.now());
  };

  const canShare = !!made && typeof navigator.canShare === 'function' && navigator.canShare({ files: [made.file] });
  async function share() {
    if (!made) return;
    try {
      await navigator.share({ files: [made.file] });
      done();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError('共有メニューを開けませんでした。「ダウンロードして保存」をお試しください');
    }
  }

  async function pickRestore(f: File | null) {
    setError(undefined);
    setRestored(null);
    setNeedPw(false);
    setRestorePw('');
    if (!f) return;
    try {
      const m = await inspectBackup(f);
      setRestoreFile(f);
      if (m.encryption) setNeedPw(true);
      else await runRestore(f, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込めませんでした');
    }
  }

  async function runRestore(f: File, password: string | null) {
    setError(undefined);
    setProgress({ ratio: 0, label: '読み込んでいます…' });
    try {
      const r = await restoreBackup(f, password, setProgress);
      setRestored(r);
      setNeedPw(false);
      setRestoreFile(null);
      setSummary(await backupSummary());
    } catch (e) {
      if (e instanceof WrongPasswordError) setError('パスワードが違います');
      else if (e instanceof NeedPasswordError) setNeedPw(true);
      else setError(`戻せませんでした（${e instanceof Error ? e.message : e}）`);
    }
    setProgress(null);
  }

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)}MB`;

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()} disabled={busy}>
          ‹ 戻る
        </button>
        <h1 className="title">バックアップ</h1>
        <span style={{ width: 64 }} />
      </header>

      <main className="form">
        <section className="setting backup-info">
          <p>
            記録 {summary?.memories ?? '…'}件 ・ 写真と動画 {summary?.media ?? '…'}個 ・ 約{summary ? mb(summary.bytes) : '…'}
          </p>
          <p className={last ? 'muted small' : 'error small'}>
            {last ? `前回のバックアップ：${formatDate(last)}` : 'まだバックアップしていません'}
          </p>
          <p className="muted small">
            思い出はこの端末の中だけに保存されています（iCloud には自動で保存されません）。ときどきバックアップを作って、iCloud Drive などに保管してください。
          </p>
          <ul className="backup-notes small">
            <li>ホーム画面の<strong>アプリのアイコンを削除</strong>したり、iPhoneの設定で Safari の<strong>「履歴とWebサイトデータを消去」</strong>をしたりすると、記録が消えます。</li>
            <li><strong>機種変更</strong>のときは、新しいiPhoneでこのアプリを開き、下の「バックアップから戻す」で、保管したファイルから戻してください。</li>
          </ul>
        </section>

        {/* ---- 作る ---- */}
        <section className="setting">
          <h2 className="label">バックアップを作る</h2>
          <label className="setting-row">
            <span>
              <strong>パスワードで鍵をかける（おすすめ）</strong>
              <small>家族の写真や、まだ開けていない手紙の中身を守ります。パスワードを忘れると戻せなくなるので、必ず控えてください。</small>
            </span>
            <input type="checkbox" className="toggle" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
          </label>
          {usePassword && (
            <div className="letter-fields">
              <label className="field">
                <span className="label">パスワード（6文字以上）</span>
                <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">もう一度</span>
                <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </label>
              {pw2 && pw !== pw2 && <p className="error small">パスワードが一致しません</p>}
            </div>
          )}
          <button className="btn primary big" onClick={make} disabled={busy || !pwOk || !summary?.memories}>
            ⤓ バックアップを作る
          </button>

          {made && (
            <div className="backup-made">
              <p>
                ✓ できました：{made.file.name}（{mb(made.file.size)}）{usePassword && '・鍵つき'}
              </p>
              {canShare && (
                <button className="btn primary big" onClick={share}>
                  保存する（ファイル・iCloud Drive など）
                </button>
              )}
              <a className={`btn big ${canShare ? '' : 'primary'}`} href={made.url} download={made.file.name} onClick={done}>
                ダウンロードして保存
              </a>
              <p className="muted small">iPhoneでは共有メニューの「"ファイル"に保存」から、iCloud Drive などを選んでください。</p>
            </div>
          )}
        </section>

        {/* ---- 戻す ---- */}
        <section className="setting">
          <h2 className="label">バックアップから戻す</h2>
          <p className="muted small">この端末にない記録だけを足します。今ある記録はそのまま残ります（同じ記録が2つになることはありません）。</p>
          <button className="btn big" onClick={() => fileRef.current?.click()} disabled={busy}>
            ファイルを選んで戻す
          </button>
          <input ref={fileRef} type="file" accept=".meguru,application/zip,application/octet-stream" hidden onChange={(e) => (pickRestore(e.target.files?.[0] ?? null), (e.target.value = ''))} />
          {needPw && restoreFile && (
            <form
              className="letter-fields"
              onSubmit={(e) => {
                e.preventDefault();
                void runRestore(restoreFile, restorePw);
              }}
            >
              <label className="field">
                <span className="label">このバックアップのパスワード</span>
                <input type="password" autoComplete="current-password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} />
              </label>
              <button className="btn primary big" type="submit" disabled={busy || !restorePw}>
                戻す
              </button>
            </form>
          )}
          {restored && (
            <p className="backup-made">
              ✓ {restored.added}件の記録を戻しました
              {restored.skipped > 0 && `（すでにあった${restored.skipped}件はそのまま）`}
            </p>
          )}
        </section>

        {progress && (
          <section className="export-progress" aria-live="polite">
            <div className="bar">
              <div className="bar-fill" style={{ transform: `scaleX(${progress.ratio.toFixed(3)})` }} />
            </div>
            <p>
              {progress.label} {Math.floor(progress.ratio * 100)}%
            </p>
            <p className="muted small">終わるまでアプリを開いたままにしてください</p>
          </section>
        )}
        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
