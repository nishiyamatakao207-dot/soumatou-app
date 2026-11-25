import { pauseAllMedia, prepareForMicrophone } from './bgm';

/* 音声入力（ブラウザ内蔵の音声認識）を、アプリ全体で1つだけ動かす係。
 * 入力欄の「声で入力」も、一覧の「声で入力」（思い出を編集の画面に続く）も、すべてここを通る。
 *
 * iPhone の Safari で気をつけていること：
 * - 1回目の結果のあと、エラーも「止まった」も出さずに何も返らなくなることがある
 *   → ボタンを押すたびに部品を新しく作り、前の部品は知らせを外してから止めて捨てる
 * - 「話し続けるモード」（continuous）は結果が返らないことがある → 使わない。一言ずつ聞き取り、
 *   区切りごとに自動で聞き直して文字をつなげる
 * - 聞いている間に動画や音の再生・一時停止が起きると止まることがある → 始める前に全部止める
 * - 数秒たっても文字が返らないとき → 1回だけ自動でやり直し、だめなら「もう一度押して」と出す
 * - 「確定」の印が付かないまま終わることがある → 最後に聞こえた途中の文字を、確定したものとして使う
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
  maxAlternatives?: number;
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

/** 声が届き始めるまで・文字が返るまで待つ時間 */
const FIRST_WAIT_MS = 7000;
/** 区切りのあと、続きを話すのを待つ時間（話さなければ終わる） */
const NEXT_WAIT_MS = 5000;
/** 結果のあと「止まった」が来ないときに、止まったとみなすまでの時間（iPhone の不具合対策） */
const END_GRACE_MS = 1500;
/** 1回の「声で入力」で、聞き続ける最長の時間 */
const MAX_SESSION_MS = 180000;

interface Session {
  owner: object;
  h: SpeechHandlers;
  n: number;
  began: number;
  /** 今聞いている部品 */
  rec: Recognition | null;
  /** 停止ボタンが押された */
  stopping: boolean;
  /** これまでに文字が1つでも返ったか */
  gotAny: boolean;
  /** 今の区切りで文字が返ったか */
  segGot: boolean;
  /** 今の区切りの、まだ確定していない途中の文字 */
  segInterim: string;
  /** 自動でやり直した回数 */
  retries: number;
  /** 何回目の区切りか */
  segments: number;
  wait?: number;
  grace?: number;
  stopTimer?: number;
}

let session: Session | null = null;
let count = 0;

const MESSAGES: Record<string, string> = {
  'not-allowed': 'マイクの使用が許可されていません（iPhoneの「設定」→「Safari」→「マイク」で許可してください）',
  'service-not-allowed': '音声入力が使えない状態です（「設定」→「一般」→「キーボード」の「音声入力」がオンか確認してください）',
  'audio-capture': 'マイクが使えません。ほかのアプリがマイクを使っていないか確認してください',
  network: '音声を文字にするサービスにつながりませんでした。ネットにつながっているか確認してください',
};
const NOT_HEARD = 'うまく聞き取れませんでした。もう一度押してください';

/** 部品の知らせを外して止め、捨てる（古い部品の知らせが、新しい音声入力を邪魔しないように） */
function discard(rec: Recognition | null) {
  if (!rec) return;
  rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
  rec.onaudiostart = rec.onspeechstart = rec.onspeechend = rec.onaudioend = rec.onnomatch = null;
  try {
    rec.abort?.();
  } catch {
    /* 止まっている */
  }
}

function clearTimers(s: Session) {
  clearTimeout(s.wait);
  clearTimeout(s.grace);
  clearTimeout(s.stopTimer);
}

/** 今の区切りで、確定しないまま残った途中の文字を、確定したものとして渡す */
function flushInterim(s: Session) {
  const t = s.segInterim.trim();
  s.segInterim = '';
  if (t) {
    log(`確定の印がないまま終わった途中の文字を使う「${t}」`);
    s.h.onFinal(t);
  }
  s.h.onInterim('');
}

/** ホーム画面に追加したアプリとして開いているか */
const standalone = () =>
  !!(navigator as unknown as { standalone?: boolean }).standalone || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

