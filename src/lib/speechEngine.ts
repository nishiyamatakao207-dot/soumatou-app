import { pauseAllMedia, prepareForMicrophone } from './bgm';
import { markAppVoiceFailed } from './voiceMethod';

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

/*
 * iPhone で記録からわかったこと：
 * - 音声認識を途中で止める（stop・abort）と、そのあとしばらく、新しい部品が「すぐ聞き始めた」と返すのに
 *   声がまったく届かない状態になる
 * - 一言が自然に終わったあとなら、すぐ次の部品を始めても聞き取れる
 * - 文字が返るまで数秒かかることがある（止めたあとに、言葉が届いたこともあった）
 * そこで iPhone では、音声認識を途中で止めない：
 * - 停止ボタン：画面の上だけ終わらせ、音声認識は自然に止まるまで裏で聞かせておく。その間に届いた言葉も入れる
 * - 次に押されたとき、前の音声認識がまだ聞いていれば、それをそのまま使う（新しく始めない）
 * - 止めるのは「すぐ聞き始めた＝声が届いていない」ときだけ（どのみち使えないので、作り直す）
 */

const IOS = () => isIOS();
/** 声が届き始めるまで・文字が返るまで待つ時間 */
const firstWait = () => (IOS() ? 12000 : 7000);
/** 区切りのあと、続きを話すのを待つ時間（話さなければ終わる） */
const NEXT_WAIT_MS = 5000;
/** 確定のあと「止まった」が来ないときに、区切りが終わったとみなすまでの時間 */
const END_GRACE_MS = 1500;
/** 1回の「声で入力」で、聞き続ける最長の時間 */
const MAX_SESSION_MS = 180000;
/** start() からこれより早く「聞き始めた」が来たら、声が届いていない様子（iPhone） */
const INSTANT_MS = 150;

interface Session {
  owner: object;
  h: SpeechHandlers;
  n: number;
  began: number;
  /** 画面に「聞いています」と出している間 true。停止ボタンのあとは false（裏で聞いているだけ） */
  active: boolean;
  /** 今聞いている部品 */
  rec: Recognition | null;
  stopping: boolean;
  gotAny: boolean;
  segGot: boolean;
  segInterim: string;
  segStart: number;
  segSpeech: boolean;
  segInstant: boolean;
  /** 今の区切りで「聞き始めた」が来たか */
  segOnstart: boolean;
  /** 裏で聞き始めた時刻（iPhone） */
  lingerSince: number;
  /** 停止ボタンで先に入れた途中の文字（あとで届く確定の文字と二重にしないため） */
  dedupe: string;
  retries: number;
  segments: number;
  wait?: number;
  grace?: number;
  stuck?: number;
  recover?: number;
  stopTimer?: number;
}

/** 画面に出している音声入力 */
let session: Session | null = null;
/** 停止ボタンのあと、裏で聞いている音声入力（iPhone） */
let lingering: Session | null = null;
/** 部品 → どの音声入力のものか（前の部品を、次の音声入力でそのまま使うため） */
const ownerOf = new WeakMap<Recognition, Session>();
let count = 0;

const MESSAGES: Record<string, string> = {
  'not-allowed': 'マイクの使用が許可されていません（iPhoneの「設定」→「Safari」→「マイク」で許可してください）',
  'service-not-allowed': '音声入力が使えない状態です（「設定」→「一般」→「キーボード」の「音声入力」がオンか確認してください）',
  'audio-capture': 'マイクの音が届いていません（iPhoneがマイクを止めている様子です）',
  network: '音声を文字にするサービスにつながりませんでした。ネットにつながっているか確認してください',
};
const NOT_HEARD = 'うまく聞き取れませんでした。もう一度押してください';
const STUCK = 'iPhoneの音声入力が、少しの間反応しなくなっています。30秒ほど待ってから、もう一度押してください';

/** ホーム画面に追加したアプリとして開いているか */
const standalone = () =>
  !!(navigator as unknown as { standalone?: boolean }).standalone || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

/** 部品の知らせを外して止め、捨てる */
function kill(rec: Recognition | null) {
  if (!rec) return;
  ownerOf.delete(rec);
  rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
  rec.onaudiostart = rec.onspeechstart = rec.onspeechend = rec.onaudioend = rec.onnomatch = null;
  try {
    rec.abort?.();
  } catch {
    /* 止まっている */
  }
}
/** もう自然に止まった部品を手放す（止める操作はしない） */
function forget(rec: Recognition | null) {
  if (rec) ownerOf.delete(rec);
}

