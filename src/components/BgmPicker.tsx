import { useEffect, useRef, useState } from 'react';
import { BgmPlayer, saveCustomBgm } from '../lib/bgm';
import { BGM_GROUPS, BGM_OPTIONS, warmUp, type BgmChoice } from '../lib/music';
import { useSetting } from '../lib/settings';

/** BGM を選ぶ（再生前の画面と、動画にする画面で使う）。選んだ曲は試聴できる */
export function BgmPicker({ dark }: { dark?: boolean }) {
  const [bgm, setBgm] = useSetting('bgm');
  const [customName, setCustomName] = useSetting('customBgmName');
  const [previewing, setPreviewing] = useState(false);
  /** 曲を作っている・読み込んでいる最中 */
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const player = useRef<BgmPlayer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const stopPreview = () => {
    player.current?.dispose();
    player.current = null;
    setPreviewing(false);
    setPreparing(false);
  };
  useEffect(() => stopPreview, []);
  // 選んだ曲を前もって作っておく（初めての曲は少し時間がかかるため）
  useEffect(() => warmUp(bgm), [bgm]);

  const choose = (v: BgmChoice) => {
    stopPreview();
    setError(undefined);
    if (v === 'custom' && !customName) {
      fileRef.current?.click();
      return;
    }
    setBgm(v);
  };

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveCustomBgm(f);
      setCustomName(f.name);
      setBgm('custom');
    } catch {
      setError('この音楽ファイルは読み込めませんでした（mp3・m4a・wav などをお試しください）');
    }
    setBusy(false);
  }

  function togglePreview() {
    if (previewing) return stopPreview();
    // iPhone では、タップしたその場で音を起こす
    const p = new BgmPlayer();
    p.unlock();
    player.current = p;
    setPreviewing(true);
    setPreparing(true);
    setError(undefined);
    void p.play(bgm).then((ok) => {
      if (player.current !== p) return;
      setPreparing(false);
      if (!ok) {
        stopPreview();
        setError(`曲を再生できませんでした（${p.lastError || '理由不明'}）`);
      }
    });
  }

  const note = BGM_OPTIONS.find((o) => o.value === bgm)?.note;

  return (
    <div className={`bgm-picker ${dark ? 'on-dark' : ''}`}>
      <div className="bgm-head">
        <span className="bgm-label">BGM</span>
        {bgm !== 'none' && (
          <button type="button" className="btn small" onClick={togglePreview} disabled={busy}>
            {previewing ? '■ 試聴をやめる' : '♪ 試聴'}
          </button>
        )}
      </div>
      {/* 「おちついた」「ポップ」「そのほか（なし・自分の曲）」に分けて並べる */}
      {BGM_GROUPS.map((g) => (
        <div key={g.value} className="bgm-group">
          {g.value !== 'other' && <span className="bgm-group-label">{g.label}</span>}
          <div className="chips">
            {BGM_OPTIONS.filter((o) => o.group === g.value).map((o) => (
              <button key={o.value} type="button" className={`chip ${bgm === o.value ? 'on' : ''}`} onClick={() => choose(o.value)} disabled={busy}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {bgm === 'custom' && customName ? (
        <p className="bgm-note">
          ♪ {customName}{' '}
          <button type="button" className="link" onClick={() => fileRef.current?.click()}>
            別の曲にする
          </button>
        </p>
      ) : (
        note && <p className="bgm-note">{note}</p>
      )}
      {bgm === 'custom' && (
        <p className="bgm-note small">
          iPhoneでは「ファイル」アプリに入っている曲を選べます（ミュージックアプリの曲は選べません）。市販の曲を入れた動画を、家族以外へ広く共有するのは避けてください。
        </p>
      )}
      {busy && <p className="bgm-note">読み込み中…</p>}
      {preparing && <p className="bgm-note">♪ 曲を準備中…（初めての曲は数秒〜十数秒かかります）</p>}
      {previewing && !preparing && <p className="bgm-note">♪ 再生中（聞こえないときは、音量ボタンで音を上げてください）</p>}
      {error && <p className="error small">{error}</p>}
      <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => (onFile(e.target.files), (e.target.value = ''))} />
    </div>
  );
}
