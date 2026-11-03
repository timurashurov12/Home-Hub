import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AdbService, assertPackage } from '../adb/adb.service';
import { CacheService } from '../cache/cache.service';
import { DevicesService } from '../devices/devices.service';
import { BUILTIN_SOURCES, compareVersions, pickAsset, REPO_RE, type UpdateSource } from './sources';

export interface LatestRelease {
  version: string;
  versionCode?: number;
  url: string;
  asset: string;
  size?: number;
  publishedAt?: string;
  page: string;
}

export interface AppUpdate {
  package: string;
  label?: string;
  installed: { versionName: string | null; versionCode: number | null };
  source: (UpdateSource & { origin: 'custom' | 'builtin' | 'auto' }) | null;
  latest: LatestRelease | null;
  hasUpdate: boolean;
  error?: string;
}

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
interface GhRelease {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  assets: GhAsset[];
}

const GH_TTL = 60 * 60_000; // релизы — раз в час
const FDROID_TTL = 6 * 60 * 60_000;

@Injectable()
export class UpdatesService {
  private readonly log = new Logger('Updates');
  private readonly file = resolve(process.env.DATA_DIR || resolve(process.cwd(), 'data'), 'update-sources.json');

  constructor(
    @Inject(AdbService) private readonly adb: AdbService,
    @Inject(CacheService) private readonly cache: CacheService,
    @Inject(DevicesService) private readonly devices: DevicesService,
  ) {}

  // ---------- источники ----------

  async customSources(): Promise<Record<string, UpdateSource>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  async sources() {
    return { builtin: BUILTIN_SOURCES, custom: await this.customSources() };
  }