function clearTimers(s: Session) {
  clearTimeout(s.stuck);
  clearTimeout(s.recover);
  clearTimeout(s.wait);
  clearTimeout(s.grace);
  clearTimeout(s.stopTimer);
}

/** 確定の文字を入れる（停止ボタンで先に入れた途中の文字と同じなら、二重に入れない） */
function deliver(s: Session, text: string) {
  const t = text.trim();
  if (!t) return;
  if (s.dedupe) {
    const d = s.dedupe;
    s.dedupe = '';
    if (t === d || d.startsWith(t) || t.startsWith(d)) {
      log(`（先に入れた「${d}」と同じなので入れない）`);
      return;
    }
  }
  s.h.onFinal(t);
}

/** 区切りで、確定しないまま残った途中の文字を、確定したものとして渡す */
function flushInterim(s: Session, remember = false) {
  const t = s.segInterim.trim();
  s.segInterim = '';
  if (t) {
    log(`確定の印がないままの途中の文字を使う「${t}」`);
    deliver(s, t);
    if (remember) s.dedupe = t;
  }
  s.h.onInterim('');
}

/**
 * 画面の上で音声入力を終える。
 * gentle：iPhone では部品を止めず、裏で聞かせておく（届いた言葉は入れる。次に押されたらそのまま使う）
 */
function finish(s: Session, error?: string, gentle = false) {
  if (!s.active) return;
  clearTimers(s);
  s.active = false;
  if (session === s) session = null;
  if (s.rec && gentle && IOS()) {
    flushInterim(s, true);
    if (lingering && lingering !== s) kill(lingering.rec);
    lingering = s;
    s.lingerSince = Date.now();
    log('画面の上は終わり（音声認識は止めずに、自然に止まるまで裏で聞く）');
  } else {
    kill(s.rec);
    s.rec = null;
    flushInterim(s);
    log('終わり');
  }
  if (error) {
    log(`知らせ：${error}`);
    // うまくいかなかったことを覚える（iPhone では、その日はキーボードの音声入力に切り替える）
    if (!error.startsWith('マイクの使用が許可されていません')) markAppVoiceFailed();
  }
  s.h.onListening(false);
  if (error) s.h.onError(error);
}

/** 部品が自然に止まった（裏で聞いていたものも含む） */
function recEnded(s: Session, rec: Recognition) {
  forget(rec);
  if (s.rec === rec) s.rec = null;
  if (lingering === s) {
    lingering = null;
    log('裏で聞いていた音声認識が自然に止まった');
    return;
  }
  if (!s.active) return;
  clearTimeout(s.grace);
  clearTimeout(s.wait);
  clearTimeout(s.stuck);
  flushInterim(s);
  if (s.stopping) return finish(s);
  if (!s.segGot) return noResult(s, '文字が返らないまま止まった');
  if (Date.now() - s.began > MAX_SESSION_MS) return finish(s);
  s.segments++;
  log(`区切り${s.segments} → 続きを聞く（${prepareForMicrophone()}）`);
  startSegment(s);
}

/** 文字が返らないとき */
function noResult(s: Session, why: string) {
  if (!s.active) return;
  if (s.gotAny) {
    log(`${why} → 話し終わったとみなして終える`);
    return finish(s, undefined, true);
  }
  if (s.segInstant || !s.rec || !s.segOnstart) {
    // 声が届いていない様子・「聞き始めた」も来ない（または部品が止まった）→ 作り直してやり直す
    if (s.retries < 2) {
      s.retries++;
      return recoverAndRetry(s, why);
    }
    log(`${why} → あきらめる`);
    return finish(s, s.segInstant ? STUCK : NOT_HEARD);
  }
  // ちゃんと聞き始めているのに文字が来ない：止めずに（裏で聞かせたまま）知らせる
  log(`${why} → 止めずに知らせる`);
  finish(s, NOT_HEARD, true);
}

/** 部品を作り直し、マイクの設定を切り替え直して、少し待ってからやり直す */
function recoverAndRetry(s: Session, why: string) {
  kill(s.rec);
  s.rec = null;
  clearTimeout(s.wait);
  clearTimeout(s.stuck);
  log(`${why} → 作り直して、自動でやり直す（${s.retries}回目）（${prepareForMicrophone()}）`);
  s.recover = window.setTimeout(() => {
    if (!s.active) return;
    if (s.stopping) return finish(s);
    startSegment(s);
  }, 600);
}

