import { Download, Radar, Search, Tv, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, autoScanPref, type Device, type FoundHost } from './api/client';
import { DeviceDetail } from './components/DeviceDetail';
import { InstallDialog } from './components/InstallDialog';
import { ScanDialog } from './components/ScanDialog';
import { StateDot } from './components/StateDot';

export function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [adbOk, setAdbOk] = useState(true);
  const [dialog, setDialog] = useState<'scan' | 'install' | null>(null);
  /** новые устройства из автоскана при запуске */
  const [fresh, setFresh] = useState<FoundHost[] | null>(null);
  const [startupScan, setStartupScan] = useState(false);

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

  // Автоскан сети при открытии программы: показываем устройства, которых ещё нет в списке
  useEffect(() => {
    if (!autoScanPref.get()) return;
    let cancelled = false;
    setStartupScan(true);
    (async () => {
      try {
        const [{ results }, saved] = await Promise.all([api.scan(), api.devices()]);
        if (cancelled) return;
        const savedIds = new Set(saved.filter((d) => d.saved).map((d) => d.id));
        const news = results.filter((h) => !savedIds.has(`${h.host}:${h.adbPort ?? 5555}`));
        if (news.length) {
          setFresh(results);
          // если список пуст — сразу открываем сканер
          if (!saved.some((d) => d.saved)) setDialog('scan');
        }
      } catch {
        /* сервер недоступен */
      } finally {
        if (!cancelled) setStartupScan(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const freshCount = fresh?.filter((h) => !devices.some((d) => d.saved && d.id === `${h.host}:${h.adbPort ?? 5555}`)).length ?? 0;

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

      {startupScan && (
        <div className="banner info">
          <Radar size={16} /> Ищу устройства в сети…
        </div>
      )}
      {!startupScan && freshCount > 0 && dialog !== 'scan' && (
        <div className="banner info">
          <Radar size={16} /> Найдено новых устройств в сети: {freshCount}
          <button onClick={() => setDialog('scan')}>Показать</button>
          <div className="spacer" />
          <button className="ghost" title="Скрыть" onClick={() => setFresh(null)}><X size={16} /></button>
        </div>
      )}

      <aside className="sidebar">
        {devices.length === 0 && (
          <div className="empty">
            Пока нет устройств. Нажми «Найти ТВ», чтобы просканировать сеть.
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

      {dialog === 'scan' && <ScanDialog known={devices} initial={fresh ?? undefined} onClose={() => setDialog(null)} onAdded={refresh} />}
      {dialog === 'install' && <InstallDialog devices={devices} preselect={selected} onClose={() => setDialog(null)} />}
    </div>
  );
}
