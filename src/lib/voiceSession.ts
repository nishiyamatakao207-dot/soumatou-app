import { useEffect, useRef, useState } from 'react';
import { releaseSpeech, speechAvailable, startSpeech, stopSpeech } from './speechEngine';

/* 「声で入力」用の録音（音声認識）。
 * iPhone では、ボタンを押したその瞬間でないと録音を始められない。
 * そこで一覧画面のボタンで録音を始め、画面が切り替わっても続くよう、画面とは別にここで持っておく。
 * 話した言葉はすぐ文字になり、画面がまだ受け取っていない分はためておく。 */

interface State {
  listening: boolean;
  interim: string;
  error?: string;
}

let state: State = { listening: false, interim: '' };
const pending: string[] = [];
const finalListeners = new Set<(chunk: string) => void>();
const stateListeners = new Set<(s: State) => void>();
/** 「声で入力」の音声入力であることの印 */
const OWNER = {};

const setState = (s: Partial<State>) => {
  state = { ...state, ...s };
  stateListeners.forEach((f) => f(state));
};

function emit(chunk: string) {
  if (finalListeners.size) finalListeners.forEach((f) => f(chunk));
  else pending.push(chunk);
}

export const voiceSupported = speechAvailable;

/** 録音を始める（ボタンを押したその場で呼ぶ）。始められなければ false */
export function startVoice(): boolean {
  setState({ error: undefined, interim: '' });
  pending.length = 0; // 前の音声入力の、あとから届いた言葉を持ち越さない
  return startSpeech(OWNER, {
    onFinal: emit,
    onInterim: (t) => setState({ interim: t }),
    onListening: (on) => setState({ listening: on }),
    onError: (m) => setState({ error: m }),
  });
}

export function stopVoice() {
  stopSpeech(OWNER);
}

/** 画面側：録音の様子を受け取り、確定した言葉を onFinal で受け取る */
export function useVoiceSession(onFinal: (chunk: string) => void) {
  const [s, setS] = useState<State>(state);
  const cb = useRef(onFinal);
  cb.current = onFinal;
  useEffect(() => {
    const f = (chunk: string) => cb.current(chunk);
    finalListeners.add(f);
    stateListeners.add(setS);
    // 画面ができる前に話された分を渡す
    while (pending.length) f(pending.shift()!);
    setS(state);
    return () => {
      finalListeners.delete(f);
      stateListeners.delete(setS);
    };
  }, []);
  // 画面を離れたら録音も止める
  useEffect(() => () => releaseSpeech(OWNER), []);
  return s;
}
