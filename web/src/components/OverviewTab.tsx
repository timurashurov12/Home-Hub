import { Moon, Power, RefreshCw, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, fmtBytes, fmtUptime, type DeviceInfo } from '../api/client';
import { useAction } from '../toast';

export function OverviewTab({ id }: { id: string }) {
  const run = useAction();
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.info(id).then(setInfo).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="result err">{error}</div>;
  if (!info) return <div className="empty">Загружаю…</div>;

  const memUsed = info.memory.total - info.memory.available;
  const rows: [string, string][] = [
    ['Устройство', `${info.manufacturer} ${info.model} (${info.device})`],
    ['Имя в сети', info.deviceName ?? '—'],
    ['Android', `${info.android} (API ${info.sdk})`],
    ['Сборка', info.build],
    ['Разрешение', info.resolution ?? '—'],
    ['IP Wi‑Fi', info.wifiIp ?? '—'],
    ['Время работы', fmtUptime(info.uptimeSec)],
    ['Экран', info.screenOn ? 'включён' : 'спит'],
  ];

  return (
    <div className="overview">
      <div className="cards">
        <Meter label="Память (RAM)" used={memUsed} total={info.memory.total} />
        {info.storage && <Meter label="Хранилище" used={info.storage.used} total={info.storage.total} />}
      </div>
      <table className="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button onClick={load}><RefreshCw size={16} /> Обновить</button>
        <button onClick={() => run(() => api.key(id, info.screenOn ? 'sleep' : 'wakeup')).then(() => setTimeout(load, 800))}>
          {info.screenOn ? <><Moon size={16} /> Усыпить</> : <><Sun size={16} /> Разбудить</>}
        </button>
        <button className="danger" onClick={() => confirm('Перезагрузить ТВ?') && run(() => api.reboot(id), 'Перезагружается…')}>
          <Power size={16} /> Перезагрузить
        </button>
      </div>
    </div>
  );
}

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total ? Math.round((used / total) * 100) : 0;
  return (
    <div className="card">
      <div className="muted">{label}</div>
      <div className="meter">
        <div style={{ width: `${pct}%` }} className={pct > 85 ? 'hot' : ''} />
      </div>
      <div>
        {fmtBytes(used)} из {fmtBytes(total)} · {pct}%
      </div>
    </div>
  );
}
