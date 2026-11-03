import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type DnsProvider, type DnsRequest, type DnsStatus } from '../api/client';
import { useAction, useToast } from '../toast';

const PROVIDERS: { id: DnsProvider; title: string; text: string }[] = [
  { id: 'adguard', title: 'AdGuard DNS', text: 'Бесплатно, без регистрации. Реклама и трекеры.' },
  { id: 'adguard-family', title: 'AdGuard «Семейный»', text: 'То же + блокировка взрослого контента, безопасный поиск.' },
  { id: 'nextdns', title: 'NextDNS', text: 'Свои списки и статистика, бесплатно до 300 тыс. запросов в месяц. Нужен ID с my.nextdns.io.' },
  { id: 'custom', title: 'Свой сервер', text: 'Любой DNS-over-TLS сервер по имени, например свой AdGuard Home.' },
];

export function AdBlockCard({ id }: { id: string }) {
  const run = useAction();
  const toast = useToast();
  const [st, setSt] = useState<DnsStatus | null>(null);
  const [provider, setProvider] = useState<DnsProvider>('adguard');
  const [nextdnsId, setNextdnsId] = useState('');
  const [host, setHost] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.dns(id).then((s) => {
    setSt(s);
    if (s.provider) setProvider(s.provider);
  }).catch(() => undefined);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const req = (): DnsRequest => ({ provider, nextdnsId: nextdnsId || undefined, host: host || undefined });

  const report = (r: { name: string; ok: boolean; error?: string }[], what: string) => {
    r.filter((x) => !x.ok).forEach((x) => toast(`${x.name}: ${x.error}`, 'err'));
    const ok = r.filter((x) => x.ok).length;
    toast(`${what}: ${ok} из ${r.length} ТВ`, ok === r.length ? 'ok' : 'err');
  };

  const enable = async () => {
    setBusy(true);
    if (all) {
      const r = await run(() => api.dnsAllOn(req()));
      if (r) report(r, 'Блокировка включена');
    } else {
      await run(() => api.dnsOn(id, req()), 'Блокировка рекламы включена');
    }
    setBusy(false);
    load();
  };

  const disable = async () => {
    setBusy(true);
    if (all) {
      const r = await run(() => api.dnsAllOff());
      if (r) report(r, 'Блокировка выключена');
    } else {
      await run(() => api.dnsOff(id), 'Блокировка выключена, настройки DNS возвращены');
    }
    setBusy(false);
    load();
  };

  if (!st) return null;
  if (!st.supported) {
    return (
      <div className="card">
        <h4><ShieldOff size={16} /> Блокировка рекламы</h4>
        <div className="muted">Нужен Android 9 или новее — на этом ТВ системного Private DNS нет.</div>
      </div>
    );
  }

  const active = st.mode === 'hostname' && st.host;
  const canEnable = provider === 'nextdns' ? /^[a-z0-9]{4,12}$/i.test(nextdnsId) : provider === 'custom' ? host.includes('.') : true;

  return (
    <div className="card adblock">
      <h4>
        {active ? <ShieldCheck size={16} className="ok-text" /> : <ShieldOff size={16} />} Блокировка рекламы
      </h4>
      <div>
        {active ? (
          <>Включена: <b>{st.host}</b>{!st.enabledByHub && <span className="muted"> (настроено не через панель)</span>}</>
        ) : (
          <span className="muted">Выключена ({st.mode === 'off' ? 'Private DNS отключён' : 'обычный DNS провайдера'})</span>
        )}
      </div>
      <p className="muted small">
        Системный Private DNS: реклама и трекеры блокируются во всех приложениях и на главном экране, без root и VPN. Рекламу в
        YouTube так убрать нельзя — она идёт с тех же серверов, что и видео (для этого есть SmartTube). Если сервер не ответит,
        панель сама вернёт прежние настройки.
      </p>
      <div className="presets">
        {PROVIDERS.map((p) => (
          <label key={p.id} className={`preset ${provider === p.id ? 'active' : ''}`}>
            <input type="radio" name={`dns-${id}`} checked={provider === p.id} onChange={() => setProvider(p.id)} />
            <b>{p.title}</b>
            <span className="muted small">{p.text}</span>
          </label>
        ))}
      </div>
      {provider === 'nextdns' && <input placeholder="NextDNS ID, например abc123" value={nextdnsId} onChange={(e) => setNextdnsId(e.target.value.trim())} />}
      {provider === 'custom' && <input placeholder="dns.example.com" value={host} onChange={(e) => setHost(e.target.value.trim())} />}
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> на всех ТВ в сети
        </label>
        <div className="spacer" />
        <button className="primary" disabled={busy || !canEnable} onClick={enable}>
          {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />} {active ? 'Применить' : 'Включить'}
        </button>
        <button disabled={busy || (!active && !all)} onClick={disable}>
          <ShieldOff size={16} /> Выключить
        </button>
      </div>
    </div>
  );
}
