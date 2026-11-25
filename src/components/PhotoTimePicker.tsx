import { PHOTO_SEC_MAX, PHOTO_SEC_MIN, type PhotoTiming } from '../lib/movie';
import { useSetting } from '../lib/settings';

const PRESETS = [3, 5, 7, 10, 15];

/** 設定の「1枚の表示時間」（設定画面・再生中のメニュー・書き出し画面で使う） */
export function usePhotoTiming(): PhotoTiming {
  const [sec] = useSetting('photoSec');
  const [autoLong] = useSetting('autoLongCaption');
  return { sec, autoLong };
}

/** 1枚の表示時間を選ぶ（よく使う秒数のボタン＋1秒ずつのスライダー）と、字幕が長いときの自動延長 */
export function PhotoTimePicker({ dark }: { dark?: boolean }) {
  const [sec, setSec] = useSetting('photoSec');
  const [autoLong, setAutoLong] = useSetting('autoLongCaption');
  return (
    <div className={`time-picker ${dark ? 'on-dark' : ''}`}>
      <div className="time-head">
        <strong>写真1枚の表示時間</strong>
        <span className="time-value">
          {sec}秒{sec === 7 && <small>（標準）</small>}
        </span>
      </div>
      <div className="chips">
        {PRESETS.map((s) => (
          <button key={s} type="button" className={`chip ${sec === s ? 'on' : ''}`} onClick={() => setSec(s)}>
            {s}秒{s === 7 ? '（標準）' : ''}
          </button>
        ))}
      </div>
      <input
        type="range"
        className="time-range"
        min={PHOTO_SEC_MIN}
        max={PHOTO_SEC_MAX}
        step={1}
        value={sec}
        onChange={(e) => setSec(Number(e.target.value))}
        aria-label="写真1枚の表示時間（秒）"
      />
      <label className="time-auto">
        <input type="checkbox" className="toggle" checked={autoLong} onChange={(e) => setAutoLong(e.target.checked)} />
        <span>
          字幕が長い写真は、読み切れるよう自動で延ばす
          <small>動画素材は、この設定ではなく動画の長さで流れます</small>
        </span>
      </label>
    </div>
  );
}
