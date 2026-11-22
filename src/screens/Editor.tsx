import { useEffect, useRef, useState } from 'react';
import { deleteMemory, getMediaFor, getMemory, listTags, newId, saveMemory } from '../data/repository';
import type { MediaDraft, Memory } from '../data/types';
import { Thumb } from '../components/Thumb';
import { TagPicker } from '../components/TagPicker';
import { importFile } from '../lib/media';
import { VoiceText } from '../components/VoiceText';
import { toLocalInput } from '../lib/format';


export function Editor({ id }: { id?: string }) {
  const [memory, setMemory] = useState<Memory>();
  const [media, setMedia] = useState<MediaDraft[]>([]);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [date, setDate] = useState(() => Date.now());
  /** 日付を自分で変えたら、写真の撮影日で上書きしない */
  const [dateTouched, setDateTouched] = useState(false);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  /** 差し替え中の写真ID */
  const replacing = useRef<string | null>(null);

  useEffect(() => {
    listTags().then(setKnownTags);
    if (!id) return;
    (async () => {
      const m = await getMemory(id);
      if (!m) return history.back();
      setMemory(m);
      setText(m.text);
      setTags(m.tags);
      setDate(m.date);
      setDateTouched(true);
      setMedia(await getMediaFor(m));
    })();
  }, [id]);

  // 撮影日を優先して日付を自動で入れる（いちばん古い撮影日）
  useEffect(() => {
    if (dateTouched) return;
    const taken = media.map((m) => m.takenAt).filter((t): t is number => !!t);
    if (taken.length) setDate(Math.min(...taken));
  }, [media, dateTouched]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setNotice(undefined);
    const added: MediaDraft[] = [];
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        added.push(await importFile(f));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : '読み込めないファイルがありました');
      }
    }
    setMedia((m) => [...m, ...added]);
    if (errors.length) setNotice([...new Set(errors)].join('\n'));
    setBusy(false);
  }

  /** 見つからなくなった写真を、別のファイルで差し替える（コメントは残す） */
  async function onReplace(files: FileList | null) {
    const targetId = replacing.current;
    replacing.current = null;
    const f = files?.[0];
    if (!f || !targetId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const fresh = await importFile(f);
      setMedia((list) => list.map((x) => (x.id === targetId ? { ...fresh, caption: x.caption } : x)));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '読み込めませんでした');
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    const now = Date.now();
    const m: Memory = memory
      ? { ...memory, text: text.trim(), tags, date }
      : { id: newId(), text: text.trim(), tags, date, mediaIds: [], createdAt: now, updatedAt: now };
    try {
      await saveMemory(m, media.map((x) => ({ ...x, caption: x.caption?.trim() || undefined })));
      history.back();
    } catch (e) {
      setBusy(false);
      setNotice(
        e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'QuotaExceeded' || /quota/i.test(e.message))
          ? '端末の保存容量が足りません'
          : e instanceof Error && e.message.includes('保存に失敗')
            ? e.message
            : '保存できませんでした',
      );
    }
  }

  async function remove() {
    if (!memory) return;
    await deleteMemory(memory.id);
    history.back();
  }

  const move = (i: number, d: number) =>
    setMedia((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const canSave = !busy && (media.length > 0 || text.trim().length > 0);

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()}>
          キャンセル
        </button>
        <h1 className="title">{memory ? '思い出を編集' : '思い出を記録'}</h1>
        <button className="btn primary" disabled={!canSave} onClick={save}>
          保存
        </button>
      </header>

      <main className="form">
        <section>
          <h2 className="label">写真・動画</h2>
          <div className="media-list">
            {media.map((m, i) => (
              <div key={m.id} className="media-row">
                <div className="media-cell">
                  <Thumb item={m} />
                  {m.missing && (
                    <button
                      type="button"
                      className="btn small replace-btn"
                      onClick={() => {
                        replacing.current = m.id;
                        replaceRef.current?.click();
                      }}
                      disabled={busy}
                    >
                      差し替え
                    </button>
                  )}
                  <div className="media-actions">
                    <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="前へ">‹</button>
                    <button onClick={() => setMedia((l) => l.filter((x) => x.id !== m.id))} aria-label="外す">×</button>
                    <button onClick={() => move(i, 1)} disabled={i === media.length - 1} aria-label="後へ">›</button>
                  </div>
                </div>
                <VoiceText
                  compact
                  rows={3}
                  value={m.caption ?? ''}
                  onChange={(v) => setMedia((l) => l.map((x) => (x.id === m.id ? { ...x, caption: v } : x)))}
                  placeholder="この写真のコメント（その時の思い）"
                />
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn big" onClick={() => cameraRef.current?.click()} disabled={busy}>
              📷 撮影する
            </button>
            <button className="btn big" onClick={() => libraryRef.current?.click()} disabled={busy}>
              🖼 ライブラリから
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
          <input ref={replaceRef} type="file" accept="image/*,video/*" hidden onChange={(e) => (onReplace(e.target.files), (e.target.value = ''))} />
          <input ref={libraryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
          {busy && <p className="muted small">読み込み中…</p>}
        </section>

        <section>
          <h2 className="label">この思い出のひとこと（なくてもOK）</h2>
          <VoiceText value={text} onChange={setText} rows={3} placeholder="思い出全体について。写真がない記録はここに書きます" />
        </section>

        <section>
          <h2 className="label">日付</h2>
          <input
            type="datetime-local"
            value={toLocalInput(date)}
            onChange={(e) => {
              const t = new Date(e.target.value).getTime();
              if (!isNaN(t)) {
                setDate(t);
                setDateTouched(true);
              }
            }}
          />
          {!dateTouched && media.some((m) => m.takenAt) && <p className="muted small">写真・動画の撮影日から自動で入れました</p>}
        </section>

        <section>
          <h2 className="label">タグ</h2>
          <TagPicker value={tags} onChange={setTags} known={knownTags} />
        </section>

        {notice && <p className="error">{notice}</p>}

        {memory &&
          (confirmDelete ? (
            <div className="confirm">
              <p>この思い出を削除しますか？元に戻せません。</p>
              <div className="row">
                <button className="btn" onClick={() => setConfirmDelete(false)}>
                  やめる
                </button>
                <button className="btn danger" onClick={remove}>
                  削除する
                </button>
              </div>
            </div>
          ) : (
            <button className="btn danger" onClick={() => setConfirmDelete(true)}>
              この思い出を削除
            </button>
          ))}
      </main>
    </div>
  );
}
