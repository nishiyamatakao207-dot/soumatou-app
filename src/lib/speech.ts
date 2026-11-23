import { useCallback, useEffect, useRef, useState } from 'react';
import { releaseSpeech, speechAvailable, startSpeech, stopSpeech } from './speechEngine';

/* 入力欄の「声で入力」。声はその場で文字にして、テキストだけを保存する。
 * 実際の音声認識は speechEngine がアプリ全体で1つだけ動かす。 */

export const speechSupported = speechAvailable;

/**
 * 声で入力する。確定した文章は onFinal で受け取り、
 * 話している途中の文字は interim で表示用に返す。
 */
export function useSpeechInput(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string>();
  const owner = useRef({});
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const start = useCallback(() => {
    setError(undefined);
    startSpeech(owner.current, {
      onFinal: (t) => onFinalRef.current(t),
      onInterim: setInterim,
      onListening: setListening,
      onError: setError,
    });
  }, []);
  const stop = useCallback(() => stopSpeech(owner.current), []);

  useEffect(() => () => releaseSpeech(owner.current), []);

  return { listening, interim, error, start, stop };
}