function armWait(s: Session, ms: number, why: string) {
  clearTimeout(s.wait);
  s.wait = window.setTimeout(() => {
    if (!s.active) return;
    if (s.segGot) {
      log(`${why}（文字のあと止まったまま）→ 区切りを終える`);
      // 止める操作はしない。続きは今の部品のまま聞く
      flushInterim(s);
      if (IOS()) return finish(s, undefined, true);
      const rec = s.rec;
      s.rec = null;
      kill(rec);
      return recEnded(s, rec as Recognition);
    }
    noResult(s, why);
  }, ms);
}

/** 部品の知らせを、その部品の持ち主（音声入力）へつなぐ */
function wire(rec: Recognition) {
  const who = () => {
    const s = ownerOf.get(rec);
    return s && s.rec === rec ? s : null;
  };
  rec.onstart = () => {
    const s = who();
    if (!s) return;
    const ms = Date.now() - s.segStart;
    s.segInstant = ms < INSTANT_MS;
    s.segOnstart = true;
    log(`onstart（聞き始めた・${ms}ミリ秒後）`);
    if (s.segInstant && !s.gotAny && s.active) {
      s.stuck = window.setTimeout(() => {
        if (who() !== s || !s.active || s.segSpeech || s.segGot) return;
        if (s.retries < 2) {
          s.retries++;
          recoverAndRetry(s, '4秒たっても声が届かない（すぐに聞き始めた＝声が届いていない様子）');
        }
      }, 4000);
    }
  };
  rec.onaudiostart = () => who() && log('audiostart（マイクから音が来た）');
  rec.onspeechstart = () => {
    const s = who();
    if (!s) return;
    s.segSpeech = true;
    log(`speechstart（声を見つけた）${s.active ? '' : '・裏で'}`);
  };
  rec.onspeechend = () => who() && log('speechend');
  rec.onaudioend = () => who() && log('audioend');
  rec.onnomatch = () => who() && log('nomatch（言葉にできなかった）');
  rec.onresult = (e) => {
    const s = who();
    if (!s) return;
    let interim = '';
    let gotFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      log(`result ${r.isFinal ? '確定' : '途中'}「${r[0].transcript}」${s.active ? '' : '・裏で'}`);
      if (r.isFinal) {
        gotFinal = true;
        deliver(s, r[0].transcript);
      } else interim += r[0].transcript;
    }
    s.segGot = true;
    s.gotAny = true;
    s.segInterim = gotFinal ? '' : interim;
    if (!s.active) return; // 裏で聞いているときは、確定した文字だけ入れる
    clearTimeout(s.stuck);
    s.h.onInterim(gotFinal ? '' : interim);
    if (gotFinal) {
      clearTimeout(s.wait);
      clearTimeout(s.grace);
      s.grace = window.setTimeout(() => {
        if (who() !== s || !s.active) return;
        log('確定のあと「止まった」が来ない → 区切りを終える');
        if (IOS()) return finish(s, undefined, true);
        const r = s.rec;
        s.rec = null;
        kill(r);
        recEnded(s, r as Recognition);
      }, END_GRACE_MS);
    } else armWait(s, NEXT_WAIT_MS, '途中の文字のあと何も来ない');
  };
  rec.onerror = (e) => {
    const s = who();
    if (!s) return;
    log(`error ${e.error}${e.message ? ` (${e.message})` : ''}${s.active ? '' : '・裏で'}`);
    if (!s.active || e.error === 'aborted' || e.error === 'no-speech' || e.error === 'nomatch') return; // 続けて「止まった」が来る
    if (s.segments > 0 && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
      log('自動で聞き直せなかった → ここで終える');
      return finish(s);
    }
    finish(s, MESSAGES[e.error] ?? `音声入力でエラーが起きました（${e.error}）`);
  };
  rec.onend = () => {
    const s = who();
    if (!s) return;
    log(`onend（止まった）${s.active ? '' : '・裏で'}`);
    recEnded(s, rec);
  };
}

function resetSegment(s: Session) {
  s.segGot = false;
  s.segInterim = '';
  s.segSpeech = false;
  s.segInstant = false;
  s.segOnstart = false;
  s.segStart = Date.now();
}

