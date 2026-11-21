import { useCallback, useEffect, useRef, useState } from 'react';

/* ブラウザ内蔵の音声認識（Web Speech API）。
 * iPhone の Safari / Android の Chrome で利用可能。
 * 声はその場で文字にして、テキストだけを保存する。 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function createRecognition(): Recognition | null {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
  return Ctor ? new Ctor() : null;
}

export const speechSupported = () => createRecognition() !== null;

/**
 * 声で入力する。確定した文章は onFinal で受け取り、
 * 話している途中の文字は interim で表示用に返す。
 */
export function useSpeechInput(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string>();
  const recRef = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => recRef.current?.stop(), []);

  const start = useCallback(() => {
    const rec = createRecognition();
    if (!rec) {
      setError('このブラウザは音声入力に対応していません');
      return;
    }
    setError(undefined);
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinalRef.current(r[0].transcript);
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') setError('マイクの使用が許可されていません');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('音声入力でエラーが起きました');
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      recRef.current = null;
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, []);

  useEffect(() => () => recRef.current?.stop(), []);

  return { listening, interim, error, start, stop };
}
