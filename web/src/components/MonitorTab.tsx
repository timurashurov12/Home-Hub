import { Activity, Cpu, HardDrive, Loader2, MemoryStick, Pause, Play, Square, Thermometer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtBytes, type DeviceStats } from '../api/client';
import { useAction } from '../toast';
import { OptimizeCard } from './OptimizeCard';

const PKG_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;
/** Имя процесса → пакет (у приложений процесс называется как пакет, иногда с :service). */
const toPkg = (name: string) => {
  const base = name.split(':')[0];
  return PKG_RE.test(base) && !base.startsWith('android.') ? base : null;
};

function Sparkline({ values, max = 100 }: { values: number[]; max?: number }) {
  if (values.length < 2) return <div className="spark empty-spark" />;
  const w = 240;
  const h = 48;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.min(v, max) / max) * h).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Загрузка CPU">
      <polyline points={`0,${h} ${pts} ${w},${h}`} className="spark-fill" />
      <polyline points={pts} className="spark-line" />
    </svg>
  );
}

function Meter({ pct }: { pct: number }) {
  return (
    <div className="meter">
      <div style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} className={pct > 85 ? 'hot' : pct > 65 ? 'warm' : ''} />
    </div>
  );
}

const tempClass = (c: number) => (c >= 80 ? 'hot-text' : c >= 65 ? 'warm-text' : '');

export function MonitorTab({ id }: { id: string }) {
  const run = useAction();
  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [live, setLive] = useState(true);
  const busy = useRef(false);
  const lastAt = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const s = await api.stats(id);
      setStats(s);
      setError(null);
      // снимок из кеша мог уже попасть в график — добавляем точку, только если данные новые
      if (s.at !== lastAt.current) {
        lastAt.current = s.at;
        setHistory((h) => [...h, s.cpu.usage].slice(-60));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }, [id]);

  useEffect(() => {
    setHistory([]);
    lastAt.current = null;
    // история хранится на сервере (Redis), поэтому график не обнуляется при перезагрузке страницы
    api
      .statsHistory(id)
      .then((h) => {
        if (!h.length) return;
        lastAt.current = h[h.length - 1].at;
        setHistory(h.map((p) => p.cpu).slice(-60));
      })
      .catch(() => undefined)
      .finally(load);
  }, [id, load]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [live, load]);

  const stop = async (pkg: string) => {
    if (!confirm(`Остановить ${pkg}?`)) return;
    await run(() => api.appAction(id, pkg, 'stop'), `Остановлено: ${pkg}`);
    load();
  };

  if (error && !stats) return <div className="result err">{error}</div>;
  if (!stats) return <div className="empty">
        <Loader2 size={18} className="spin" /> Собираю данные с приставки… Первый раз это занимает около 10 секунд.
      </div>;

  const memUsed = stats.memory.total - stats.memory.available;
  const memPct = stats.memory.total ? (memUsed / stats.memory.total) * 100 : 0;
  const stPct = stats.storage?.total ? (stats.storage.used / stats.storage.total) * 100 : 0;
  const maxTemp = stats.temps.reduce((m, t) => Math.max(m, t.celsius), 0);

  return (
    <div className="monitor">
      <div className="row">
        <span className="muted small">
          Обновлено {new Date(stats.at).toLocaleTimeString()}
          {stats.stale && <span className="muted"> · обновляется…</span>} {error && <span className="warn-text">· ошибка: {error}</span>}
        </span>
        <div className="spacer" />
        <button onClick={() => setLive((v) => !v)}>
          {live ? <><Pause size={16} /> Пауза</> : <><Play size={16} /> Обновлять</>}
        </button>
      </div>

      <div className="cards">
        <div className="card">
          <div className="muted inline"><Cpu size={14} /> Процессор</div>
          <div className="big">{stats.cpu.usage.toFixed(0)}%</div>
          <Sparkline values={history} />
          <div className="muted small">
            {stats.cpu.cores} ядер · нагрузка {stats.cpu.load.map((l) => l.toFixed(2)).join(' / ')}
          </div>
        </div>
        <div className="card">
          <div className="muted inline"><Thermometer size={14} /> Температура</div>
          <div className={`big ${tempClass(maxTemp)}`}>{maxTemp ? `${maxTemp.toFixed(0)}°C` : '—'}</div>
          <div className="temps small">
            {stats.temps.map((t) => (
              <span key={t.zone} className={tempClass(t.celsius)}>
                {t.zone}: {t.celsius.toFixed(0)}°
              </span>
            ))}
            {stats.temps.length === 0 && <span className="muted">датчики недоступны</span>}
          </div>
        </div>
        <div className="card">
          <div className="muted inline"><MemoryStick size={14} /> Память</div>
          <div className="big">{memPct.toFixed(0)}%</div>
          <Meter pct={memPct} />
          <div className="muted small">
            свободно {fmtBytes(stats.memory.available)} из {fmtBytes(stats.memory.total)}
            {stats.memory.swapTotal > 0 && ` · swap ${fmtBytes(stats.memory.swapTotal - stats.memory.swapFree)}`}
          </div>
        </div>
        {stats.storage && (
          <div className="card">
            <div className="muted inline"><HardDrive size={14} /> Хранилище</div>
            <div className="big">{stPct.toFixed(0)}%</div>
            <Meter pct={stPct} />
            <div className="muted small">свободно {fmtBytes(stats.storage.available)} из {fmtBytes(stats.storage.total)}</div>
          </div>
        )}
      </div>

      <OptimizeCard id={id} onDone={load} />

      <div className="two-col">
        <div>
          <h4 className="inline"><Activity size={16} /> Нагружают процессор</h4>
          <table className="apps">
            <thead>
              <tr><th>Процесс</th><th>CPU</th><th>Память</th><th /></tr>
            </thead>
            <tbody>
              {stats.topCpu.map((p) => {
                const pkg = toPkg(p.name);
                return (
                  <tr key={p.pid}>
                    <td>{p.name} <span className="muted small">pid {p.pid}</span></td>
                    <td className={p.cpu > 50 ? 'hot-text' : ''}>{p.cpu.toFixed(1)}%</td>
                    <td className="muted">{p.res ? fmtBytes(p.res) : `${p.mem}%`}</td>
                    <td className="actions">
                      {pkg && <button title="Остановить" onClick={() => stop(pkg)}><Square size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
              {stats.topCpu.length === 0 && <tr><td colSpan={4} className="empty">Нет данных</td></tr>}
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="inline"><MemoryStick size={16} /> Занимают память</h4>
          <table className="apps">
            <thead>
              <tr><th>Приложение</th><th>Память</th><th /></tr>
            </thead>
            <tbody>
              {stats.topMem.map((p) => {
                const pkg = toPkg(p.name);
                return (
                  <tr key={p.pid}>
                    <td>{p.name}</td>
                    <td>{fmtBytes(p.bytes)}</td>
                    <td className="actions">
                      {pkg && <button title="Остановить" onClick={() => stop(pkg)}><Square size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
              {stats.topMem.length === 0 && <tr><td colSpan={3} className="empty">Нет данных</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
