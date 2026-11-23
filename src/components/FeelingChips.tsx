/** タップで入れられる「ひとこと」の候補（文字を打たなくても気持ちを残せる） */
const WORDS = ['うれしい', '楽しかった', '笑った', 'ほっこり', '感動した', 'がんばった', 'おいしかった', 'ありがとう'];

export function FeelingChips({ onPick }: { onPick: (word: string) => void }) {
  return (
    <div className="chips feeling-chips" aria-label="ひとことの候補">
      {WORDS.map((w) => (
        <button key={w} type="button" className="chip" onClick={() => onPick(w)}>
          {w}
        </button>
      ))}
    </div>
  );
}

/** 文の続きに言葉を足す（句読点をはさむ） */
export const appendWord = (text: string, word: string) =>
  text.trim() ? `${text.trim()}${/[。！？!?、]$/.test(text.trim()) ? '' : '。'}${word}` : word;
