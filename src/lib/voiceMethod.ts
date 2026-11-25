import { useEffect, useState } from 'react';
import { readSetting, useSetting } from './settings';

/* 「声で入力」のやり方。
 * - app：アプリの音声認識（ボタンを押すとすぐ聞き始める）
 * - keyboard：iPhone のキーボードの音声入力（🎤）。押すと入力欄にキーボードが出るので、🎤を押して話す。
 *   iPhone 本体の機能なので、何回続けても安定して使える
 * - auto（はじめの設定）：アプリの音声認識を使い、iPhone でうまくいかなかったら、
 *   その日はキーボードの音声入力に切り替える */

export type VoiceMethod = 'auto' | 'app' | 'keyboard';

const isIOSDevice = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const FAIL_KEY = 'meguru.voiceFailedOn';
const today = () => new Date().toDateString();
const listeners = new Set<() => void>();

function failedToday(): boolean {
  try {
    return localStorage.getItem(FAIL_KEY) === today();
  } catch {
    return false;
  }
}

/** アプリの音声認識がうまくいかなかった（iPhone のとき、その日はキーボードの音声入力にする） */
export function markAppVoiceFailed() {
  if (!isIOSDevice()) return;
  try {
    localStorage.setItem(FAIL_KEY, today());
  } catch {
    /* 覚えられなくても、この画面では切り替わる */
  }
  listeners.forEach((f) => f());
}

/** キーボードの音声入力を使うか（画面の外から） */
export function keyboardVoiceNow(): boolean {
  const m = readSetting('voiceMethod');
  return m === 'keyboard' || (m === 'auto' && isIOSDevice() && failedToday());
}

/** キーボードの音声入力を使うか（画面から。切り替わったら描き直す） */
export function useKeyboardVoice(): boolean {
  const [method] = useSetting('voiceMethod');
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return method === 'keyboard' || (method === 'auto' && isIOSDevice() && failedToday());
}

/** 今すぐキーボードの音声入力に切り替える（エラーのときのボタン） */
export function switchToKeyboardVoice() {
  try {
    localStorage.setItem(FAIL_KEY, today());
  } catch {
    /* この画面では切り替わる */
  }
  listeners.forEach((f) => f());
}

export const KEYBOARD_HINT = 'キーボードの🎤（マイク）を押して話してください。話した言葉がここに入ります。🎤が見つからないときは、iPhoneの「設定」→「一般」→「キーボード」→「音声入力」をオンにしてください';
