import { prepareForMicrophone } from './bgm';

/* 音声入力（ブラウザ内蔵の音声認識）を、アプリ全体で1つだけ動かす係。
 *
 * iPhone の Safari で気をつけていること：
 * - 音声認識は同時に1つしか使えない → 新しく始める前に、前のものを止める
 * - 「話し続けるモード」は2回目以降に文字が届かなくなることがある → iPhone では使わない
 * - 音楽用の「再生だけのモード」のままだとマイクが使えない → 始める前にマイクを使えるモードへ
 * - 部品を毎回作り直すと2回目が動かない機種がある → 同じ部品を使い回す。
 *   それでも始まらなかったときは、次は新しい部品で試す（自動で切り替える）
 *
 * うまくいかないときの原因を調べられるよう、起きたことを記録しておく（診断画面で見られる）。 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort?(): void;
  onstart: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onaudioend?: (() => void) | null;
  onnomatch?: (() => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};

export interface SpeechHandlers {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onListening: (on: boolean) => void;
  onError: (message: string) => void;
}

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function ctor(): (new () => Recognition) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
}

export const speechAvailable = () => typeof window !== 'undefined' && !!ctor();

// ---------------------------------------------------------------- 記録（診断用）

const LOG_MAX = 80;
const logLines: string[] = [];
const logListeners = new Set<() => void>();
const t0 = Date.now();
function log(msg: string) {
  logLines.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`);
  if (logLines.length > LOG_MAX) logLines.shift();
  logListeners.forEach((f) => f());
}
export const speechLog = () => [...logLines];
export function onSpeechLog(f: () => void) {
  logListeners.add(f);
  return () => logListeners.delete(f);
}
export const clearSpeechLog = () => {
  logLines.length = 0;
  logListeners.forEach((f) => f());
};

// ---------------------------------------------------------------- 本体

interface Session {
  owner: object;
  h: SpeechHandlers;
  started: boolean;
  gotResult: boolean;
  timers: number[];
  n: number;
}

let shared: Recognition | null = null;
/** 部品を使い回して始まらなかったら、次は新しい部品で試す */
let preferFresh = false;
let running = false;
let session: Session | null = null;
let count = 0;

function end(s: Session) {
  s.timers.forEach((t) => clearTimeout(t));
  if (session === s) session = null;
  s.h.onInterim('');
  s.h.onListening(false);
}

const MESSAGES: Record<string, string> = {
  'not-allowed': 'マイクの使用が許可されていません（iPhoneの「設定」→「Safari」→「マイク」で許可してください）',
  'service-not-allowed': '音声入力が使えない状態です（「設定」→「一般」→「キーボード」の「音声入力」がオンか確認してください）',
  'audio-capture': 'マイクが使えません。ほかのアプリがマイクを使っていないか確認してください',
  network: '音声を文字にするサービスにつながりませんでした。ネットにつながっているか確認してください',
  'no-speech': '声が聞き取れませんでした。もう一度押して、話してください',
};

function attach(rec: Recognition) {
  rec.onstart = () => {
    log('onstart（聞き始めた）');
    if (session) session.started = true;
  };
  rec.onaudiostart = () => log('audiostart（マイクから音が来た）');
  rec.onspeechstart = () => log('speechstart（声を見つけた）');
  rec.onspeechend = () => log('speechend');
  rec.onaudioend = () => log('audioend');
  rec.onnomatch = () => log('nomatch（言葉にできなかった）');
  rec.onresult = (e) => {
    const s = session;
    let live = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      log(`result ${r.isFinal ? '確定' : '途中'}「${r[0].transcript}」`);
      if (!s) continue;
      s.gotResult = true;
      if (r.isFinal) s.h.onFinal(r[0].transcript);
      else live += r[0].transcript;
    }
    s?.h.onInterim(live);
  };
  rec.onerror = (e) => {
    log(`error ${e.error}${e.message ? ` (${e.message})` : ''}`);
    const s = session;
    if (!s || e.error === 'aborted') return;
    if (e.error === 'no-speech' && s.gotResult) return;
    s.h.onError(MESSAGES[e.error] ?? `音声入力でエラーが起きました（${e.error}）`);
  };
  rec.onend = () => {
    log('onend（止まった）');
    running = false;
    if (session) end(session);
  };
}

