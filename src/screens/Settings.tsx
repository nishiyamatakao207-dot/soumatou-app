import { useEffect, useState } from 'react';
import { BgmPicker } from '../components/BgmPicker';
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
          <BgmPicker />
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
      </main>
    </div>
  );
}
