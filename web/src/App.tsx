import { Download, Search, Tv } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type Device } from './api/client';
import { DeviceDetail } from './components/DeviceDetail';
import { InstallDialog } from './components/InstallDialog';
import { ScanDialog } from './components/ScanDialog';
import { StateDot } from './components/StateDot';

export function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adbOk, setAdbOk] = useState(true);
  const [dialog, setDialog] = useState<'scan' | 'install' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.devices();
      setDevices(list);
      setSelected((s) => s ?? list[0]?.id ?? null);
    } catch {
      /* сервер недоступен */
    }
  }, []);

  useEffect(() => {
    api.health().then((h) => setAdbOk(h.adb)).catch(() => setAdbOk(false));
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const current = devices.find((d) => d.id === selected) ?? null;

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand"><Tv size={20} /> TV Hub</div>
        <div className="spacer" />
        <button onClick={() => setDialog('scan')}><Search size={16} /> Найти ТВ</button>
        <button className="primary" disabled={!devices.some((d) => d.state === 'online')} onClick={() => setDialog('install')}>
          <Download size={16} /> Установить APK
        </button>
      </header>

      {!adbOk && (
        <div className="banner">
          Сервер не нашёл <code>adb</code>. Установи Android platform-tools и перезапусти сервер (или укажи путь в
          переменной <code>ADB_PATH</code>).
        </div>
      )}

      <aside className="sidebar">
        {devices.length === 0 && (
          <div className="empty">
            Пока нет ТВ. Нажми «Найти ТВ», чтобы просканировать сеть.
          </div>
        )}
        {devices.map((d) => (
          <button key={d.id} className={`device-item ${d.id === selected ? 'active' : ''}`} onClick={() => setSelected(d.id)}>
            <StateDot state={d.state} />
            <span className="device-name">
              <b>{d.name}</b>
              <small>{d.id}</small>
            </span>
          </button>
        ))}
      </aside>

      <main className="content">
        {current ? (
          <DeviceDetail key={current.id} device={current} onChanged={refresh} onRemoved={() => { setSelected(null); refresh(); }} />
        ) : (
          <div className="empty big">Выбери ТВ слева</div>
        )}
      </main>

      {dialog === 'scan' && <ScanDialog known={devices} onClose={() => setDialog(null)} onAdded={refresh} />}
      {dialog === 'install' && <InstallDialog devices={devices} preselect={selected} onClose={() => setDialog(null)} />}
    </div>
  );
}
