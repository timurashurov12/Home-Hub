import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AdbService, assertPackage } from '../adb/adb.service';
import { DevicesStore } from './devices.store';
import { classify, type Level } from './catalog';
import { KEYS } from './keys';

export interface DeviceView {
  id: string;
  name: string;
  host?: string;
  port?: number;
  saved: boolean;
  state: 'online' | 'offline' | 'unauthorized';
  model?: string;
}

export interface AppInfo {
  package: string;
  versionCode?: string;
  system: boolean;
  disabled: boolean;
  /** удалено для пользователя (pm uninstall --user 0), можно восстановить */
  removed?: boolean;
  /** оценка из справочника: можно ли удалять */
  level?: Level;
  label?: string;
  note?: string;
}

const HOST_RE = /^[a-zA-Z0-9.\-]+$/;

/** Экранирование для `input text` (выполняется в shell на стике). */
function escapeInputText(text: string) {
  if (/[^\x20-\x7E]/.test(text)) {
    throw new BadRequestException('`input text` поддерживает только латиницу и ASCII-символы');
  }
  return text.replace(/([\\'"`$&|;<>()*?!#~{}[\]^])/g, '\\$1').replace(/ /g, '%s');
}

function shQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class DevicesService {
  constructor(
    @Inject(AdbService) private readonly adb: AdbService,
    @Inject(DevicesStore) private readonly store: DevicesStore,
  ) {}

  async list(): Promise<DeviceView[]> {
    const [saved, live] = await Promise.all([this.store.all(), this.adb.devices().catch(() => [])]);
    const liveMap = new Map(live.map((d) => [d.serial, d]));
    const toState = (s?: string): DeviceView['state'] =>
      s === 'device' ? 'online' : s === 'unauthorized' ? 'unauthorized' : 'offline';

    const result: DeviceView[] = saved.map((d) => ({
      id: d.id,
      name: d.name,
      host: d.host,
      port: d.port,
      saved: true,
      state: toState(liveMap.get(d.id)?.state),
      model: liveMap.get(d.id)?.model?.replace(/_/g, ' '),
    }));
    // ADB-устройства, которые подключены, но не сохранены (например, по USB)
    for (const d of live) {
      if (saved.some((s) => s.id === d.serial)) continue;
      result.push({ id: d.serial, name: d.model?.replace(/_/g, ' ') ?? d.serial, saved: false, state: toState(d.state), model: d.model });
    }
    return result;
  }

  async add(host: string, port = 5555, name?: string) {
    if (!HOST_RE.test(host)) throw new BadRequestException('Некорректный адрес');
    const id = `${host}:${port}`;
    await this.adb.connect(host, port);
    let model: string | undefined;
    try {
      model = (await this.adb.shell(id, 'getprop ro.product.model', 8000)).trim();
    } catch {
      /* устройство может ждать подтверждения на экране ТВ */
    }
    const existing = await this.store.get(id);
    return this.store.upsert({
      id,
      host,
      port,
      name: name || existing?.name || model || id,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    });
  }

  async rename(id: string, name: string) {
    const d = await this.store.get(id);
    if (!d) throw new NotFoundException();
    return this.store.upsert({ ...d, name });
  }

  async remove(id: string) {
    await this.adb.disconnect(id).catch(() => undefined);
    await this.store.remove(id);
  }

  async reconnect(id: string) {
    const d = await this.store.get(id);
    if (!d) throw new NotFoundException();
    await this.adb.disconnect(id).catch(() => undefined);
    return this.adb.connect(d.host, d.port);
  }

  /** Переподключает все сохранённые ТВ (вызывается при старте и по таймеру). */
  async reconnectAll() {
    const [saved, live] = await Promise.all([this.store.all(), this.adb.devices().catch(() => [])]);
    await Promise.all(
      saved
        .filter((d) => live.find((l) => l.serial === d.id)?.state !== 'device')
        .map((d) => this.adb.connect(d.host, d.port).catch(() => undefined)),
    );
  }

  async info(id: string) {
    const sep = '__SEP__';
    const cmds = [
      'getprop ro.product.manufacturer',
      'getprop ro.product.model',
      'getprop ro.product.device',
      'getprop ro.build.version.release',
      'getprop ro.build.version.sdk',
      'getprop ro.build.display.id',
      'wm size',
      'cat /proc/meminfo',
      'df /data',
      'cat /proc/uptime',
      'settings get global device_name',
      'dumpsys power | grep -m1 mWakefulness=',
      'ip -4 -o addr show wlan0',
    ];
    const out = await this.adb.shell(id, cmds.join(`; echo ${sep}; `), 15_000);
    const p = out.split(sep).map((s) => s.trim());
    const mem = (key: string) => Number(p[7].match(new RegExp(`${key}:\\s+(\\d+)`))?.[1] ?? 0) * 1024;
    const df = p[8].split('\n')[1]?.trim().split(/\s+/) ?? [];
    return {
      manufacturer: p[0],
      model: p[1],
      device: p[2],
      android: p[3],
      sdk: Number(p[4]),
      build: p[5],
      resolution: p[6].match(/(\d+x\d+)/)?.[1],
      memory: { total: mem('MemTotal'), available: mem('MemAvailable') },
      storage: df.length >= 4 ? { total: Number(df[1]) * 1024, used: Number(df[2]) * 1024, available: Number(df[3]) * 1024 } : null,
      uptimeSec: Math.round(Number(p[9].split(' ')[0])),
      deviceName: p[10] === 'null' ? null : p[10],
      screenOn: p[11].includes('Awake'),
      wifiIp: p[12].match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null,
    };
  }

  async apps(id: string, includeSystem: boolean): Promise<AppInfo[]> {
    const parse = (out: string) =>
      out
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('package:'))
        .map((l) => {
          const m = l.match(/^package:(\S+)(?:\s+versionCode:(\d+))?/);
          return { pkg: m![1], ver: m![2] };
        });
    const [third, disabled, system, everything, installed] = await Promise.all([
      this.adb.shell(id, 'pm list packages -3 --show-versioncode'),
      this.adb.shell(id, 'pm list packages -d'),
      includeSystem ? this.adb.shell(id, 'pm list packages -s --show-versioncode') : Promise.resolve(''),
      includeSystem ? this.adb.shell(id, 'pm list packages -u') : Promise.resolve(''),
      includeSystem ? this.adb.shell(id, 'pm list packages') : Promise.resolve(''),
    ]);
    const disabledSet = new Set(parse(disabled).map((p) => p.pkg));
    const installedSet = new Set(parse(installed).map((p) => p.pkg));
    const mk = (pkg: string, ver: string | undefined, sys: boolean, removed = false): AppInfo => ({
      package: pkg,
      versionCode: ver,
      system: sys,
      disabled: disabledSet.has(pkg),
      removed,
      ...(sys ? classify(pkg) : undefined),
    });
    const apps: AppInfo[] = [
      ...parse(third).map((p) => mk(p.pkg, p.ver, false)),
      ...parse(system).map((p) => mk(p.pkg, p.ver, true)),
      // есть в -u (включая удалённые для пользователя), но нет среди установленных
      ...parse(everything)
        .filter((p) => !installedSet.has(p.pkg))
        .map((p) => mk(p.pkg, undefined, true, true)),
    ];
    return apps.sort(
      (a, b) =>
        Number(!!a.removed) - Number(!!b.removed) ||
        Number(a.system) - Number(b.system) ||
        a.package.localeCompare(b.package),
    );
  }

  async appDetails(id: string, pkg: string) {
    assertPackage(pkg);
    const out = await this.adb.shell(id, `dumpsys package ${pkg}`);
    const get = (k: string) => out.match(new RegExp(`${k}=([^\\s]+)`))?.[1];
    return {
      package: pkg,
      versionName: get('versionName'),
      versionCode: get('versionCode'),
      firstInstallTime: out.match(/firstInstallTime=([^\n]+)/)?.[1]?.trim(),
      lastUpdateTime: out.match(/lastUpdateTime=([^\n]+)/)?.[1]?.trim(),
      targetSdk: get('targetSdk'),
    };
  }

  async launch(id: string, pkg: string) {
    assertPackage(pkg);
    // Сначала пробуем лаунчер Android TV, затем обычный
    for (const cat of ['android.intent.category.LEANBACK_LAUNCHER', 'android.intent.category.LAUNCHER']) {
      const out = await this.adb.shell(id, `monkey -p ${pkg} -c ${cat} 1`);
      if (!/No activities found|aborted/i.test(out)) return { ok: true };
    }
    throw new BadRequestException('У приложения нет активности для запуска');
  }

  async appAction(
    id: string,
    pkg: string,
    action: 'stop' | 'clear' | 'uninstall' | 'disable' | 'enable' | 'restore',
    force = false,
  ) {
    assertPackage(pkg);
    const entry = classify(pkg);
    if (entry?.level === 'critical' && ['uninstall', 'disable', 'clear'].includes(action) && !force) {
      throw new BadRequestException(`«${entry.label}» критичен для системы. Нужно явное подтверждение.`);
    }
    const cmd = {
      stop: `am force-stop ${pkg}`,
      clear: `pm clear ${pkg}`,
      // Обычное приложение удаляется полностью. Предустановленное (системное) удаляем для пользователя 0:
      // без root и обратимо через install-existing. Простой `pm uninstall` для системного приложения
      // снёс бы только его обновления, поэтому сначала проверяем, системное ли оно.
      // -k сохраняет данные, чтобы после восстановления приложение работало как раньше.
      uninstall: `if pm list packages -s | grep -qx 'package:${pkg}'; then pm uninstall -k --user 0 ${pkg}; else pm uninstall ${pkg}; fi`,
      disable: `pm disable-user --user 0 ${pkg}`,
      enable: `pm enable ${pkg}`,
      restore: `cmd package install-existing ${pkg} 2>/dev/null || pm install-existing ${pkg}`,
    }[action];
    const out = (await this.adb.shell(id, cmd)).trim();
    if (/Failure|Exception|Error|Unknown package|doesn't exist/i.test(out)) throw new BadRequestException(out);
    return { ok: true, output: out };
  }

  async install(id: string, apkPath: string) {
    const out = (await this.adb.install(id, apkPath)).trim();
    if (!/Success/.test(out)) throw new BadRequestException(out);
    return { ok: true, output: out };
  }

  async installMany(ids: string[], apkPath: string) {
    return Promise.all(
      ids.map(async (id) => {
        try {
          return { id, ...(await this.install(id, apkPath)) };
        } catch (e) {
          return { id, ok: false, output: (e as Error).message };
        }
      }),
    );
  }

  /** Скачивает APK по ссылке во временную папку и ставит на указанные ТВ. */
  async installFromUrl(ids: string[], url: string) {
    if (!/^https?:\/\//i.test(url)) throw new BadRequestException('Нужна http(s)-ссылка');
    const dir = await mkdtemp(join(tmpdir(), 'tvhub-'));
    const file = join(dir, 'app.apk');
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new BadRequestException(`Не удалось скачать: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file));
      return await this.installMany(ids, file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async key(id: string, key: string) {
    const code = KEYS[key] ?? (/^\d+$/.test(key) ? Number(key) : undefined);
    if (code === undefined) throw new BadRequestException(`Неизвестная кнопка: ${key}`);
    await this.adb.shell(id, `input keyevent ${code}`, 5000);
    return { ok: true };
  }

  async text(id: string, text: string) {
    await this.adb.shell(id, `input text ${escapeInputText(text)}`, 10_000);
    return { ok: true };
  }

  async openUrl(id: string, url: string) {
    if (!/^https?:\/\/\S+$/i.test(url)) throw new BadRequestException('Нужна http(s)-ссылка');
    await this.adb.shell(id, `am start -a android.intent.action.VIEW -d ${shQuote(url)}`);
    return { ok: true };
  }

  screenshot(id: string) {
    return this.adb.screencap(id);
  }

  async reboot(id: string) {
    await this.adb.reboot(id);
    return { ok: true };
  }
}
