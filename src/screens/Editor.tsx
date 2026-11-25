import { useEffect, useRef, useState } from 'react';
import { deleteMemory, getMediaFor, getMemory, isSealed, listTags, newId, saveMemory } from '../data/repository';
import { dayStart, tomorrow, yearsLater } from '../lib/letter';
import { navigate } from '../router';
import type { DateSource, MediaDraft, Memory } from '../data/types';
import { Thumb } from '../components/Thumb';
import { TagPicker } from '../components/TagPicker';
import { importFile } from '../lib/media';
import { VoiceError, VoiceText } from '../components/VoiceText';
import { switchToKeyboardVoice } from '../lib/voiceMethod';
import { toLocalInput } from '../lib/format';
import { FeelingChips, appendWord } from '../components/FeelingChips';
import { useSetting } from '../lib/settings';
import { startVoice, stopVoice, useVoiceSession, voiceSupported } from '../lib/voiceSession';


const joinSpeech = (t: string, chunk: string) => (t ? `${t}${/[。！？\s]$/.test(t) ? '' : '。'}` : '') + chunk.trim();

/**
 * 記録の作成・編集。
 * voice：一覧の「声で入力」から来たとき（録音はもう始まっている）
 */
export function Editor({ id, voice, keyboard }: { id?: string; voice?: boolean; keyboard?: boolean }) {
  /** キーボードの音声入力で、気持ちの欄を最初に出す（一覧の「声で入力」から来たとき・途中で切り替えたとき） */
  const [kb] = useState(!!keyboard);
  /** 声で入力に失敗して、キーボードの音声入力に切り替えた */
  const [voiceOff, setVoiceOff] = useState(false);
  const [lastTags, setLastTags] = useSetting('lastTags');
  const [memory, setMemory] = useState<Memory>();
  const [media, setMedia] = useState<MediaDraft[]>([]);
  const [text, setText] = useState('');
  // 新しい記録では、前回使ったタグを最初から選んでおく
  const [tags, setTags] = useState<string[]>(() => (id ? [] : lastTags));
  const presetTags = !id && lastTags.length > 0;
  // 「声で入力」：一覧のボタンで始めた録音の言葉を、気持ちの欄に入れていく
  const vs = useVoiceSession((chunk) => voice && setText((t) => joinSpeech(t, chunk)));
  const [date, setDate] = useState(() => Date.now());
  /** 日付を自分で変えたら、写真の撮影日で上書きしない */
  const [dateTouched, setDateTouched] = useState(false);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 未来への手紙
  const [isLetter, setIsLetter] = useState(false);
  const [letterTo, setLetterTo] = useState('');
  const [openOn, setOpenOn] = useState(() => yearsLater(1));
  const [confirmSeal, setConfirmSeal] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  /** 差し替え中の写真ID */
  const replacing = useRef<string | null>(null);

  useEffect(() => {
    listTags().then(setKnownTags);
    if (!id) return;
    (async () => {
      const m = await getMemory(id);
      if (!m) return history.back();
      // 封をした手紙は、日付が来るまで中身を見せない（封筒の画面へ）
      if (isSealed(m)) return navigate(`/letter/${encodeURIComponent(m.id)}`, true);
      setMemory(m);
      setText(m.text);
      setTags(m.tags);
      setDate(m.date);
      setDateTouched(true);
      setMedia(await getMediaFor(m));
    })();
  }, [id]);

  // 記録の日付は、写真・動画のいちばん古い日付を自動で入れる
  useEffect(() => {
    if (dateTouched) return;
    const taken = media.filter((m) => m.takenAt && m.dateSource !== 'memory').map((m) => m.takenAt!);
    if (taken.length) setDate(Math.min(...taken));
  }, [media, dateTouched]);

  /** 写真1枚の日付を手で直す */
  const setMediaDate = (id: string, t: number) =>
    setMedia((l) => l.map((x) => (x.id === id ? { ...x, takenAt: t, dateSource: 'manual' as const } : x)));

  const sortByDate = () => setMedia((l) => [...l].sort((a, b) => (a.takenAt ?? date) - (b.takenAt ?? date)));
  const outOfOrder = media.some((m, i) => i > 0 && (m.takenAt ?? date) < (media[i - 1].takenAt ?? date));

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setNotice(undefined);
    const added: MediaDraft[] = [];
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        added.push(await importFile(f));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : '読み込めないファイルがありました');
      }
    }
    setMedia((m) => [...m, ...added]);
    if (errors.length) setNotice([...new Set(errors)].join('\n'));
    setBusy(false);
  }

  /** 見つからなくなった写真を、別のファイルで差し替える（コメントは残す） */
  async function onReplace(files: FileList | null) {
    const targetId = replacing.current;
    replacing.current = null;
    const f = files?.[0];
    if (!f || !targetId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const fresh = await importFile(f);
      setMedia((list) => list.map((x) => (x.id === targetId ? { ...fresh, caption: x.caption } : x)));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '読み込めませんでした');
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    const now = Date.now();
    const base: Memory = memory
      ? { ...memory, text: text.trim(), tags, date }
      : { id: newId(), text: text.trim(), tags, date, mediaIds: [], createdAt: now, updatedAt: now };
    const m: Memory = isLetter ? { ...base, sealedUntil: dayStart(openOn), letterTo: letterTo.trim() || undefined, openedAt: undefined } : base;
    try {
      setLastTags(tags);
      await saveMemory(
        m,
        media.map((x) => ({
          ...x,
          caption: x.caption?.trim() || undefined,
          // 日付がわからない写真は、記録の日付を使う
          ...(!x.takenAt || x.dateSource === 'memory' ? { takenAt: date, dateSource: 'memory' as const } : {}),
        })),
      );
      history.back();
    } catch (e) {
      setBusy(false);
      setNotice(
        e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'QuotaExceeded' || /quota/i.test(e.message))
          ? '端末の保存容量が足りません'
          : e instanceof Error && e.message.includes('保存に失敗')
            ? e.message
            : '保存できませんでした',
      );
    }
  }

  async function remove() {
    if (!memory) return;
    await deleteMemory(memory.id);
    history.back();
  }

  const move = (i: number, d: number) =>
    setMedia((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const canSave = !busy && (media.length > 0 || text.trim().length > 0);
  const letterOk = !!openOn && dayStart(openOn) > Date.now();
  const [oy, om, od] = openOn ? openOn.split('-').map(Number) : [0, 0, 0];

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => history.back()}>
          キャンセル
        </button>
        <h1 className="title">{memory ? '思い出を編集' : voice || kb ? '声で入力' : '思い出を記録'}</h1>
        <button className="btn primary" disabled={!canSave || (isLetter && !letterOk)} onClick={() => (isLetter ? setConfirmSeal(true) : save())}>
          保存
        </button>
      </header>

      {confirmSeal && (
        <div className="otd-modal" role="dialog" aria-modal="true" aria-label="封をする">
          <div className="otd-sheet">
            <p className="otd-kicker">未来への手紙</p>
            <h2 className="otd-title" style={{ fontSize: 20 }}>封をしますか？</h2>
            <p className="small">
              {oy}年{om}月{od}日 まで、あなたも含めて誰も中身を見られません。
              <br />
              その日が来たら、アプリを開いたときにお知らせします。
            </p>
            <p className="muted small">
              手紙はこの端末の中だけに保存されます。機種変更や初期化で消えないよう、設定の「バックアップ」で保管してください。
            </p>
            <button
              className="btn primary big"
              onClick={() => {
                setConfirmSeal(false);
                void save();
              }}
            >
              ✉ 封をする
            </button>
            <button className="btn ghost" onClick={() => setConfirmSeal(false)}>
              もう少し書く
            </button>
          </div>
        </div>
      )}

      <main className="form">
        {kb && !memory && (
          <section>
            <h2 className="label">その時の気持ち</h2>
            <VoiceText keyboardNow value={text} onChange={setText} rows={4} placeholder="一言でOK。写真・動画はこのあと選べます" />
          </section>
        )}
        {voiceOff && <p className="keyboard-hint">下の「その時の気持ち」で、キーボードの🎤を押して話してください</p>}
        {voice && !kb && !voiceOff && (
          <section className={`voice-panel ${vs.listening ? 'rec' : ''}`} aria-live="polite">
            <div className="voice-orb" aria-hidden="true">🎙</div>
            {vs.listening ? (
              <>
                <p className="voice-lead">聞いています。どうぞ話してください</p>
                <p className="voice-live">
                  {text}
                  <span className="muted">{vs.interim}</span>
                </p>
                <button type="button" className="btn big" onClick={stopVoice}>
                  ■ 話し終わった
                </button>
              </>
            ) : (
              <>
                <p className="voice-lead">
                  {text ? '文字にしました。写真・動画はこのあと選べます。' : vs.error ? '' : '話した言葉が文字になります'}
                </p>
                {text && <p className="voice-live">{text}</p>}
                {voiceSupported() && (
                  <button type="button" className="btn big" onClick={() => startVoice()}>
                    🎙 {text ? '続けて話す' : '話す'}
                  </button>
                )}
              </>
            )}
            {vs.error && (
              <VoiceError
                message={vs.error}
                onKeyboard={() => {
                  switchToKeyboardVoice();
                  // 下の気持ちの欄にキーボードを出す（このタップの中で：iPhone はそうしないとキーボードが出ない）
                  const el = document.querySelector<HTMLTextAreaElement>('#feeling-text textarea');
                  el?.focus();
                  el?.scrollIntoView({ block: 'center' });
                  setVoiceOff(true);
                }}
              />
            )}
          </section>
        )}
        <section>
          <h2 className="label">写真・動画</h2>
          <div className="media-list">
            {media.map((m, i) => (
              <div key={m.id} className="media-row">
                <div className="media-cell">
                  <Thumb item={m} />
                  {m.missing && (
                    <button
                      type="button"
                      className="btn small replace-btn"
                      onClick={() => {
                        replacing.current = m.id;
                        replaceRef.current?.click();
                      }}
                      disabled={busy}
                    >
                      差し替え
                    </button>
                  )}
                  <div className="media-actions">
                    <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="前へ">‹</button>
                    <button onClick={() => setMedia((l) => l.filter((x) => x.id !== m.id))} aria-label="外す">×</button>
                    <button onClick={() => move(i, 1)} disabled={i === media.length - 1} aria-label="後へ">›</button>
                  </div>
                </div>
                <div className="media-meta">
                  <div className="media-date">
                    <input
                      type="datetime-local"
                      aria-label="この写真の日付"
                      value={toLocalInput(m.takenAt && m.dateSource !== 'memory' ? m.takenAt : date)}
                      onChange={(e) => {
                        const t = new Date(e.target.value).getTime();
                        if (!isNaN(t)) setMediaDate(m.id, t);
                      }}
                    />
                    <span className={`date-source ${weakSource(m) ? 'weak' : ''}`}>{sourceLabel(m)}</span>
                  </div>
                  <VoiceText
                    compact
                    rows={3}
                    value={m.caption ?? ''}
                    onChange={(v) => setMedia((l) => l.map((x) => (x.id === m.id ? { ...x, caption: v } : x)))}
                    placeholder="一言でOK（例：うれしかった！）"
                  />
                </div>
              </div>
            ))}
          </div>
          {outOfOrder && (
            <button type="button" className="btn small" onClick={sortByDate}>
              日付順に並べ替える
            </button>
          )}
          <div className="row">
            <button className="btn big" onClick={() => cameraRef.current?.click()} disabled={busy}>
              📷 撮影する
            </button>
            <button className="btn big" onClick={() => libraryRef.current?.click()} disabled={busy}>
              🖼 ライブラリから
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
          <input ref={replaceRef} type="file" accept="image/*,video/*" hidden onChange={(e) => (onReplace(e.target.files), (e.target.value = ''))} />
          <input ref={libraryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
          {busy && <p className="muted small">読み込み中…</p>}
        </section>

        <section id="feeling-text">
          {!(kb && !memory) && (
            <>
              <h2 className="label">その時の気持ち</h2>
              <VoiceText keyboardNow={voiceOff} value={text} onChange={setText} rows={3} placeholder="一言でOK。写真だけ先に保存して、あとから足すこともできます" />
            </>
          )}
          <FeelingChips onPick={(w) => setText((t) => appendWord(t, w))} />
        </section>

        <section>
          <h2 className="label">記録の日付</h2>
          <input
            type="datetime-local"
            value={toLocalInput(date)}
            onChange={(e) => {
              const t = new Date(e.target.value).getTime();
              if (!isNaN(t)) {
                setDate(t);
                setDateTouched(true);
              }
            }}
          />
          <p className="muted small">
            {!dateTouched && media.some((m) => m.takenAt && m.dateSource !== 'memory')
              ? 'いちばん古い写真・動画の日付を自動で入れました。'
              : ''}
            日付がわからない写真や、文字だけの記録はこの日付になります。
          </p>
        </section>

        <section>
          <h2 className="label">タグ</h2>
          {presetTags && tags.length > 0 && <p className="muted small">前回のタグを選んでいます。タップで外せます。</p>}
          <TagPicker value={tags} onChange={setTags} known={knownTags} />
        </section>

        {(!memory || !memory.openedAt) && (
          <section className={`letter-option ${isLetter ? 'on' : ''}`}>
            <label className="setting-row">
              <span>
                <strong>✉ 未来への手紙にする</strong>
                <small>決めた日が来るまで、中身（写真・言葉）を見られなくします。例：子どもが20歳になる日に開く手紙</small>
              </span>
              <input type="checkbox" className="toggle" checked={isLetter} onChange={(e) => setIsLetter(e.target.checked)} />
            </label>
            {isLetter && (
              <div className="letter-fields">
                <label className="field">
                  <span className="label">宛名</span>
                  <input value={letterTo} onChange={(e) => setLetterTo(e.target.value)} placeholder="例：20歳の〇〇へ" maxLength={40} />
                </label>
                <div className="field">
                  <span className="label">開けられる日</span>
                  <div className="chips">
                    {[1, 3, 10, 20].map((n) => (
                      <button key={n} type="button" className={`chip ${openOn === yearsLater(n) ? 'on' : ''}`} onClick={() => setOpenOn(yearsLater(n))}>
                        {n}年後
                      </button>
                    ))}
                  </div>
                  <input type="date" value={openOn} min={tomorrow()} onChange={(e) => setOpenOn(e.target.value)} />
                  {!letterOk && <p className="error small">明日以降の日付を選んでください</p>}
                </div>
              </div>
            )}
          </section>
        )}

        {notice && <p className="error">{notice}</p>}

        {memory &&
          (confirmDelete ? (
            <div className="confirm">
              <p>この思い出を削除しますか？元に戻せません。</p>
              <div className="row">
                <button className="btn" onClick={() => setConfirmDelete(false)}>
                  やめる
                </button>
                <button className="btn danger" onClick={remove}>
                  削除する
                </button>
              </div>
            </div>
          ) : (
            <button className="btn danger" onClick={() => setConfirmDelete(true)}>
              この思い出を削除
            </button>
          ))}
      </main>
    </div>
  );
}

const SOURCE_LABELS: Record<DateSource, string> = {
  exif: '撮影日（写真のデータ）',
  video: '撮影日（動画のデータ）',
  file: 'ファイルの日付（撮影日が見つかりません）',
  memory: '撮影日が見つかりません（記録の日付）',
  manual: '手で入力した日付',
};

function sourceLabel(m: MediaDraft): string {
  if (!m.takenAt) return SOURCE_LABELS.memory;
  return m.dateSource ? SOURCE_LABELS[m.dateSource] : '以前に保存した日付';
}

/** 撮影日ではない（あてにならない）日付か */
const weakSource = (m: MediaDraft) => !m.takenAt || m.dateSource === 'file' || m.dateSource === 'memory';
