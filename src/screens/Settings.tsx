import { useEffect, useState } from 'react';
import { BgmPicker } from '../components/BgmPicker';
import { ShapePicker } from '../components/ShapePicker';
import { digestAvailable } from '../lib/digest';
import { useSetting } from '../lib/settings';
import { navigate } from '../router';
import { lastBackupAt } from '../lib/backup';
import { formatDate } from '../lib/format';

/** 設定 */
export function Settings() {
  const [dailyDigest, setDailyDigest] = useSetting('dailyDigest');
  const [showDate, setShowDate] = useSetting('showDate');
  const [onThisDay, setOnThisDay] = useSetting('onThisDay');
  const [voiceMethod, setVoiceMethod] = useSetting('voiceMethod');
  const [canDigest, setCanDigest] = useState(false);
  const last = lastBackupAt();
  useEffect(() => {
    digestAvailable().then(setCanDigest);
  }, []);

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()}>
          ‹ 戻る
        </button>
        <h1 className="title">設定</h1>
        <span style={{ width: 64 }} />
      </header>
      <main className="form">
        <section className="setting">
          <label className="setting-row">
            <span>
              <strong>今日のひとめぐり</strong>
              <small>アプリを開いたとき、過去の思い出からランダムに約1分の走馬灯を流します</small>
            </span>
            <input type="checkbox" className="toggle" checked={dailyDigest} onChange={(e) => setDailyDigest(e.target.checked)} />
          </label>
          <button className="btn" disabled={!canDigest} onClick={() => navigate('/digest')}>
            ▶ 今すぐ見る
          </button>
          {!canDigest && <p className="muted small">写真が3枚以上になると見られます。</p>}
        </section>
        <section className="setting">
          <label className="setting-row">
            <span>
              <strong>◯年前の今日</strong>
              <small>去年やおととしの同じ日の記録があれば、アプリを開いたときにお知らせします</small>
            </span>
            <input type="checkbox" className="toggle" checked={onThisDay} onChange={(e) => setOnThisDay(e.target.checked)} />
          </label>
        </section>
        <section className="setting">
          <label className="setting-row">
            <span>
              <strong>写真の日付を表示</strong>
              <small>再生中、字幕の上に小さく日付を出します</small>
            </span>
            <input type="checkbox" className="toggle" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} />
          </label>
        </section>
        <section className="setting">
          <ShapePicker />
        </section>
        <section className="setting">
          <BgmPicker />
        </section>
        <section className="setting">
          <fieldset className="choice bare">
            <legend>
              <strong>「声で入力」のやり方</strong>
            </legend>
            {(
              [
                ['auto', 'おまかせ（おすすめ）', 'アプリの音声認識を使います。iPhoneでうまくいかなかったら、その日はキーボードの音声入力に切り替えます'],
                ['app', 'アプリの音声認識', 'ボタンを押すとすぐ聞き始めます。iPhoneでは、続けて使うと反応しなくなることがあります'],
                ['keyboard', 'キーボードの音声入力', 'ボタンを押すとキーボードが出るので、🎤を押して話します。iPhone本体の機能なので、何回続けても安定して使えます'],
              ] as const
            ).map(([v, label, note]) => (
              <label key={v} className="choice-row">
                <input type="radio" name="voiceMethod" checked={voiceMethod === v} onChange={() => setVoiceMethod(v)} />
                <span>
                  <strong>{label}</strong>
                  <small>{note}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </section>
        <section className="setting">
          <div className="setting-row" onClick={() => navigate('/voicecheck')} role="button" tabIndex={0}>
            <span>
              <strong>音声入力の診断</strong>
              <small>声で入力できないときに、原因を調べるための画面です</small>
            </span>
            <span className="chev">›</span>
          </div>
        </section>
        <section className="setting">
          <div className="setting-row" onClick={() => navigate('/backup')} role="button" tabIndex={0}>
            <span>
              <strong>バックアップ</strong>
              <small>{last ? `最後のバックアップ：${formatDate(last)}` : 'まだバックアップしていません'}</small>
            </span>
            <span className="chev">›</span>
          </div>
        </section>
        <p className="muted small app-version">めぐる　版：{__BUILD__}</p>
      </main>
    </div>
  );
}
