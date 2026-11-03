import { useEffect, useState } from 'react';
import { api, type Device, type FoundHost } from '../api/client';
import { useAction } from '../toast';
import { Modal } from './Modal';

export function ScanDialog({ known, onClose, onAdded }: { known: Device[]; onClose: () => void; onAdded: () => void }) {
  const run = useAction();
  const [found, setFound] = useState<FoundHost[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [subnet, setSubnet] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const scan = async () => {
    setScanning(true);
    setFound(await run(() => api.scan(subnet || undefined)) ?? []);
    setScanning(false);
  };

  useEffect(() => {
    scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async (host: string, port: number, name?: string) => {
    setBusy(`${host}:${port}`);
    const ok = await run(() => api.addDevice(host, port, name), `Подключено: ${host}`);
    setBusy(null);
    if (ok) onAdded();
  };

  const addManual = () => {
    const [host, port] = manual.trim().split(':');
    if (host) add(host, Number(port) || 5555);
  };

  return (
    <Modal title="Поиск ТВ в сети" onClose={onClose}>
      <p className="hint">
        Ищем устройства с открытым портом ADB (5555) в локальной сети. Если стик не находится, проверь, что на нём
        включена <b>отладка по сети</b> (см. README). При первом подключении на экране ТВ появится запрос — нажми
        «Разрешить» и поставь галочку «Всегда».
      </p>
      <div className="row">
        <input placeholder="Подсеть, напр. 192.168.1.0 (пусто — все)" value={subnet} onChange={(e) => setSubnet(e.target.value)} />
        <button onClick={scan} disabled={scanning}>{scanning ? 'Сканирую…' : 'Сканировать'}</button>
      </div>

      <div className="list">
        {scanning && <div className="empty">Сканирую сеть, это займёт несколько секунд…</div>}
        {!scanning && found?.length === 0 && <div className="empty">Ничего не найдено</div>}
        {!scanning &&
          found?.map((h) => {
            const id = `${h.host}:${h.port}`;
            const saved = known.some((k) => k.id === id && k.saved);
            return (
              <div key={id} className="list-row">
                <div>
                  <b>{h.name ?? h.host}</b> <small className="muted">{id} · {h.source === 'mdns' ? 'mDNS' : 'скан'}</small>
                </div>
                <button disabled={saved || busy === id} onClick={() => add(h.host, h.port, h.name)}>
                  {saved ? 'Добавлен' : busy === id ? 'Подключаю…' : 'Подключить'}
                </button>
              </div>
            );
          })}
      </div>

      <h4>Добавить вручную</h4>
      <div className="row">
        <input placeholder="192.168.1.50:5555" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManual()} />
        <button onClick={addManual} disabled={!manual || !!busy}>Подключить</button>
      </div>
    </Modal>
  );
}
