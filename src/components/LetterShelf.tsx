import { useEffect, useState } from 'react';
import { isReady, listLetters } from '../data/repository';
import type { Memory } from '../data/types';
import { formatDate } from '../lib/format';
import { countdown } from '../lib/letter';
import { markAnnounced } from '../lib/letterNotice';
import { navigate } from '../router';
import { Envelope } from './Envelope';

/** アプリを開いてから最初の1回だけ、大きなお知らせを出す */
let launchChecked = false;

/** 一覧の「未来への手紙」。封筒だけを並べ、開けられる手紙があれば大きくお知らせする */
export function LetterShelf() {
  const [letters, setLetters] = useState<Memory[]>([]);
  const [arrived, setArrived] = useState<Memory[]>([]);

  useEffect(() => {
    const atLaunch = !launchChecked;
    launchChecked = true;
    listLetters().then((list) => {
      setLetters(list);
      if (!atLaunch) return;
      let done: string[] = [];
      try {
        done = JSON.parse(localStorage.getItem('meguru.letter.announced') ?? '[]');
      } catch {
        /* 読めなければ全部お知らせ */
      }
      const fresh = list.filter((m) => isReady(m) && !done.includes(m.id));
      if (fresh.length) setArrived(fresh);
    });
  }, []);

  if (!letters.length) return null;
  const open = (m: Memory) => navigate(`/letter/${encodeURIComponent(m.id)}`);

  return (
    <>
      <section className="letter-shelf" aria-label="未来への手紙">
        <h2>✉ 未来への手紙 {letters.length}通</h2>
        {letters.map((m) => {
          const ready = isReady(m);
          return (
            <button key={m.id} className={`letter-row ${ready ? 'ready' : ''}`} onClick={() => open(m)}>
              <Envelope small ready={ready} />
              <span className="letter-row-text">
                <strong>{m.letterTo || '未来への手紙'}</strong>
                <span>{ready ? '✦ 開けられるようになりました' : `${formatDate(m.sealedUntil!)} に開けられます（${countdown(m.sealedUntil!)}）`}</span>
              </span>
            </button>
          );
        })}
      </section>

      {arrived.length > 0 && (
        <div className="otd-modal" role="dialog" aria-modal="true" aria-label="未来への手紙が届きました">
          <div className="otd-sheet">
            <p className="otd-kicker">{formatDate(arrived[0].createdAt)} のあなたから</p>
            <h2 className="otd-title" style={{ fontSize: 20 }}>
              未来への手紙が届きました
            </h2>
            <Envelope to={arrived[0].letterTo} ready />
            {arrived.length > 1 && <p className="muted small">ほかにも{arrived.length - 1}通届いています</p>}
            <button
              className="btn primary big"
              onClick={() => {
                const first = arrived[0];
                markAnnounced(arrived.map((m) => m.id));
                setArrived([]);
                open(first);
              }}
            >
              ✉ 開けにいく
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                markAnnounced(arrived.map((m) => m.id));
                setArrived([]);
              }}
            >
              あとで
            </button>
          </div>
        </div>
      )}
    </>
  );
}
