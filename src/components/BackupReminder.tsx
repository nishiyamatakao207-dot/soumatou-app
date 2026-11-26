import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { backupReminderReason, lastBackupAt, snoozeBackupReminder, type BackupReason } from '../lib/backup';
import { formatDate } from '../lib/format';
import { navigate } from '../router';

/** 一覧のバックアップのおすすめ（必要なときだけ、そっと） */
export function BackupReminder() {
  const [reason, setReason] = useState<BackupReason | null>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    (async () => {
      const last = lastBackupAt() ?? 0;
      let total = 0;
      let fresh = 0;
      await db.memories.each((m) => {
        total++;
        if (m.createdAt > last) fresh++;
      });
      setAdded(fresh);
      setReason(backupReminderReason(total, fresh));
    })();
  }, []);
  if (!reason) return null;
  const last = lastBackupAt();
  const text =
    reason === 'never'
      ? '大切な思い出を守るために、バックアップを作りませんか？'
      : reason === 'many'
        ? `前回のバックアップから、新しい記録が${added}件増えました。バックアップを作りませんか？`
        : `前回のバックアップ（${last ? formatDate(last) : ''}）から1か月たちました。バックアップを作りませんか？`;
  return (
    <div className="backup-reminder">
      <span>{text}</span>
      <div className="row">
        <button className="btn small primary" onClick={() => navigate('/backup')}>
          バックアップ
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            snoozeBackupReminder();
            setReason(null);
          }}
        >
          あとで
        </button>
      </div>
    </div>
  );
}
