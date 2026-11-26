import { useEffect, useState } from 'react';
import { formatBytes, storageInfo, type StorageInfo } from '../lib/storage';

/** 設定の「使っている容量」：全体と、写真・動画それぞれ */
export function StorageCard() {
  const [info, setInfo] = useState<StorageInfo>();
  const [measuring, setMeasuring] = useState<string>();
  useEffect(() => {
    let alive = true;
    storageInfo((d, t) => alive && setMeasuring(`古い記録の大きさを測っています…（${d}/${t}）`)).then((i) => {
      if (!alive) return;
      setInfo(i);
      setMeasuring(undefined);
    });
    return () => {
      alive = false;
    };
  }, []);

  const media = info ? info.photo.bytes + info.video.bytes : 0;
  const used = info?.usage ?? media;
  const left = info?.quota != null && info.usage != null ? Math.max(0, info.quota - info.usage) : null;
  const ratio = info?.quota ? Math.min(1, used / info.quota) : 0;
  const other = Math.max(0, used - media);

  return (
    <div className="storage-card">
      <strong>使っている容量</strong>
      {!info ? (
        <p className="muted small">{measuring ?? '計算中…'}</p>
      ) : (
        <>
          <p className="storage-main">
            {formatBytes(used)}
            {left != null && <small> ／ 保存できる目安：あと約{formatBytes(left)}</small>}
          </p>
          {info.quota != null && (
            <div className="storage-bar" aria-hidden="true">
              <span className="photo" style={{ width: `${(info.photo.bytes / info.quota) * 100}%` }} />
              <span className="video" style={{ width: `${(info.video.bytes / info.quota) * 100}%` }} />
              <span className="other" style={{ width: `${(other / info.quota) * 100}%` }} />
            </div>
          )}
          <ul className="storage-list">
            <li>
              <i className="dot photo" />
              写真 {info.photo.count}枚：{formatBytes(info.photo.bytes)}
            </li>
            <li>
              <i className="dot video" />
              動画 {info.video.count}本：{formatBytes(info.video.bytes)}
            </li>
            <li>
              <i className="dot other" />
              そのほか（記録の文字・BGMなど）：{formatBytes(other)}
            </li>
          </ul>
          <p className="muted small">
            「保存できる目安」はブラウザが教えてくれる上限（iPhoneでは本体の容量の約60%）からの計算です。iPhoneの空き容量が少ないと、これより早くいっぱいになります。
            {ratio > 0.9 && ' もうすぐいっぱいです。'}
          </p>
        </>
      )}
    </div>
  );
}
