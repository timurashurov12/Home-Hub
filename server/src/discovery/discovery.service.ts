import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { Socket } from 'node:net';
import { Bonjour } from 'bonjour-service';

export interface FoundHost {
  host: string;
  port: number;
  source: 'scan' | 'mdns';
  name?: string;
}

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

@Injectable()
export class DiscoveryService implements OnModuleDestroy {
  private readonly log = new Logger(DiscoveryService.name);
  private bonjour?: Bonjour;

  /** Сканирует /24 подсети на открытый порт ADB (по умолчанию 5555). */
  async scanSubnets(port = 5555, subnet?: string, timeoutMs = 400): Promise<FoundHost[]> {
    const prefixes = subnet ? [toPrefix(subnet)] : defaultPrefixes();
    const hosts: string[] = [];
    for (const p of prefixes) for (let i = 1; i < 255; i++) hosts.push(`${p}.${i}`);

    const found: FoundHost[] = [];
    const concurrency = 128;
    let idx = 0;
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (idx < hosts.length) {
          const host = hosts[idx++];
          if (await probe(host, port, timeoutMs)) found.push({ host, port, source: 'scan' });
        }
      }),
    );
    this.log.log(`Скан ${prefixes.join(', ')}: найдено ${found.length}`);
    return found;
  }

  /** mDNS: беспроводная отладка Android 11+ и некоторые прошивки объявляют _adb-tls-connect / _adb. */
  browseMdns(durationMs = 3000): Promise<FoundHost[]> {
    this.bonjour ??= new Bonjour();
    const found = new Map<string, FoundHost>();
    const browsers = ['adb-tls-connect', 'adb', 'androidtvremote2'].map((type) =>
      this.bonjour!.find({ type }, (svc) => {
        const host = svc.addresses?.find((a) => a.includes('.')) ?? svc.referer?.address;
        if (!host) return;
        const port = type === 'androidtvremote2' ? 5555 : svc.port;
        const key = `${host}:${port}`;
        if (!found.has(key)) found.set(key, { host, port, source: 'mdns', name: svc.name });
      }),
    );
    return new Promise((resolve) =>
      setTimeout(() => {
        browsers.forEach((b) => b.stop());
        resolve([...found.values()]);
      }, durationMs),
    );
  }

  async discover(opts: { port?: number; subnet?: string } = {}): Promise<FoundHost[]> {
    const [scan, mdns] = await Promise.all([
      this.scanSubnets(opts.port ?? 5555, opts.subnet),
      this.browseMdns().catch(() => [] as FoundHost[]),
    ]);
    const map = new Map<string, FoundHost>();
    for (const h of [...mdns, ...scan]) {
      const prev = map.get(h.host);
      map.set(h.host, prev ? { ...h, name: prev.name ?? h.name } : h);
    }
    return [...map.values()].sort((a, b) =>
      a.host.localeCompare(b.host, undefined, { numeric: true }),
    );
  }

  onModuleDestroy() {
    this.bonjour?.destroy();
  }
}
