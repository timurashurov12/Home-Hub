import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';

export interface AdbDevice {
  serial: string;
  state: string; // device | offline | unauthorized
  model?: string;
}

const PACKAGE_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;

export function assertPackage(pkg: string): string {
  if (!PACKAGE_RE.test(pkg)) throw new BadRequestException(`Некорректное имя пакета: ${pkg}`);
  return pkg;
}

/**
 * Тонкая обёртка над CLI `adb` (Android platform-tools).
 * Все вызовы идут через execFile с массивом аргументов — без системного shell.
 */
@Injectable()
export class AdbService implements OnModuleInit {
  private readonly log = new Logger(AdbService.name);
  private readonly bin = process.env.ADB_PATH || 'adb';
  available = false;

  async onModuleInit() {
    try {
      const v = await this.run(['version']);
      this.available = true;
      this.log.log(v.split('\n')[0]);
      await this.run(['start-server']);
    } catch {
      this.log.error(
        'adb не найден. Установи Android platform-tools и добавь adb в PATH или укажи ADB_PATH.',
      );
    }
  }

  run(args: string[], timeoutMs = 30_000, maxBuffer = 50 * 1024 * 1024): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || stdout || err.message).toString().trim()));
        resolve(stdout.toString());
      });
    });
  }

  runBuffer(args: string[], timeoutMs = 30_000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.bin, args);
      const chunks: Buffer[] = [];
      const errs: Buffer[] = [];
      const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      p.stdout.on('data', (c) => chunks.push(c));
      p.stderr.on('data', (c) => errs.push(c));
      p.on('error', reject);
      p.on('close', (code) => {
        clearTimeout(t);
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(Buffer.concat(errs).toString().trim() || `adb exited ${code}`));
      });
    });
  }

  async connect(host: string, port = 5555): Promise<string> {
    const out = (await this.run(['connect', `${host}:${port}`], 10_000)).trim();
    if (/cannot|failed|unable/i.test(out)) throw new Error(out);
    return out;
  }

  disconnect(serial: string) {
    return this.run(['disconnect', serial], 5_000);
  }

  async devices(): Promise<AdbDevice[]> {
    const out = await this.run(['devices', '-l'], 5_000);
    return out
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [serial, state, ...rest] = l.split(/\s+/);
        const model = rest.find((r) => r.startsWith('model:'))?.slice(6);
        return { serial, state, model };
      });
  }

  shell(serial: string, cmd: string, timeoutMs = 30_000) {
    return this.run(['-s', serial, 'shell', cmd], timeoutMs);
  }

  install(serial: string, apkPath: string) {
    // -r переустановка, -d разрешить даунгрейд, -g выдать runtime-разрешения
    return this.run(['-s', serial, 'install', '-r', '-d', '-g', apkPath], 10 * 60_000);
  }

  /** Копирует локальный файл на устройство. Большие видео могут идти долго — таймаут 2 часа. */
  push(serial: string, local: string, remote: string) {
    return this.run(['-s', serial, 'push', local, remote], 2 * 3600_000);
  }

  /** Копирует файл или папку с устройства в локальный путь. */
  pull(serial: string, remote: string, local: string) {
    return this.run(['-s', serial, 'pull', remote, local], 2 * 3600_000);
  }

  screencap(serial: string) {
    return this.runBuffer(['-s', serial, 'exec-out', 'screencap', '-p'], 20_000);
  }

  reboot(serial: string) {
    return this.run(['-s', serial, 'reboot'], 10_000);
  }
}

/** Экранирование аргумента для `adb shell` (одинарные кавычки). */
export function shQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
