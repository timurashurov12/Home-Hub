import { Cast, CircleCheck, Plus, Radar, Stethoscope, Tv, TriangleAlert, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, autoScanPref, type Device, type FoundHost, type ProbeResult } from '../api/client';
import { useAction } from '../toast';
import { Modal } from './Modal';

const PROBE_TEXT: Record<string, string> = {
  open: 'открыт',
  closed: 'закрыт (устройство отвечает)',
  timeout: 'нет ответа',
  EHOSTUNREACH: 'хост недоступен',
  ENETUNREACH: 'сеть недоступна',
};

const KIND = {
  'android-tv': { icon: Tv, text: 'Android TV' },
  cast: { icon: Cast, text: 'Google Cast' },
  adb: { icon: Wifi, text: 'Android (ADB)' },
} as const;

export function ScanDialog({ known, initial, onClose, onAdded }: {
  known: Device[];
  /** готовые результаты (например, автоскана при запуске) — тогда повторно не сканируем */
  initial?: FoundHost[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const run = useAction();
  const [found, setFound] = useState<FoundHost[] | null>(initial ?? null);
  const [scanning, setScanning] = useState(false);
  const [subnet, setSubnet] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [auto, setAuto] = useState(autoScanPref.get());
  const [subnets, setSubnets] = useState<string[]>([]);
  const [lan, setLan] = useState<boolean | null>(null);
  const [probeIp, setProbeIp] = useState('');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  useEffect(() => {
    api.lastScan().then((s) => { setSubnets(s.subnets); setLan(s.lanReachable); }).catch(() => undefined);
  }, []);

  const runProbe = async () => {
    setProbing(true);
    setProbe((await run(() => api.probe(probeIp.trim()))) ?? null);
    setProbing(false);
  };

  const scan = async () => {
    setScanning(true);
    const r = await run(() => api.scan(subnet || undefined));
    setFound(r?.results ?? []);
    if (r) { setSubnets(r.subnets); setLan(r.lanReachable); }
    setScanning(false);
  };

  useEffect(() => {
    if (!initial) scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSaved = (host: string, port = 5555) => known.some((k) => k.id === `${host}:${port}` && k.saved);

  const add = async (host: string, port: number, name?: string) => {
    setBusy(host);
    const ok = await run(() => api.addDevice(host, port, name), `Подключено: ${name ?? host}`);
    setBusy(null);
    if (ok) onAdded();
    return !!ok;
  };

  const addable = (found ?? []).filter((h) => h.adbPort && !isSaved(h.host, h.adbPort));
  const addAll = async () => {
    for (const h of addable) await add(h.host, h.adbPort!, h.name);
  };

  const addManual = () => {
    const [host, port] = manual.trim().split(':');
    if (host) add(host, Number(port) || 5555);
  };

  return (
    <Modal title="Устройства в сети" onClose={onClose}>
      <p className="hint">
        Ищем Android TV, Google TV, Fire TV и другие Android-приставки: по открытому ADB (порт 5555), сервису пульта
        Android TV и Google Cast. Управлять можно теми, где включена <b>отладка по сети</b> (см. README). При первом
        подключении на экране ТВ нажми «Разрешить» и отметь «Всегда».
      </p>
      <div className="row">
        <input placeholder="Подсеть, напр. 192.168.1.0 (пусто — все)" value={subnet} onChange={(e) => setSubnet(e.target.value)} />
        <button onClick={scan} disabled={scanning}>
          <Radar size={16} /> {scanning ? 'Сканирую…' : 'Сканировать'}
        </button>
      </div>

      {subnets.length > 0 && (
        <div className="muted small">
          Сканируются подсети: {subnets.join(', ')}
          {subnets.some((s) => s.startsWith('172.')) && (
            <div className="warn-text">
              <TriangleAlert size={12} /> Похоже, это внутренняя сеть Docker. Укажи домашнюю подсеть выше или в SCAN_SUBNETS в .env
            </div>
          )}
        </div>
      )}
      {lan === false && !scanning && (
        <div className="result err">
          <TriangleAlert size={16} /> Сервер не видит локальную сеть: даже роутер не отвечает. Если TV Hub запущен в Docker на
          macOS, включи Docker в «Системные настройки → Конфиденциальность и безопасность → Локальная сеть» и перезапусти Docker
          Desktop, или запусти TV Hub без Docker: <code>./scripts/start-mac.sh</code>
        </div>
      )}
      {subnets.length === 0 && found?.length === 0 && (
        <div className="warn-text small">
          <TriangleAlert size={12} /> Не найдено ни одной подсети для сканирования. Укажи её вручную, напр. 192.168.1.0
        </div>
      )}

      <div className="list">
        {scanning && <div className="empty">Сканирую сеть, это займёт несколько секунд…</div>}
        {!scanning && found?.length === 0 && (
          <div className="empty">
            Ничего не найдено. Проверь, что ТВ включён и в той же Wi‑Fi сети. На macOS разреши Docker доступ к локальной
            сети (Настройки → Конфиденциальность → Локальная сеть).
          </div>
        )}
        {!scanning &&
          found?.map((h) => {
            const K = KIND[h.kind];
            const saved = h.adbPort ? isSaved(h.host, h.adbPort) : false;
            const title = h.name ?? h.model ?? h.host;
            const sub = [h.manufacturer, h.model && h.model !== title ? h.model : null, h.host].filter(Boolean).join(' · ');
            return (
              <div key={h.host} className="list-row">
                <div className="found">
                  <K.icon size={20} className="muted" />
                  <div>
                    <b>{title}</b>
                    <div className="muted small">
                      {sub} · {K.text}
                    </div>
                    {!h.adbPort && (
                      <div className="warn-text small">
                        <TriangleAlert size={12} /> ADB закрыт: включи «Отладку по сети» на устройстве
                      </div>
                    )}
                  </div>
                </div>
                {saved ? (
                  <span className="muted small inline">
                    <CircleCheck size={14} /> добавлено
                  </span>
                ) : h.adbPort ? (
                  <button disabled={busy === h.host} onClick={() => add(h.host, h.adbPort!, h.name)}>
                    <Plus size={16} /> {busy === h.host ? 'Подключаю…' : 'Добавить'}
                  </button>
                ) : (
                  <button disabled={busy === h.host} title="Попробовать порт 5555" onClick={() => add(h.host, 5555, h.name)}>
                    Попробовать
                  </button>
                )}
              </div>
            );
          })}
      </div>
      {addable.length > 1 && !scanning && (
        <div className="row">
          <div className="spacer" />
          <button className="primary" disabled={!!busy} onClick={addAll}>
            <Plus size={16} /> Добавить все ({addable.length})
          </button>
        </div>
      )}

      <h4>Добавить вручную</h4>
      <div className="row">
        <input placeholder="192.168.1.50:5555" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addManual()} />
        <button onClick={addManual} disabled={!manual || !!busy}>Подключить</button>
      </div>

      <h4>Проверить IP</h4>
      <div className="row">
        <input placeholder="IP устройства, напр. 192.168.0.50" value={probeIp} onChange={(e) => setProbeIp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && probeIp && runProbe()} />
        <button onClick={runProbe} disabled={!probeIp || probing}><Stethoscope size={16} /> {probing ? 'Проверяю…' : 'Проверить'}</button>
      </div>
      {probe && (
        <div className="probe small">
          {probe.info?.name && <div><b>{probe.info.name}</b> {probe.info.model && <span className="muted">{probe.info.model}</span>}</div>}
          {Object.entries(probe.ports).map(([k, v]) => (
            <div key={k}>
              {{ adb: 'ADB', androidTvRemote: 'Пульт Android TV', cast: 'Google Cast' }[k]} ({v.port}):{' '}
              <span className={v.result === 'open' ? 'ok-text' : 'muted'}>{PROBE_TEXT[v.result] ?? v.result}</span>
            </div>
          ))}
          {probe.ports.adb.result !== 'open' && probe.ports.cast.result === 'open' && (
            <div className="warn-text"><TriangleAlert size={12} /> Устройство в сети, но ADB закрыт: включи «Отладку по сети / USB» в настройках разработчика</div>
          )}
          {Object.values(probe.ports).every((v) => v.result !== 'open' && v.result !== 'closed') && (
            <div className="warn-text"><TriangleAlert size={12} /> Адрес не отвечает: устройство выключено, IP другой, или сервер не видит локальную сеть</div>
          )}
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); autoScanPref.set(e.target.checked); }} /> Искать новые устройства при запуске
      </label>
    </Modal>
  );
}
