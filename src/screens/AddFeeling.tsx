import { useEffect, useState } from 'react';
import { getMediaFor, getMemory, updateMemoryText } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { Thumb } from '../components/Thumb';
import { VoiceText } from '../components/VoiceText';
import { FeelingChips, appendWord } from '../components/FeelingChips';
import { formatDate } from '../lib/format';

/** 写真だけで保存した記録に、あとから気持ちを足す画面（声でも文字でも） */
export function AddFeeling({ id }: { id: string }) {
  const [memory, setMemory] = useState<Memory>();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const m = await getMemory(id);
      if (!m) return history.back();
      setMemory(m);
      setText(m.text);
      setMedia(await getMediaFor(m));
    })();
  }, [id]);

  async function save() {
    setBusy(true);
    await updateMemoryText(id, text.trim());
    history.back();
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()}>
          キャンセル
        </button>
        <h1 className="title">気持ちを足す</h1>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={save}>
          保存
        </button>
      </header>
      <main className="form">
        {memory && <p className="feel-date">{formatDate(memory.date)}</p>}
        {media.length > 0 && (
          <div className="feel-strip">
            {media.slice(0, 8).map((m) => (
              <Thumb key={m.id} item={m} />
            ))}
          </div>
        )}
        <section>
          <h2 className="label">その時の気持ち</h2>
          <VoiceText value={text} onChange={setText} rows={4} placeholder="一言でOK（例：うれしかった！）" />
          <FeelingChips onPick={(w) => setText((t) => appendWord(t, w))} />
        </section>
      </main>
    </div>
  );
}
