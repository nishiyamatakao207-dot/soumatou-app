import { useEffect, useRef, useState } from 'react';

/* 「声で残す」用の録音（音声認識）。
 * iPhone では、ボタンを押したその瞬間でないと録音を始められない。
 * そこで一覧画面のボタンで録音を始め、画面が切り替わっても続くよう、画面とは別にここで持っておく。
 * 話した言葉はすぐ文字になり、画面がまだ受け取っていない分はためておく。 */

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

interface State {
  listening: boolean;
  interim: string;
  error?: string;
}

let rec: Recognition | null = null;
let state: State = { listening: false, interim: '' };
const pending: string[] = [];
const finalListeners = new Set<(chunk: string) => void>();
const stateListeners = new Set<(s: State) => void>();

const setState = (s: Partial<State>) => {
  state = { ...state, ...s };
  stateListeners.forEach((f) => f(state));
};

function emit(chunk: string) {
  if (finalListeners.size) finalListeners.forEach((f) => f(chunk));
  else pending.push(chunk);
}

export function voiceSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** 録音を始める（ボタンを押したその場で呼ぶ）。始められなければ false */
export function startVoice(): boolean {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
  if (!Ctor) {
    setState({ error: 'このブラウザは音声入力に対応していません。キーボードのマイクボタンも使えます。' });
    return false;
  }
  rec?.stop();
  const r = new Ctor();
  r.lang = 'ja-JP';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const x = e.results[i];
      if (x.isFinal) emit(x[0].transcript);
      else live += x[0].transcript;
    }
    setState({ interim: live });
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setState({ error: 'マイクの使用が許可されていません（設定アプリで許可してください）' });
    else if (e.error !== 'no-speech' && e.error !== 'aborted') setState({ error: `音声入力でエラーが起きました（${e.error}）` });
  };
  r.onend = () => {
    if (rec === r) rec = null;
    setState({ listening: false, interim: '' });
  };
  rec = r;
  setState({ listening: true, interim: '', error: undefined });
  try {
    r.start();
  } catch {
    rec = null;
    setState({ listening: false, error: '録音を始められませんでした' });
    return false;
  }
  return true;
}

export function stopVoice() {
  rec?.stop();
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
  useEffect(() => () => stopVoice(), []);
  return s;
}
