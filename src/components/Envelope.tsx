/** 封筒の絵（CSS だけで描く）。open で、ふたが開いて便せんが出てくる */
export function Envelope({ to, open, ready, small }: { to?: string; open?: boolean; ready?: boolean; small?: boolean }) {
  return (
    <div className={`envelope ${open ? 'open' : ''} ${ready ? 'ready' : ''} ${small ? 'small' : ''}`} aria-hidden="true">
      <div className="env-paper" />
      <div className="env-body">{to && !small && <span className="env-to">{to}</span>}</div>
      <div className="env-flap" />
      <div className="env-seal">め</div>
    </div>
  );
}
