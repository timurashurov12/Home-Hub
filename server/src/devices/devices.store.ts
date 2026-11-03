import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface SavedDevice {
  id: string; // host:port — совпадает с serial в adb
  name: string;
  host: string;
  port: number;
  addedAt: string;
  /** применённый пресет оптимизации и всё, что нужно для отката */
  optimize?: OptimizeState;
  /** блокировка рекламы через Private DNS и исходные настройки для отката */
  dns?: DnsState;
}

export interface DnsState {
  host: string;
  provider: string;
  /** private_dns_mode / private_dns_specifier до включения ('null' — не было значения) */
  prevMode: string;
  prevSpecifier: string;
}

export interface OptimizeState {
  preset: 'soft' | 'aggressive';
  /** исходные значения settings (namespace:key → value | 'null') */
  prevSettings: Record<string, string>;
  /** пакеты, которые отключили мы (и только их включаем обратно) */
  disabled: string[];
}

/** Простое JSON-хранилище сохранённых ТВ (data/devices.json). */
@Injectable()
export class DevicesStore {
  private readonly file = resolve(process.env.DATA_DIR || resolve(process.cwd(), 'data'), 'devices.json');
  private cache?: SavedDevice[];

  async all(): Promise<SavedDevice[]> {
    if (!this.cache) {
      try {
        this.cache = JSON.parse(await readFile(this.file, 'utf8'));
      } catch {
        this.cache = [];
      }
    }
    return this.cache!;
  }

  async get(id: string) {
    return (await this.all()).find((d) => d.id === id);
  }

  async upsert(d: SavedDevice) {
    const list = await this.all();
    const i = list.findIndex((x) => x.id === d.id);
    if (i >= 0) list[i] = { ...list[i], ...d };
    else list.push(d);
    await this.flush();
    return d;
  }

  async clearOptimize(id: string) {
    return this.clearField(id, 'optimize');
  }

  async clearField(id: string, field: 'optimize' | 'dns') {
    const d = await this.get(id);
    if (d) {
      delete d[field];
      await this.flush();
    }
  }

  async remove(id: string) {
    this.cache = (await this.all()).filter((d) => d.id !== id);
    await this.flush();
  }

  private async flush() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.cache, null, 2));
  }
}
