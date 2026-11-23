import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { lastBackupAt, shouldRemindBackup, snoozeBackupReminder } from '../lib/backup';
import { navigate } from '../router';

/** 一覧のバックアップのおすすめ（ずっと作っていないときだけ、控えめに） */
export function BackupReminder() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    db.memories.count().then((n) => setShow(shouldRemindBackup(n)));
  }, []);
  if (!show) return null;
  const never = !lastBackupAt();
  return (
    <div className="backup-reminder">
      <span>{never ? '大切な思い出を守るために、バックアップを作りませんか？' : '前回のバックアップから30日以上たちました'}</span>
      <div className="row">
        <button className="btn small primary" onClick={() => navigate('/backup')}>
          バックアップ
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            snoozeBackupReminder();
            setShow(false);
          }}
        >
          あとで
        </button>
      </div>
    </div>
  );
}
