import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { Socket } from 'node:net';
import { Bonjour, type Service } from 'bonjour-service';

/**
 * Найденная в сети приставка / ТВ.
 * Управлять можно любым Android-устройством с открытым ADB (Android TV, Google TV,
 * Fire TV, Mi Box / Mi TV Stick, Nvidia Shield, Chromecast with Google TV и т.д.).
 * Устройства без ADB тоже показываем, чтобы было видно, где надо включить отладку.
 */
export interface FoundHost {
  host: string;
  /** порт ADB, если он открыт */
  adbPort: number | null;
  name?: string;
  model?: string;
  manufacturer?: string;
  /** android-tv — есть сервис пульта Android TV; cast — только Google Cast; adb — только ADB */
  kind: 'android-tv' | 'cast' | 'adb';
  sources: ('scan' | 'mdns' | 'cast-info')[];
}

export interface ScanState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  results: FoundHost[];
  /** какие /24 подсети сканировались в последний раз */
  subnets: string[];
}

const ADB_PORT = 5555;
const ATV_REMOTE_PORT = 6466; // Android TV Remote Service (есть на всех Android TV / Google TV)
const CAST_PORT = 8009; // Google Cast
const CAST_HTTP_PORT = 8008;

function probe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host);
  });
}

/** Все IPv4-адреса в /24 подсетях локальных интерфейсов. */
export function localSubnets(): { iface: string; address: string; prefix: string }[] {
  const res: { iface: string; address: string; prefix: string }[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      const prefix = a.address.split('.').slice(0, 3).join('.');
      if (!res.some((r) => r.prefix === prefix)) res.push({ iface, address: a.address, prefix });
    }
  }
  return res;
}

const toPrefix = (s: string) => s.trim().split('.').slice(0, 3).join('.');

/**
 * Подсети для сканирования: из SCAN_SUBNETS (через запятую, напр. "192.168.1.0,192.168.0.0"),
 * иначе — подсети локальных интерфейсов. В Docker без host-сети интерфейс контейнера
 * смотрит в 172.x, поэтому там SCAN_SUBNETS обязателен.
 */
function defaultPrefixes(): string[] {
  const env = process.env.SCAN_SUBNETS?.split(',').map(toPrefix).filter(Boolean);
  return env?.length ? env : localSubnets().map((s) => s.prefix);
}

