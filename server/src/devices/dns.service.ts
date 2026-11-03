import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AdbService, shQuote } from '../adb/adb.service';
import { DevicesStore } from './devices.store';

/**
 * Блокировка рекламы и трекеров через системный Private DNS (DNS-over-TLS, Android 9+).
 * Работает для всех приложений сразу, без root и без VPN. Рекламу YouTube не убирает:
 * она идёт с тех же серверов, что и видео.
 */
export type DnsProvider = 'adguard' | 'adguard-family' | 'nextdns' | 'custom';

export const DNS_PROVIDERS: Record<Exclude<DnsProvider, 'nextdns' | 'custom'>, { host: string; label: string }> = {
  adguard: { host: 'dns.adguard-dns.com', label: 'AdGuard DNS' },
  'adguard-family': { host: 'family.adguard-dns.com', label: 'AdGuard DNS «Семейный» (+ взрослый контент)' },
};

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export interface DnsRequest {
  provider: DnsProvider;
  nextdnsId?: string;
  host?: string;
}

export function resolveHost(r: DnsRequest): string {
  if (r.provider === 'nextdns') {
    const id = String(r.nextdnsId ?? '').trim();
    if (!/^[a-z0-9]{4,12}$/i.test(id)) throw new BadRequestException('NextDNS ID — 6 символов из настроек my.nextdns.io (например abc123)');
    return `${id}.dns.nextdns.io`;
  }
  if (r.provider === 'custom') {
    const host = String(r.host ?? '').trim().toLowerCase();
    if (!HOST_RE.test(host)) throw new BadRequestException('Нужно имя DNS-over-TLS сервера, например dns.example.com (не IP)');
    return host;
  }
  const p = DNS_PROVIDERS[r.provider as keyof typeof DNS_PROVIDERS];
  if (!p) throw new BadRequestException('Неизвестный провайдер');
  return p.host;
}

@Injectable()
export class DnsService {
  constructor(
    @Inject(AdbService) private readonly adb: AdbService,
    @Inject(DevicesStore) private readonly store: DevicesStore,
  ) {}

  private async saved(id: string) {
    const d = await this.store.get(id);
    if (!d) throw new NotFoundException('Сначала добавь ТВ в список');
    return d;
  }

  private async read(id: string) {
    const out = await this.adb.shell(id, 'settings get global private_dns_mode; settings get global private_dns_specifier; getprop ro.build.version.sdk');
    const [mode = 'null', spec = 'null', sdk = '0'] = out.trim().split('\n').map((s) => s.trim());
    return { mode, spec, sdk: Number(sdk) || 0 };
  }

  private async put(id: string, key: string, value: string) {
    await this.adb.shell(
      id,
      value === 'null' ? `settings delete global ${key}` : `settings put global ${key} ${shQuote(value)}`,
    );
  }

  /** Есть ли интернет по имени (после включения DNS). */
  private async resolves(id: string) {
    const out = await this.adb
      .shell(id, 'ping -c 1 -W 3 connectivitycheck.gstatic.com >/dev/null 2>&1 && echo OK || (ping -c 1 -W 3 www.google.com >/dev/null 2>&1 && echo OK)', 15_000)
      .catch(() => '');
    return out.includes('OK');
  }

  async status(id: string) {
    const [cur, d] = await Promise.all([this.read(id), this.store.get(id)]);
    return {
      supported: cur.sdk >= 28,
      mode: cur.mode, // off | opportunistic | hostname | null
      host: cur.mode === 'hostname' && cur.spec !== 'null' ? cur.spec : null,
      enabledByHub: !!d?.dns,
      provider: d?.dns?.provider ?? null,
      providers: DNS_PROVIDERS,
    };
  }

  async enable(id: string, req: DnsRequest) {
    const host = resolveHost(req);
    const d = await this.saved(id);
    const cur = await this.read(id);
    if (cur.sdk && cur.sdk < 28) throw new BadRequestException('Private DNS есть только в Android 9 и новее');
    // исходное состояние запоминаем один раз — при смене провайдера откат всё равно вернёт заводское
    const prev = d.dns ?? { prevMode: cur.mode, prevSpecifier: cur.spec };
    await this.put(id, 'private_dns_specifier', host);
    await this.put(id, 'private_dns_mode', 'hostname');
    // Android проверяет сервер в фоне; если он недоступен — у ТВ пропадёт интернет. Проверяем и откатываем.
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      ok = await this.resolves(id);
    }
    if (!ok) {
      await this.put(id, 'private_dns_mode', prev.prevMode);
      await this.put(id, 'private_dns_specifier', prev.prevSpecifier);
      if (d.dns) await this.store.clearField(id, 'dns');
      throw new BadRequestException(`${host} не отвечает с этого ТВ — настройки возвращены, интернет работает как раньше`);
    }
    await this.store.upsert({ ...d, dns: { host, provider: req.provider, prevMode: prev.prevMode, prevSpecifier: prev.prevSpecifier } });
    return this.status(id);
  }

  async disable(id: string) {
    const d = await this.saved(id);
    if (d.dns) {
      await this.put(id, 'private_dns_mode', d.dns.prevMode === 'hostname' && d.dns.prevSpecifier === d.dns.host ? 'opportunistic' : d.dns.prevMode);
      await this.put(id, 'private_dns_specifier', d.dns.prevSpecifier);
      await this.store.clearField(id, 'dns');
    } else {
      // включали не мы — просто возвращаем автоматический режим Android
      await this.put(id, 'private_dns_mode', 'opportunistic');
    }
    return this.status(id);
  }

  private async onlineSaved() {
    const online = new Set((await this.adb.devices()).filter((x) => x.state === 'device').map((x) => x.serial));
    return (await this.store.all()).filter((d) => online.has(d.id));
  }

  async enableAll(req: DnsRequest) {
    resolveHost(req); // проверим ввод до обхода устройств
    const list = await this.onlineSaved();
    return Promise.all(
      list.map(async (d) => {
        try {
          await this.enable(d.id, req);
          return { id: d.id, name: d.name, ok: true };
        } catch (e) {
          return { id: d.id, name: d.name, ok: false, error: (e as Error).message };
        }
      }),
    );
  }

  async disableAll() {
    const list = await this.onlineSaved();
    return Promise.all(
      list.map(async (d) => {
        try {
          await this.disable(d.id);
          return { id: d.id, name: d.name, ok: true };
        } catch (e) {
          return { id: d.id, name: d.name, ok: false, error: (e as Error).message };
        }
      }),
    );
  }
}