/** 新しい部品を作って、一言分を聞き始める */
function startSegment(s: Session) {
  kill(s.rec);
  s.rec = null;
  resetSegment(s);
  clearTimeout(s.stuck);
  const Ctor = ctor()!;
  const rec = new Ctor();
  rec.lang = 'ja-JP';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  ownerOf.set(rec, s);
  wire(rec);
  s.rec = rec;
  try {
    s.segStart = Date.now();
    rec.start();
    log(`start()（${s.segments ? `続き${s.segments}` : s.retries ? 'やり直し' : '最初'}・新しい部品・一言ずつ）`);
  } catch (e) {
    log(`start() 失敗：${e instanceof Error ? `${e.name} ${e.message}` : e}`);
    kill(rec);
    s.rec = null;
    if (s.gotAny) return finish(s);
    if (s.retries < 2) {
      s.retries++;
      return recoverAndRetry(s, 'start() に失敗');
    }
    return finish(s, '音声入力を始められませんでした。少し待ってから、もう一度押してください');
  }
  armWait(s, s.gotAny ? NEXT_WAIT_MS : firstWait(), s.gotAny ? '続きの言葉が来ない' : `${firstWait() / 1000}秒たっても文字が返らない`);
}

/** 音声入力を始める（ボタンを押したその場で呼ぶ） */
export function startSpeech(owner: object, h: SpeechHandlers): boolean {
  if (!ctor()) {
    h.onError('このブラウザは音声入力に対応していません。キーボードのマイクボタンも使えます');
    return false;
  }
  count++;
  if (session) finish(session, undefined, true);
  const paused = pauseAllMedia();
  const s: Session = {
    owner, h, n: count, began: Date.now(), active: true, rec: null, stopping: false, gotAny: false,
    segGot: false, segInterim: '', segStart: 0, segSpeech: false, segInstant: false, segOnstart: false, dedupe: '', retries: 0, segments: 0, lingerSince: 0,
  };
  session = s;
  h.onListening(true);
  // iPhone：前の音声認識がまだ裏で聞いていれば、止めずにそのまま使う
  const prev = lingering;
  const ADOPT_MS = 10000;
  if (prev?.rec && IOS() && Date.now() - prev.lingerSince > ADOPT_MS) {
    // 長い間止まらない音声認識は、固まっている様子 → 捨てて新しく始める
    log(`裏の音声認識が${ADOPT_MS / 1000}秒以上止まらない → 捨てる`);
    lingering = null;
    kill(prev.rec);
    prev.rec = null;
  }
  if (prev?.rec && IOS()) {
    lingering = null;
    const rec = prev.rec;
    prev.rec = null;
    s.rec = rec;
    s.dedupe = prev.dedupe;
    ownerOf.set(rec, s);
    resetSegment(s);
    s.segOnstart = true; // もう聞き始めている
    log(`--- ${count}回目：開始ボタン（前の音声認識がまだ聞いているので、そのまま使う${paused ? `・再生を${paused}つ止めた` : ''}）`);
    armWait(s, firstWait(), `${firstWait() / 1000}秒たっても文字が返らない`);
    // そのまま使った音声認識が、4秒たっても何も返さなければ、固まっている様子 → 新しく始める
    s.stuck = window.setTimeout(() => {
      if (!s.active || s.rec !== rec || s.segSpeech || s.segGot) return;
      log('前の音声認識が4秒たっても何も返さない → 新しく始める');
      startSegment(s);
    }, 4000);
    return true;
  }
  log(`--- ${count}回目：開始ボタン（${prepareForMicrophone()}${paused ? `・再生を${paused}つ止めた` : ''}）`);
  startSegment(s);
  return session === s;
}

/** 話し終わった：止める */
export function stopSpeech(owner?: object) {
  const s = session;
  if (!s || (owner && s.owner !== owner)) return;
  log('停止ボタン');
  s.stopping = true;
  if (!s.rec) return finish(s);
  // iPhone：途中で止めない（止めると、しばらく使えなくなるため）
  if (IOS()) return finish(s, undefined, true);
  clearTimeout(s.wait);
  try {
    s.rec.stop();
  } catch {
    /* 止まっている */
  }
  s.stopTimer = window.setTimeout(() => {
    if (s.active) {
      log(`${END_GRACE_MS / 1000}秒たっても止まらない → 終える`);
      finish(s);
    }
  }, END_GRACE_MS);
}

/** 画面を離れるとき：その画面の音声入力だけを止める */
export function releaseSpeech(owner: object) {
  if (session?.owner === owner) finish(session, undefined, true);
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