/** うまくいかないときの、ほかの方法の案内 */
const fallbackHint = () =>
  standalone()
    ? '（ホーム画面から開いたアプリでは、iPhoneの仕組みで音声入力が使えないことがあります。Safariで開くか、キーボードのマイクボタン🎙で話してください）'
    : '（キーボードのマイクボタン🎙でも、話して入力できます）';

/** 音声入力を終える（エラーがあれば知らせる） */
function finish(s: Session, error?: string) {
  if (session !== s) return;
  clearTimers(s);
  discard(s.rec);
  s.rec = null;
  flushInterim(s);
  session = null;
  log(`終わり${error ? `（${error}）` : ''}`);
  s.h.onListening(false);
  if (error) s.h.onError(error === NOT_HEARD || error.startsWith('音声入力が使えない') || error.startsWith('音声入力を始められ') ? `${error}${fallbackHint()}` : error);
}

/** 文字が返らないとき：最初なら1回だけ自動でやり直す。続きの区切りなら、話し終わったとみなして終える */
function noResult(s: Session, why: string) {
  if (session !== s) return;
  if (s.gotAny) {
    log(`${why} → 話し終わったとみなして終える`);
    finish(s);
  } else if (s.retries < 1) {
    s.retries++;
    log(`${why} → 新しい部品で自動でやり直す`);
    startSegment(s);
  } else {
    log(`${why} → あきらめる`);
    finish(s, NOT_HEARD);
  }
}

/** 区切りが終わった（「止まった」が来た、または来ないまま時間がたった） */
function segmentEnded(s: Session) {
  if (session !== s) return;
  clearTimeout(s.grace);
  clearTimeout(s.wait);
  flushInterim(s);
  discard(s.rec);
  s.rec = null;
  if (s.stopping) return finish(s);
  if (!s.segGot) return noResult(s, '文字が返らないまま止まった');
  if (Date.now() - s.began > MAX_SESSION_MS) return finish(s);
  // 続きを聞く（区切りごとに新しい部品で）
  s.segments++;
  log(`区切り${s.segments} → 続きを聞く`);
  startSegment(s);
}

function armWait(s: Session, ms: number, why: string) {
  clearTimeout(s.wait);
  s.wait = window.setTimeout(() => {
    if (session !== s) return;
    if (s.segGot) {
      // 途中の文字は来たが、そのあと何も来ない（止まったまま）→ この区切りを終える
      log(`${why}（文字のあと止まったまま）→ 区切りを終える`);
      segmentEnded(s);
    } else {
      discard(s.rec);
      s.rec = null;
      noResult(s, why);
    }
  }, ms);
}