/** Имя и модель через локальный API Google Cast (есть на большинстве Android TV). */
async function castInfo(host: string): Promise<{ name?: string; model?: string; manufacturer?: string } | null> {
  try {
    const res = await fetch(`http://${host}:${CAST_HTTP_PORT}/setup/eureka_info?params=name,device_info`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return { name: j.name, model: j.device_info?.model_name, manufacturer: j.device_info?.manufacturer };
  } catch {
    return null;
  }
}

@Injectable()
export class DiscoveryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(DiscoveryService.name);
  private bonjour?: Bonjour;
  private current?: Promise<FoundHost[]>;
  state: ScanState = { running: false, startedAt: null, finishedAt: null, results: [], subnets: [] };

  onApplicationBootstrap() {
    // Автоскан при запуске сервера, чтобы интерфейс сразу показал найденные устройства
    if (process.env.AUTO_SCAN !== 'false') this.discover().catch(() => undefined);
  }

  /** Сканирует /24 подсети: ADB, сервис пульта Android TV и Google Cast. */
  async scanSubnets(subnet?: string, timeoutMs = Number(process.env.SCAN_TIMEOUT_MS) || 800): Promise<FoundHost[]> {
    const prefixes = subnet ? [toPrefix(subnet)] : defaultPrefixes();
    this.state.subnets = prefixes.map((p) => `${p}.0/24`);
    const hosts: string[] = [];
    for (const p of prefixes) for (let i = 1; i < 255; i++) hosts.push(`${p}.${i}`);

    const found: FoundHost[] = [];
    let idx = 0;
    await Promise.all(
      Array.from({ length: 96 }, async () => {
        while (idx < hosts.length) {
          const host = hosts[idx++];
          const [adb, atv, cast] = await Promise.all(
            [ADB_PORT, ATV_REMOTE_PORT, CAST_PORT].map((p) => probe(host, p, timeoutMs)),
          );
          if (!adb && !atv && !cast) continue;
          found.push({
            host,
            adbPort: adb ? ADB_PORT : null,
            kind: atv ? 'android-tv' : cast ? 'cast' : 'adb',
            sources: ['scan'],
          });
        }
      }),
    );
    // Имена и модели для устройств с Google Cast
    await Promise.all(
      found
        .filter((f) => f.kind !== 'adb')
        .map(async (f) => {
          const info = await castInfo(f.host);
          if (info) Object.assign(f, info, { sources: [...f.sources, 'cast-info'] });
        }),
    );
    this.log.log(`Скан ${prefixes.join(', ')}: найдено ${found.length}`);
    return found;
  }

  /** mDNS: Google Cast, Android TV Remote и беспроводная отладка Android 11+. */
  browseMdns(durationMs = 3000): Promise<FoundHost[]> {
    this.bonjour ??= new Bonjour();
    const found = new Map<string, FoundHost>();
    const add = (svc: Service, patch: Partial<FoundHost>) => {
      const host = svc.addresses?.find((a) => a.includes('.')) ?? svc.referer?.address;
      if (!host) return;
      const prev = found.get(host) ?? { host, adbPort: null, kind: 'adb', sources: ['mdns'] };
      found.set(host, { ...prev, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) });
    };
    const browsers = [
      this.bonjour.find({ type: 'googlecast' }, (svc) => {
        const txt = (svc.txt ?? {}) as Record<string, string>;
        add(svc, { name: txt.fn, model: txt.md, kind: 'cast' });
      }),
      this.bonjour.find({ type: 'androidtvremote2' }, (svc) => add(svc, { name: svc.name, kind: 'android-tv' })),
      this.bonjour.find({ type: 'adb-tls-connect' }, (svc) => add(svc, { name: svc.name })),
    ];
    return new Promise((resolve) =>
      setTimeout(() => {
        browsers.forEach((b) => b.stop());
        resolve([...found.values()]);
      }, durationMs),
    );
  }

  /** Полный поиск. Параллельные вызовы ждут один и тот же скан. */
  discover(opts: { subnet?: string } = {}): Promise<FoundHost[]> {
    if (this.current && !opts.subnet) return this.current;
    this.state = { ...this.state, running: true, startedAt: new Date().toISOString() };
    const run = (async () => {
      const [scan, mdns] = await Promise.all([
        this.scanSubnets(opts.subnet),
        this.browseMdns().catch(() => [] as FoundHost[]),
      ]);
      const map = new Map<string, FoundHost>();
      for (const h of [...scan, ...mdns]) {
        const prev = map.get(h.host);
        if (!prev) {
          map.set(h.host, { ...h });
          continue;
        }
        map.set(h.host, {
          host: h.host,
          adbPort: prev.adbPort ?? h.adbPort,
          name: prev.name ?? h.name,
          model: prev.model ?? h.model,
          manufacturer: prev.manufacturer ?? h.manufacturer,
          kind: prev.kind === 'android-tv' || h.kind === 'android-tv' ? 'android-tv' : prev.kind === 'cast' || h.kind === 'cast' ? 'cast' : 'adb',
          sources: [...new Set([...prev.sources, ...h.sources])],
        });
      }
      return [...map.values()].sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
    })();
    this.current = run;
    run
      .then((results) => (this.state = { ...this.state, running: false, finishedAt: new Date().toISOString(), results }))
      .catch(() => (this.state = { ...this.state, running: false }))
      .finally(() => {
        if (this.current === run) this.current = undefined;
      });
    return run;
  }

  onModuleDestroy() {
    this.bonjour?.destroy();
  }
}
