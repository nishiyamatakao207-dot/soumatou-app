import { useEffect, useRef, useState } from 'react';
import { speechSupported, useSpeechInput } from '../lib/speech';
import { KEYBOARD_HINT, switchToKeyboardVoice, useKeyboardVoice } from '../lib/voiceMethod';

const join = (t: string, chunk: string) => (t ? `${t}${/[。！？\s]$/.test(t) ? '' : '。'}` : '') + chunk.trim();

/**
 * 文字入力欄＋「声で入力」ボタン。声はその場で文字になる。
 * キーボードの音声入力を使うとき（iPhone でアプリの音声認識がうまくいかなかったときなど）は、
 * ボタンで入力欄にキーボードを出し、キーボードの🎤で話してもらう。
 */
export function VoiceText({
  value,
  onChange,
  placeholder,
  rows = 3,
  compact,
  keyboardNow,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  compact?: boolean;
  /** 画面を開いたらすぐキーボードを出して、🎤の案内を出す（一覧の「声で入力」から来たとき） */
  keyboardNow?: boolean;
}) {
  const latest = useRef(value);
  latest.current = value;
  const speech = useSpeechInput((chunk) => onChange(join(latest.current, chunk)));
  const keyboard = useKeyboardVoice();
  const area = useRef<HTMLTextAreaElement>(null);
  const [hint, setHint] = useState(!!keyboardNow);

  useEffect(() => {
    if (!keyboardNow) return;
    area.current?.focus();
    setHint(true);
  }, [keyboardNow]);

  /** キーボードを出して、🎤の案内を出す（ボタンを押したその場で呼ぶ：iPhone はそうしないとキーボードが出ない） */
  const openKeyboard = () => {
    area.current?.focus();
    setHint(true);
  };

  return (
    <div className={`voicetext ${compact ? 'compact' : ''}`}>
      <textarea
        ref={area}
        value={value + (speech.interim ? (value ? '。' : '') + speech.interim : '')}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setHint(false)}
        readOnly={speech.listening}
        rows={rows}
        placeholder={placeholder}
      />
      {keyboard ? (
        <>
          <button type="button" className={`btn mic ${compact ? 'small' : 'big'}`} onMouseDown={(e) => e.preventDefault()} onClick={openKeyboard}>
            🎙 声で入力
          </button>
          {hint ? <p className="keyboard-hint">{KEYBOARD_HINT}</p> : <p className="muted small voice-hint-text">話した言葉が文字になります（キーボードの🎤を使います）</p>}
        </>
      ) : (
        speechSupported() && (
          <>
            <button
              type="button"
              className={`btn mic ${compact ? 'small' : 'big'} ${speech.listening ? 'rec' : ''}`}
              onClick={speech.listening ? speech.stop : speech.start}
            >
              {speech.listening ? '■ 終える' : '🎙 声で入力'}
            </button>
            {!speech.listening && <p className="muted small voice-hint-text">話した言葉が文字になります</p>}
            {speech.listening && <p className="muted small">聞いています…話してください（文字が出るまで数秒かかることがあります。話し終わると自動で止まります）</p>}
          </>
        )
      )}
      {speech.error && !hint && <VoiceError message={speech.error} onKeyboard={() => (switchToKeyboardVoice(), openKeyboard())} />}
    </div>
  );
}

/** 声で入力できなかったときの知らせと、キーボードの音声入力へ切り替えるボタン */
export function VoiceError({ message, onKeyboard }: { message: string; onKeyboard: () => void }) {
  return (
    <div className="voice-error">
      <p className="error small">{message}</p>
      <button type="button" className="btn small primary" onMouseDown={(e) => e.preventDefault()} onClick={onKeyboard}>
        ⌨ キーボードの音声入力で話す
      </button>
      <p className="muted small">
        iPhoneのキーボードの🎤を使います。何回続けても安定して使えます。
        <a href="#/voicecheck">原因を調べる（音声入力の診断）</a>
      </p>
    </div>
  );
}