  async setSource(pkg: string, src: UpdateSource) {
    assertPackage(pkg);
    if (src.type === 'github') {
      const repo = src.repo?.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/, '');
      if (!REPO_RE.test(repo)) throw new BadRequestException('Укажи репозиторий в виде owner/repo');
      if (src.assetPattern) {
        try {
          new RegExp(src.assetPattern);
        } catch {
          throw new BadRequestException('Неверный шаблон имени файла');
        }
      }
      src = { type: 'github', repo, assetPattern: src.assetPattern || undefined, prerelease: !!src.prerelease, label: src.label };
    } else if (src.type !== 'fdroid') throw new BadRequestException('Источник: github или fdroid');
    const all = await this.customSources();
    all[pkg] = src;
    await this.save(all);
    return all[pkg];
  }

  async removeSource(pkg: string) {
    const all = await this.customSources();
    delete all[pkg];
    await this.save(all);
    return { ok: true };
  }

  private async save(all: Record<string, UpdateSource>) {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(all, null, 2));
    await rename(tmp, this.file);
  }

  // ---------- проверка ----------

  /** Сторонние приложения устройства с версиями. */
  private async installed(id: string) {
    const out = await this.adb.shell(
      id,
      `for p in $(pm list packages -3 | cut -d: -f2); do echo "$p $(dumpsys package $p | grep -m1 versionName= | cut -d= -f2) $(dumpsys package $p | grep -m1 versionCode= | sed 's/.*versionCode=\\([0-9]*\\).*/\\1/')"; done`,
      60_000,
    );
    return out
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p[0] && /^[A-Za-z]\w*(\.\w+)+$/.test(p[0]))
      .map(([pkg, versionName, code]) => ({
        pkg,
        versionName: versionName || null,
        versionCode: code && /^\d+$/.test(code) ? Number(code) : null,
      }));
  }

  private async abis(id: string) {
    const out = (await this.adb.shell(id, 'getprop ro.product.cpu.abilist; getprop ro.product.cpu.abi')).trim().split('\n');
    const list = (out[0] || out[1] || 'armeabi-v7a').split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : ['armeabi-v7a'];
  }

  private async cached<T>(key: string, ttl: number, refresh: boolean, load: () => Promise<T>): Promise<T> {
    if (!refresh) {
      const hit = await this.cache.getJson<{ v: T }>(key);
      if (hit) return hit.v;
    }
    const v = await load();
    await this.cache.setJson(key, { v }, ttl);
    return v;
  }

  private async githubReleases(repo: string, refresh: boolean): Promise<GhRelease[]> {
    return this.cached(`upd:gh:${repo}`, GH_TTL, refresh, async () => {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'tv-hub' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=15`, { headers });
      if (res.status === 403 || res.status === 429) throw new Error('GitHub ограничил запросы (60 в час без токена). Задай GITHUB_TOKEN в .env');
      if (res.status === 404) throw new Error(`Репозиторий ${repo} не найден`);
      if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
      const list = (await res.json()) as GhRelease[];
      // храним только нужное, чтобы не раздувать кеш
      return list.map((r) => ({
        tag_name: r.tag_name,
        name: r.name,
        draft: r.draft,
        prerelease: r.prerelease,
        published_at: r.published_at,
        html_url: r.html_url,
        assets: r.assets.map((a) => ({ name: a.name, browser_download_url: a.browser_download_url, size: a.size })),
      }));
    });
  }

  private async latestGithub(src: Extract<UpdateSource, { type: 'github' }>, abis: string[], refresh: boolean) {
    const releases = (await this.githubReleases(src.repo, refresh)).filter((r) => !r.draft);
    const pick = (allowPre: boolean) => {
      for (const r of releases) {
        if (r.prerelease && !allowPre) continue;
        const a = pickAsset(r.assets, abis, src.assetPattern);
        if (a) return { r, a };
      }
      return null;
    };
    const found = pick(!!src.prerelease) ?? pick(true);
    if (!found) return null;
    const { r, a } = found;
    const fromName = src.assetPattern ? a.name.match(/(\d+(?:\.\d+)+)/)?.[1] : undefined;
    return {
      version: fromName ?? r.tag_name.replace(/^v/i, ''),
      url: a.browser_download_url,
      asset: a.name,
      size: a.size,
      publishedAt: r.published_at,
      page: r.html_url,
    } satisfies LatestRelease;
  }

  /** F-Droid: null, если пакета там нет. */
  private async latestFdroid(pkg: string, refresh: boolean): Promise<LatestRelease | null> {
    const info = await this.cached(`upd:fd:${pkg}`, FDROID_TTL, refresh, async () => {
      const res = await fetch(`https://f-droid.org/api/v1/packages/${pkg}`, { headers: { 'User-Agent': 'tv-hub' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`F-Droid: HTTP ${res.status}`);
      return (await res.json()) as { suggestedVersionCode: number; packages: { versionName: string; versionCode: number }[] };
    });
    if (!info) return null;
    const v = info.packages.find((p) => p.versionCode === info.suggestedVersionCode) ?? info.packages[0];
    if (!v) return null;
    return {
      version: v.versionName,
      versionCode: v.versionCode,
      url: `https://f-droid.org/repo/${pkg}_${v.versionCode}.apk`,
      asset: `${pkg}_${v.versionCode}.apk`,
      page: `https://f-droid.org/packages/${pkg}/`,
    };
  }

  async check(id: string, refresh = false): Promise<{ checkedAt: string; apps: AppUpdate[] }> {
    const [apps, abis, custom] = await Promise.all([this.installed(id), this.abis(id), this.customSources()]);
    const result = await Promise.all(
      apps.map(async (app): Promise<AppUpdate> => {
        const base = {
          package: app.pkg,
          installed: { versionName: app.versionName, versionCode: app.versionCode },
        };
        const explicit = custom[app.pkg] ? { ...custom[app.pkg], origin: 'custom' as const } : BUILTIN_SOURCES[app.pkg] ? { ...BUILTIN_SOURCES[app.pkg], origin: 'builtin' as const } : null;
        try {
          if (explicit?.type === 'github') {
            const latest = await this.latestGithub(explicit, abis, refresh);
            const hasUpdate = !!latest && !!app.versionName && compareVersions(latest.version, app.versionName) > 0;
            return { ...base, label: explicit.label, source: explicit, latest, hasUpdate, error: latest ? undefined : 'В релизах нет APK под эту приставку' };
          }
          // явный F-Droid или автопроверка любого пакета в F-Droid
          const latest = await this.latestFdroid(app.pkg, refresh);
          if (!latest) return { ...base, label: explicit?.label, source: explicit, latest: null, hasUpdate: false };
          const hasUpdate =
            app.versionCode != null && latest.versionCode != null
              ? latest.versionCode > app.versionCode
              : !!app.versionName && compareVersions(latest.version, app.versionName) > 0;
          return { ...base, label: explicit?.label, source: explicit ?? { type: 'fdroid', origin: 'auto' }, latest, hasUpdate };
        } catch (e) {
          // автопроверку F-Droid для приложений без источника не считаем ошибкой — просто «не найдено»
          const error = explicit ? (e as Error).message : undefined;
          return { ...base, label: explicit?.label, source: explicit, latest: null, hasUpdate: false, error };
        }
      }),
    );
    result.sort((a, b) => Number(b.hasUpdate) - Number(a.hasUpdate) || Number(!!b.source) - Number(!!a.source) || a.package.localeCompare(b.package));
    return { checkedAt: new Date().toISOString(), apps: result };
  }

  async update(id: string, pkg: string) {
    assertPackage(pkg);
    const { apps } = await this.check(id);
    const app = apps.find((a) => a.package === pkg);
    if (!app) throw new BadRequestException('Приложение не установлено');
    if (!app.latest) throw new BadRequestException(app.error ?? 'Для приложения не найден источник обновлений');
    this.log.log(`${id}: обновляю ${pkg} ${app.installed.versionName} → ${app.latest.version}`);
    const [r] = await this.devices.installFromUrl([id], app.latest.url);
    if (!r.ok) {
      const msg = /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(r.output)
        ? 'Новая версия подписана другим ключом, чем установленная (например, приложение ставили не из этого источника). Укажи другой источник или удали приложение и поставь заново.'
        : r.output;
      throw new BadRequestException(msg);
    }
    return { ok: true, package: pkg, from: app.installed.versionName, to: app.latest.version };
  }

  async updateAll(id: string) {
    const { apps } = await this.check(id);
    const results = [];
    for (const a of apps.filter((x) => x.hasUpdate)) {
      try {
        results.push(await this.update(id, a.package));
      } catch (e) {
        results.push({ ok: false, package: a.package, error: (e as Error).message });
      }
    }
    return results;
  }
}
