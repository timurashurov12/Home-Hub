import { Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, FastForward, House, LayoutGrid, Menu, Play, Power, Rewind, Settings, Undo2, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAction } from '../toast';

const KEYMAP: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'ok', Escape: 'back', Backspace: 'back', Home: 'home', ' ': 'play_pause',
  '+': 'volume_up', '=': 'volume_up', '-': 'volume_down', m: 'mute',
};

export function RemoteTab({ id }: { id: string }) {
  const run = useAction();
  const [shot, setShot] = useState<string | null>(null);
  const [loadingShot, setLoadingShot] = useState(false);
  const [auto, setAuto] = useState(false);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [kbd, setKbd] = useState(false);

  const press = useCallback((key: string) => run(() => api.key(id, key)), [id, run]);
  const refreshShot = useCallback(() => {
    setLoadingShot(true);
    setShot(api.screenshotUrl(id));
  }, [id]);

  // Управление с клавиатуры компьютера
  useEffect(() => {
    if (!kbd) return;
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const k = KEYMAP[e.key];
      if (k) {
        e.preventDefault();
        press(k);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [kbd, press]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(refreshShot, 2500);
    return () => clearInterval(t);
  }, [auto, refreshShot]);

  const B = ({ k, children, cls = '' }: { k: string; children: React.ReactNode; cls?: string }) => (
    <button className={`rk ${cls}`} onClick={() => press(k)}>{children}</button>
  );

  return (
    <div className="remote-layout">
      <div className="remote">
        <div className="rrow">
          <B k="power" cls="danger"><Power /></B>
          <B k="settings"><Settings /></B>
          <B k="apps"><LayoutGrid /></B>
        </div>
        <div className="dpad">
          <span />
          <B k="up"><ChevronUp /></B>
          <span />
          <B k="left"><ChevronLeft /></B>
          <B k="ok" cls="ok">OK</B>
          <B k="right"><ChevronRight /></B>
          <span />
          <B k="down"><ChevronDown /></B>
          <span />
        </div>
        <div className="rrow">
          <B k="back"><Undo2 /></B>
          <B k="home"><House /></B>
          <B k="menu"><Menu /></B>
        </div>
        <div className="rrow">
          <B k="volume_down"><Volume1 /></B>
          <B k="mute"><VolumeX /></B>
          <B k="volume_up"><Volume2 /></B>
        </div>
        <div className="rrow">
          <B k="rewind"><Rewind /></B>
          <B k="play_pause"><Play /></B>
          <B k="fast_forward"><FastForward /></B>
        </div>
        <label className="check">
          <input type="checkbox" checked={kbd} onChange={(e) => setKbd(e.target.checked)} /> управлять с клавиатуры (стрелки, Enter, Esc, пробел, +/-)
        </label>

        <h4>Ввод текста</h4>
        <div className="row">
          <input placeholder="Текст (латиница)" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text && run(() => api.text(id, text)).then(() => setText(''))} />
          <button disabled={!text} onClick={() => run(() => api.text(id, text)).then(() => setText(''))}>Отправить</button>
        </div>
        <h4>Открыть ссылку на ТВ</h4>
        <div className="row">
          <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button disabled={!url} onClick={() => run(() => api.openUrl(id, url), 'Открыто')}>Открыть</button>
        </div>
      </div>

      <div className="screen">
        <div className="row">
          <button onClick={refreshShot}><Camera size={16} /> Скриншот</button>
          <label className="check">
            <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); if (e.target.checked) refreshShot(); }} /> обновлять автоматически
          </label>
          <div className="spacer" />
          {shot && <a className="link-icon" href={shot} download={`tv-${Date.now()}.png`}><Download size={16} /> Скачать</a>}
        </div>
        <div className={`screen-box ${loadingShot ? 'loading' : ''}`}>
          {shot ? (
            <img src={shot} alt="Экран ТВ" onLoad={() => setLoadingShot(false)} onError={() => setLoadingShot(false)} />
          ) : (
            <div className="empty">Нажми «Скриншот», чтобы увидеть экран ТВ</div>
          )}
        </div>
      </div>
    </div>
  );
}
