import { useEffect, useState } from 'react';
import { useSpeechInput } from '../lib/speech';
import { clearSpeechLog, onSpeechLog, speechEnvironment, speechLog } from '../lib/speechEngine';

/**
 * 音声入力の診断。テストのボタンを何回か押して、起きたことの記録を見る。
 * 記録の画面を撮って送ってもらえば、iPhone で何が起きているかがわかる。
 */
export function VoiceCheck() {
  const [text, setText] = useState('');
  const [lines, setLines] = useState(speechLog());
  const [copied, setCopied] = useState(false);
  const speech = useSpeechInput((chunk) => setText((t) => (t ? `${t} / ${chunk}` : chunk)));
  useEffect(() => {
    const off = onSpeechLog(() => setLines(speechLog()));
    return () => void off();
  }, []);

  const report = [...speechEnvironment(), '', ...lines].join('\n');
  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()}>
          ‹ 戻る
        </button>
        <h1 className="title">音声入力の診断</h1>
        <span style={{ width: 64 }} />
      </header>
      <main className="form">
        <section className="setting">
          <p className="small" style={{ marginTop: 0 }}>
            下のボタンを押して、ひとこと話してください。止まったら、もう一度押して話してください。これを3回くり返したあと、この画面を撮って送ってください。
          </p>
          <button className={`btn big mic ${speech.listening ? 'rec' : ''}`} style={{ width: '100%' }} onClick={speech.listening ? speech.stop : speech.start}>
            {speech.listening ? '■ 止める' : '🎙 テスト'}
          </button>
          <p className="voice-check-text">{text || '（ここに文字が出ます）'}{speech.interim && <span className="muted"> {speech.interim}</span>}</p>
          {speech.error && <p className="error small">{speech.error}</p>}
        </section>
        <section className="setting">
          <div className="bgm-head">
            <span className="bgm-label">記録</span>
            <div className="row">
              <button className="btn small" onClick={copy}>
                {copied ? 'コピーしました' : 'コピー'}
              </button>
              <button className="btn small ghost" onClick={() => (clearSpeechLog(), setText(''))}>
                消す
              </button>
            </div>
          </div>
          <pre className="voice-log">{report}</pre>
        </section>
      </main>
    </div>
  );
}
