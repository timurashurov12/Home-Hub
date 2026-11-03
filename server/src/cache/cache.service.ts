import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Кеш поверх Redis (REDIS_URL). Если Redis не задан или недоступен —
 * работает в памяти процесса, чтобы приложение запускалось и без него.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly log = new Logger('Cache');
  private readonly redis: Redis | null;
  private readonly mem = new Map<string, { v: string; exp: number }>();
  private readonly memLists = new Map<string, string[]>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.redis = null;
      this.log.log('REDIS_URL не задан — кеш в памяти');
      return;
    }
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
    let warned = false;
    this.redis.on('ready', () => {
      warned = false;
      this.log.log(`Redis подключён: ${url}`);
    });
    this.redis.on('error', (e) => {
      if (warned) return;
      warned = true;
      this.log.warn(`Redis недоступен (${e.message}) — пока кеш в памяти`);
    });
  }

  get backend(): 'redis' | 'memory' {
    return this.redis?.status === 'ready' ? 'redis' : 'memory';
  }

  private get r() {
    return this.redis?.status === 'ready' ? this.redis : null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = this.r ? await this.r.get(key) : this.memGet(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlMs: number) {
    const raw = JSON.stringify(value);
    try {
      if (this.r) return void (await this.r.set(key, raw, 'PX', ttlMs));
    } catch {
      /* падаем в память */
    }
    this.mem.set(key, { v: raw, exp: Date.now() + ttlMs });
  }

  async del(key: string) {
    this.mem.delete(key);
    try {
      await this.r?.del(key);
    } catch {
      /* ignore */
    }
  }

  /** Добавляет точку в конец списка и оставляет последние max элементов. */
  async pushCapped(key: string, value: unknown, max: number, ttlMs: number) {
    const raw = JSON.stringify(value);
    try {
      if (this.r) {
        await this.r.multi().rpush(key, raw).ltrim(key, -max, -1).pexpire(key, ttlMs).exec();
        return;
      }
    } catch {
      /* падаем в память */
    }
    const list = this.memLists.get(key) ?? [];
    list.push(raw);
    this.memLists.set(key, list.slice(-max));
  }

  async range<T>(key: string): Promise<T[]> {
    try {
      const raw = this.r ? await this.r.lrange(key, 0, -1) : (this.memLists.get(key) ?? []);
      return raw.map((s) => JSON.parse(s) as T);
    } catch {
      return [];
    }
  }

  private memGet(key: string) {
    const e = this.mem.get(key);
    if (!e) return null;
    if (e.exp < Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return e.v;
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
