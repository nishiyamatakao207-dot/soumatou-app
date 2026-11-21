import { useEffect, useRef, useState } from 'react';
import { deleteMemory, getMediaFor, getMemory, listTags, newId, saveMemory } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { Thumb } from '../components/Thumb';
import { TagPicker } from '../components/TagPicker';
import { importFile } from '../lib/media';
import { speechSupported, useSpeechInput } from '../lib/speech';
import { toLocalInput } from '../lib/format';

const MAX_VIDEO_MB = 200;

export function Editor({ id }: { id?: string }) {
  const [memory, setMemory] = useState<Memory>();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [date, setDate] = useState(() => Date.now());
  /** 日付を自分で変えたら、写真の撮影日で上書きしない */
  const [dateTouched, setDateTouched] = useState(false);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

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

  const speech = useSpeechInput((chunk) => setText((t) => (t ? `${t}${/[。！？\s]$/.test(t) ? '' : '。'}` : '') + chunk.trim()));

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setNotice(undefined);
    const added: MediaItem[] = [];
    for (const f of Array.from(files)) {
      if (f.type.startsWith('video/') && f.size > MAX_VIDEO_MB * 1024 * 1024) {
        setNotice(`${MAX_VIDEO_MB}MBを超える動画は追加できません（短めの動画がおすすめです）`);
        continue;
      }
      const item = await importFile(f).catch(() => null);
      if (item) added.push(item);
    }
    setMedia((m) => [...m, ...added]);
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    speech.stop();
    const now = Date.now();
    const m: Memory = memory
      ? { ...memory, text: text.trim(), tags, date }
      : { id: newId(), text: text.trim(), tags, date, mediaIds: [], createdAt: now, updatedAt: now };
    try {
      await saveMemory(m, media);
      history.back();
    } catch (e) {
      setBusy(false);
      setNotice(e instanceof Error && e.name === 'QuotaExceededError' ? '端末の保存容量が足りません' : '保存できませんでした');
    }
  }

  async function remove() {
    if (!memory || !confirm('この思い出を削除しますか？（元に戻せません）')) return;
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
          <div className="media-grid">
            {media.map((m, i) => (
              <div key={m.id} className="media-cell">
                <Thumb item={m} />
                <div className="media-actions">
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="前へ">‹</button>
                  <button onClick={() => setMedia((l) => l.filter((x) => x.id !== m.id))} aria-label="外す">×</button>
                  <button onClick={() => move(i, 1)} disabled={i === media.length - 1} aria-label="後へ">›</button>
                </div>
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
          <input ref={libraryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
          {busy && <p className="muted small">読み込み中…</p>}
        </section>

        <section>
          <h2 className="label">その時の気持ち</h2>
          <textarea
            value={text + (speech.interim ? (text ? '。' : '') + speech.interim : '')}
            onChange={(e) => setText(e.target.value)}
            readOnly={speech.listening}
            rows={5}
            placeholder="うれしかったこと、驚いたこと、子どもの一言…"
          />
          {speechSupported() ? (
            <button className={`btn big mic ${speech.listening ? 'rec' : ''}`} onClick={speech.listening ? speech.stop : speech.start}>
              {speech.listening ? '■ 吹き込みを終える' : '🎙 声で吹き込む'}
            </button>
          ) : (
            <p className="muted small">このブラウザは音声入力に対応していません。キーボードのマイクボタンも使えます。</p>
          )}
          {speech.error && <p className="error small">{speech.error}</p>}
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

        {memory && (
          <button className="btn danger" onClick={remove}>
            この思い出を削除
          </button>
        )}
      </main>
    </div>
  );
}