function recognizer(fresh: boolean): Recognition {
  const Ctor = ctor()!;
  if (fresh || !shared) {
    const old = shared;
    if (old) {
      // 古い部品の知らせ（止まった等）が、新しい音声入力を止めてしまわないように外す
      old.onstart = old.onresult = old.onerror = old.onend = null;
      try {
        old.abort?.();
      } catch {
        /* 止まっている */
      }
    }
    shared = new Ctor();
    attach(shared);
    log(fresh ? '新しい部品を作った' : '部品を作った');
  }
  shared.lang = 'ja-JP';
  shared.continuous = !isIOS();
  shared.interimResults = true;
  return shared;
}

/** 音声入力を始める（ボタンを押したその場で呼ぶ） */
export function startSpeech(owner: object, h: SpeechHandlers): boolean {
  if (!ctor()) {
    h.onError('このブラウザは音声入力に対応していません。キーボードのマイクボタンも使えます');
    return false;
  }
  count++;
  log(`--- ${count}回目：開始ボタン（${prepareForMicrophone()}）`);
  // 前の音声入力が残っていたら止める
  if (session) end(session);
  let fresh = preferFresh;
  if (running) {
    log('前の音声入力がまだ動いている → 新しい部品で始める');
    fresh = true;
    running = false;
  }
  const s: Session = { owner, h, started: false, gotResult: false, timers: [], n: count };
  session = s;
  const tryStart = (rec: Recognition) => {
    rec.start();
    running = true;
    log(`start() 呼び出し（${rec === shared && !fresh ? '使い回し' : '新しい部品'}・continuous=${rec.continuous}）`);
  };
  try {
    tryStart(recognizer(fresh));
  } catch (e) {
    log(`start() 失敗：${e instanceof Error ? `${e.name} ${e.message}` : e}`);
    try {
      tryStart(recognizer(true));
    } catch (e2) {
      log(`新しい部品でも失敗：${e2 instanceof Error ? e2.name : e2}`);
      end(s);
      h.onError('音声入力を始められませんでした。少し待ってから、もう一度押してください');
      return false;
    }
  }
  h.onListening(true);
  // 使い回しで始まらなかったら、2秒後に新しい部品でもう一度試す（その機種では次からも新しい部品を使う）
  if (!fresh) {
    s.timers.push(
      window.setTimeout(() => {
        if (session !== s || s.started || s.gotResult) return;
        log('2秒たっても始まらない → 新しい部品でもう一度試す');
        preferFresh = true;
        try {
          tryStart(recognizer(true));
        } catch (e) {
          log(`もう一度試すのに失敗：${e instanceof Error ? e.name : e}`);
        }
      }, 2000),
    );
  }
  s.timers.push(
    window.setTimeout(() => {
      if (session === s && !s.started && !s.gotResult) {
        log('6秒たっても始まらない → 止めて、次は新しい部品で試す');
        preferFresh = !preferFresh;
        try {
          shared?.abort?.();
        } catch {
          /* 止まっている */
        }
        running = false;
        end(s);
        h.onError('音声入力が始まりませんでした。もう一度押してください');
      }
    }, 6000),
  );
  return true;
}

/** 話し終わった：止める（最後の言葉は届く）。止まらなければ少し待って強制的に終わらせる */
export function stopSpeech(owner?: object) {
  const s = session;
  if (!s || (owner && s.owner !== owner)) return;
  log('停止ボタン');
  try {
    shared?.stop();
  } catch {
    /* 止まっている */
  }
  s.timers.push(
    window.setTimeout(() => {
      if (session === s) {
        log('1.5秒たっても止まらない → 強制的に止める');
        try {
          shared?.abort?.();
        } catch {
          /* 止まっている */
        }
        running = false;
        end(s);
      }
    }, 1500),
  );
}

/** 画面を離れるとき：その画面の音声入力だけを止める */
export function releaseSpeech(owner: object) {
  if (session?.owner !== owner) return;
  try {
    shared?.abort?.();
  } catch {
    /* 止まっている */
  }
  running = false;
  end(session);
}

/** 診断画面に出す、この端末の情報 */
export function speechEnvironment(): string[] {
  const nav = navigator as unknown as { audioSession?: { type: string }; standalone?: boolean };
  return [
    `端末：${navigator.userAgent}`,
    `ホーム画面から：${nav.standalone || matchMedia('(display-mode: standalone)').matches ? 'はい' : 'いいえ'}`,
    `音声認識：${'SpeechRecognition' in window ? 'SpeechRecognition' : 'webkitSpeechRecognition' in window ? 'webkitSpeechRecognition' : 'なし'}`,
    `audioSession：${nav.audioSession ? nav.audioSession.type : 'なし'}`,
  ];
}
