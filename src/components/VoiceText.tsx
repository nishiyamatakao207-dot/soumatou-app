import { useRef } from 'react';
import { speechSupported, useSpeechInput } from '../lib/speech';

const join = (t: string, chunk: string) => (t ? `${t}${/[。！？\s]$/.test(t) ? '' : '。'}` : '') + chunk.trim();

/** 文字入力欄＋「声で入力」ボタン。声はその場で文字になる */
export function VoiceText({
  value,
  onChange,
  placeholder,
  rows = 3,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  compact?: boolean;
}) {
  const latest = useRef(value);
  latest.current = value;
  const speech = useSpeechInput((chunk) => onChange(join(latest.current, chunk)));

  return (
    <div className={`voicetext ${compact ? 'compact' : ''}`}>
      <textarea
        value={value + (speech.interim ? (value ? '。' : '') + speech.interim : '')}
        onChange={(e) => onChange(e.target.value)}
        readOnly={speech.listening}
        rows={rows}
        placeholder={placeholder}
      />
      {speechSupported() && (
        <button
          type="button"
          className={`btn mic ${compact ? 'small' : 'big'} ${speech.listening ? 'rec' : ''}`}
          onClick={speech.listening ? speech.stop : speech.start}
        >
          {speech.listening ? '■ 終える' : '🎙 声で入力'}
        </button>
      )}
      {speech.listening && <p className="muted small">聞いています…（話し終わると自動で止まります。続けるときは、もう一度押してください）</p>}
      {speech.error && (
        <p className="error small">
          {speech.error}
          <br />
          <a href="#/voicecheck">うまくいかないときは「音声入力の診断」へ</a>
        </p>
      )}
    </div>
  );
}