/** 新しい部品を作って、一言分を聞き始める */
function startSegment(s: Session) {
  discard(s.rec);
  s.rec = null;
  s.segGot = false;
  s.segInterim = '';
  const Ctor = ctor()!;
  const rec = new Ctor();
  rec.lang = 'ja-JP';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const live = () => session === s && s.rec === rec;
  rec.onstart = () => live() && log('onstart（聞き始めた）');
  rec.onaudiostart = () => live() && log('audiostart（マイクから音が来た）');
  rec.onspeechstart = () => live() && log('speechstart（声を見つけた）');
  rec.onspeechend = () => live() && log('speechend');
  rec.onaudioend = () => live() && log('audioend');
  rec.onnomatch = () => live() && log('nomatch（言葉にできなかった）');
  rec.onresult = (e) => {
    if (!live()) return;
    let interim = '';
    let gotFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      log(`result ${r.isFinal ? '確定' : '途中'}「${r[0].transcript}」`);
      if (r.isFinal) {
        gotFinal = true;
        s.h.onFinal(r[0].transcript);
      } else interim += r[0].transcript;
    }
    s.segGot = true;
    s.gotAny = true;
    s.segInterim = gotFinal ? '' : interim;
    s.h.onInterim(gotFinal ? '' : interim);
    if (gotFinal) {
      // 確定のあと、「止まった」が来ないまま固まることがある → 少し待って区切りを終える
      clearTimeout(s.wait);
      clearTimeout(s.grace);
      s.grace = window.setTimeout(() => {
        if (!live()) return;
        log('確定のあと「止まった」が来ない → 区切りを終える');
        segmentEnded(s);
      }, END_GRACE_MS);
    } else armWait(s, NEXT_WAIT_MS, '途中の文字のあと何も来ない');
  };
  rec.onerror = (e) => {
    if (!live()) return;
    log(`error ${e.error}${e.message ? ` (${e.message})` : ''}`);
    if (e.error === 'aborted') return;
    if (e.error === 'no-speech' || e.error === 'nomatch') {
      discard(rec);
      s.rec = null;
      clearTimeout(s.wait);
      clearTimeout(s.grace);
      if (s.segGot) return segmentEnded(s);
      return noResult(s, '声が聞こえなかった');
    }
    // 自動で聞き直したときに断られた（iPhone は、ボタンを押していないと始められないことがある）
    if (s.segments > 0 && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
      log('自動で聞き直せなかった → ここで終える');
      return finish(s);
    }
    finish(s, MESSAGES[e.error] ?? `音声入力でエラーが起きました（${e.error}）`);
  };
  rec.onend = () => {
    if (!live()) return;
    log('onend（止まった）');
    segmentEnded(s);
  };
  s.rec = rec;
  try {
    rec.start();
    log(`start()（${s.segments ? `続き${s.segments}` : s.retries ? 'やり直し' : '最初'}・新しい部品・一言ずつ）`);
  } catch (e) {
    log(`start() 失敗：${e instanceof Error ? `${e.name} ${e.message}` : e}`);
    discard(rec);
    s.rec = null;
    if (s.gotAny) return finish(s);
    return finish(s, '音声入力を始められませんでした。少し待ってから、もう一度押してください');
  }
  armWait(s, s.gotAny ? NEXT_WAIT_MS : FIRST_WAIT_MS, s.gotAny ? '続きの言葉が来ない' : `${FIRST_WAIT_MS / 1000}秒たっても文字が返らない`);
}

/** 音声入力を始める（ボタンを押したその場で呼ぶ） */
export function startSpeech(owner: object, h: SpeechHandlers): boolean {
  if (!ctor()) {
    h.onError('このブラウザは音声入力に対応していません。キーボードのマイクボタンも使えます');
    return false;
  }
  count++;
  // 前の音声入力が残っていたら、確実に終える
  if (session) finish(session);
  // 再生中の音楽・動画を止める（聞いている途中に再生や一時停止が起きると、iPhone では止まってしまう）
  const paused = pauseAllMedia();
  log(`--- ${count}回目：開始ボタン（${prepareForMicrophone()}${paused ? `・再生を${paused}つ止めた` : ''}）`);
  const s: Session = { owner, h, n: count, began: Date.now(), rec: null, stopping: false, gotAny: false, segGot: false, segInterim: '', retries: 0, segments: 0 };
  session = s;
  h.onListening(true);
  startSegment(s);
  return session === s;
}

/** 話し終わった：止める（最後の言葉は届く）。止まらなければ少し待って終わらせる */
export function stopSpeech(owner?: object) {
  const s = session;
  if (!s || (owner && s.owner !== owner)) return;
  log('停止ボタン');
  s.stopping = true;
  clearTimeout(s.wait);
  try {
    s.rec?.stop();
  } catch {
    /* 止まっている */
  }
  if (!s.rec) return finish(s);
  s.stopTimer = window.setTimeout(() => {
    if (session === s) {
      log(`${END_GRACE_MS / 1000}秒たっても止まらない → 終える`);
      finish(s);
    }
  }, END_GRACE_MS);
}

/** 画面を離れるとき：その画面の音声入力だけを止める */
export function releaseSpeech(owner: object) {
  if (session?.owner === owner) finish(session);
}

/** 診断画面に出す、この端末の情報 */
export function speechEnvironment(): string[] {
  const nav = navigator as unknown as { audioSession?: { type: string }; standalone?: boolean };
  return [
    `端末：${navigator.userAgent}`,
    `ホーム画面から：${standalone() ? 'はい' : 'いいえ'}`,
    `音声認識：${'SpeechRecognition' in window ? 'SpeechRecognition' : 'webkitSpeechRecognition' in window ? 'webkitSpeechRecognition' : 'なし'}`,
    `audioSession：${nav.audioSession ? nav.audioSession.type : 'なし'}`,
  ];
}
