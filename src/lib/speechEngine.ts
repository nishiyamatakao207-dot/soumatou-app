/* 音声入力（ブラウザ内蔵の音声認識）を、アプリ全体で1つだけ動かす係。
 *
 * iPhone の Safari では：
 * - 音声認識は同時に1つしか使えない（前のものが残っていると、次が始まらない）
 * - 「話し続けるモード（continuous）」で使うと、2回目以降に文字が届かなくなることがある
 * そのため、新しく始めるときは前のものを必ず止め、iPhone では「1回話すと自動で止まる」使い方にする。
 * また、止まらない・始まらないときは、時間がたったら強制的に終わらせる。 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort?(): void;
  onstart: (() => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export interface SpeechHandlers {
  /** 確定した言葉 */
  onFinal: (text: string) => void;
  /** 話している途中の言葉（表示用） */
  onInterim: (text: string) => void;
  /** 聞いているかどうか */
  onListening: (on: boolean) => void;
  /** うまくいかなかった理由（画面に出す） */
  onError: (message: string) => void;
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function ctor(): (new () => Recognition) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
}

/** 音声入力が使えるか（部品を作らずに確かめる） */
export const speechAvailable = () => typeof window !== 'undefined' && !!ctor();

interface Active {
  rec: Recognition;
  owner: object;
  h: SpeechHandlers;
  timers: number[];
}
let current: Active | null = null;

function finish(a: Active) {
  a.timers.forEach((t) => clearTimeout(t));
  if (current === a) current = null;
  a.h.onInterim('');
  a.h.onListening(false);
}

/** 今動いている音声入力を、すぐに止める（結果は捨てる） */
function abortCurrent() {
  const a = current;
  if (!a) return;
  a.rec.onresult = null;
  a.rec.onerror = null;
  a.rec.onend = null;
  try {
    if (a.rec.abort) a.rec.abort();
    else a.rec.stop();
  } catch {
    /* すでに止まっている */
  }
  finish(a);
}

const MESSAGES: Record<string, string> = {
  'not-allowed': 'マイクの使用が許可されていません（iPhoneの「設定」→「Safari」→「マイク」で許可してください）',
  'service-not-allowed': '音声入力が許可されていません（iPhoneの「設定」→「スクリーンタイム」などで制限されていないか確認してください）',
  'audio-capture': 'マイクが使えません。ほかのアプリがマイクを使っていないか確認してください',
  network: '音声を文字にするサービスにつながりませんでした。ネットにつながっているか確認してください',
  'no-speech': '声が聞き取れませんでした。もう一度押して、話してください',
};

/**
 * 音声入力を始める（ボタンを押したその場で呼ぶ）。
 * owner：誰が使っているか（同じ owner の止める操作だけを受け付ける）
 */
export function startSpeech(owner: object, h: SpeechHandlers): boolean {
  const Ctor = ctor();
  if (!Ctor) {
    h.onError('このブラウザは音声入力に対応していません。キーボードのマイクボタンも使えます');
    return false;
  }
  // 前の音声入力が残っていたら、必ず止める（iPhone では同時に1つしか使えない）
  abortCurrent();

  const rec = new Ctor();
  rec.lang = 'ja-JP';
  rec.continuous = !isIOS(); // iPhone は1回話すと自動で止まる使い方にする
  rec.interimResults = true;
  const a: Active = { rec, owner, h, timers: [] };
  let started = false;
  let gotResult = false;

  rec.onstart = () => {
    started = true;
  };
  rec.onresult = (e) => {
    gotResult = true;
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) h.onFinal(r[0].transcript);
      else live += r[0].transcript;
    }
    h.onInterim(live);
  };
  rec.onerror = (e) => {
    if (e.error === 'aborted') return;
    if (e.error === 'no-speech' && gotResult) return;
    h.onError(MESSAGES[e.error] ?? `音声入力でエラーが起きました（${e.error}）`);
  };
  rec.onend = () => finish(a);

  current = a;
  try {
    rec.start();
  } catch {
    finish(a);
    h.onError('音声入力を始められませんでした。少し待ってから、もう一度押してください');
    return false;
  }
  h.onListening(true);
  // 始まらないまま時間がたったら、あきらめて知らせる
  a.timers.push(
    window.setTimeout(() => {
      if (current === a && !started && !gotResult) {
        abortCurrent();
        h.onError('音声入力が始まりませんでした。もう一度押してください');
      }
    }, 6000),
  );
  return true;
}

/** 話し終わった：止める（最後の言葉は届く）。止まらなければ少し待って強制的に終わらせる */
export function stopSpeech(owner?: object) {
  const a = current;
  if (!a || (owner && a.owner !== owner)) return;
  try {
    a.rec.stop();
  } catch {
    /* すでに止まっている */
  }
  a.timers.push(
    window.setTimeout(() => {
      if (current === a) abortCurrent();
    }, 1500),
  );
}

/** 画面を離れるとき：その画面の音声入力だけを止める */
export function releaseSpeech(owner: object) {
  if (current?.owner === owner) abortCurrent();
}
