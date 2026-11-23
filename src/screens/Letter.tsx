import { useEffect, useState } from 'react';
import { deleteMemory, getMediaFor, getMemory, isReady, isSealed, openLetter } from '../data/repository';
import type { MediaItem, Memory } from '../data/types';
import { Envelope } from '../components/Envelope';
import { Thumb } from '../components/Thumb';
import { filterToQuery } from '../lib/filter';
import { formatDate } from '../lib/format';
import { countdown } from '../lib/letter';
import { navigate } from '../router';

/**
 * 未来への手紙の画面。
 * - 日付が来るまで：封筒だけ（宛名・開けられる日・残り）。中身は読み込みもしない
 * - 日付が来たら：「開ける」で封筒が開き、中身が出てくる
 */
export function Letter({ id }: { id: string }) {
  const [memory, setMemory] = useState<Memory | null>();
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [confirmThrow, setConfirmThrow] = useState(false);

  useEffect(() => {
    getMemory(id).then((m) => {
      if (!m) return setMemory(null);
      // すでに開けた手紙（普通の記録）は、いつもの編集画面へ
      if (!isSealed(m)) return navigate(`/edit/${encodeURIComponent(id)}`, true);
      setMemory(m);
    });
  }, [id]);

  async function open() {
    if (!memory || !(await openLetter(memory.id))) return;
    setOpening(true);
    const m = (await getMemory(memory.id))!;
    setMedia(await getMediaFor(m));
    setMemory(m);
    // 封筒が開いて便せんが出てくるのを待ってから中身を見せる
    setTimeout(() => setOpened(true), 1700);
  }

  async function throwAway() {
    if (!memory) return;
    await deleteMemory(memory.id);
    navigate('/', true);
  }

  if (memory === undefined) return <div className="screen letter-screen" />;
  if (memory === null) {
    return (
      <div className="screen letter-screen center">
        <p>手紙が見つかりません</p>
        <button className="btn" onClick={() => navigate('/', true)}>
          一覧へ
        </button>
      </div>
    );
  }

  const until = memory.sealedUntil ?? 0;
  const ready = isReady(memory) || opening;

  return (
    <div className="screen letter-screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()}>
          ‹ 戻る
        </button>
        <h1 className="title">未来への手紙</h1>
        <span style={{ width: 64 }} />
      </header>

      <main className="letter-main">
        {!opened && (
          <>
            <p className="letter-kicker">{ready ? '手紙が届きました' : '封をした手紙'}</p>
            <Envelope to={memory.letterTo} ready={ready && !opening} open={opening} />
            {ready ? (
              !opening && (
                <>
                  <p className="letter-when">{formatDate(until)} に開けられるようになりました</p>
                  <button className="btn primary big" onClick={open}>
                    ✉ 手紙を開ける
                  </button>
                </>
              )
            ) : (
              <>
                <p className="letter-when">
                  {formatDate(until)} に開けられます
                  <strong>{countdown(until)}</strong>
                </p>
                <p className="muted small">書いた日：{formatDate(memory.createdAt)}</p>
                <p className="muted small">その日が来るまで、中身は誰も見られません。</p>
              </>
            )}
            {!ready && (
              <div className="letter-throw">
                {confirmThrow ? (
                  <div className="confirm">
                    <p>この手紙を捨てますか？中身を見ないまま消え、元に戻せません。</p>
                    <div className="row">
                      <button className="btn" onClick={() => setConfirmThrow(false)}>
                        やめる
                      </button>
                      <button className="btn danger" onClick={throwAway}>
                        捨てる
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="link" onClick={() => setConfirmThrow(true)}>
                    この手紙を捨てる
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {opened && (
          <article className="letter-paper">
            {memory.letterTo && <p className="letter-to">{memory.letterTo}</p>}
            {memory.text && <p className="letter-text">{memory.text}</p>}
            {media.length > 0 && (
              <div className="letter-photos">
                {media.map((m) => (
                  <div key={m.id} className="letter-photo">
                    <Thumb item={m} />
                    {m.caption && <p>{m.caption}</p>}
                  </div>
                ))}
              </div>
            )}
            <p className="letter-sign">{formatDate(memory.createdAt)} に書いた手紙</p>
            <div className="row">
              {media.length > 0 && (
                <button className="btn primary big" onClick={() => navigate(`/play?${filterToQuery({ tags: [], period: 'all', memory: memory.id })}`)}>
                  ▶ 走馬灯で見る
                </button>
              )}
              <button className="btn big" onClick={() => navigate('/', true)}>
                一覧へ
              </button>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
