import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AdbService } from '../adb/adb.service';
import { DevicesStore, type OptimizeState } from './devices.store';

type Preset = OptimizeState['preset'];

/** Настройки, которые меняют пресеты. Ключ — "namespace:key". */
const PRESET_SETTINGS: Record<Preset, Record<string, string>> = {
  // Анимации вдвое быстрее: интерфейс ощутимо отзывчивее, выглядит почти так же
  soft: {
    'global:window_animation_scale': '0.5',
    'global:transition_animation_scale': '0.5',
    'global:animator_duration_scale': '0.5',
  },
  // Анимации выключены + заморозка кэшированных приложений (Android 11+)
  aggressive: {
    'global:window_animation_scale': '0',
    'global:transition_animation_scale': '0',
    'global:animator_duration_scale': '0',
    'global:cached_apps_freezer': 'enabled',
  },
};

/**
 * Фоновые приложения, которые на слабых приставках держат память и почти не нужны.
 * В «агрессивном» пресете они отключаются (pm disable-user), а не удаляются:
 * откат включает их обратно.
 */
const AGGRESSIVE_DISABLE = [
  'com.google.android.tvrecommendations', // каналы рекомендаций на главном экране
  'com.google.android.leanbacklauncher.recommendations',
  'com.google.android.play.games',
  'com.google.android.videos',
  'com.google.android.music',
  'com.google.android.youtube.tvmusic',
  'com.google.android.backdrop', // заставка «Фоновый режим»
  'com.google.android.feedback',
  'com.google.android.speech.pumpkin',
  'com.google.android.syncadapters.calendar',
  'com.google.android.syncadapters.contacts',
  'com.miui.tv.analytics', // аналитика Xiaomi
];

@Injectable()
export class OptimizeService {
  constructor(
    @Inject(AdbService) private readonly adb: AdbService,
    @Inject(DevicesStore) private readonly store: DevicesStore,
  ) {}

  private async saved(id: string) {
    const d = await this.store.get(id);
    if (!d) throw new NotFoundException('Сначала добавь устройство в список');
    return d;
  }

  private async memAvailable(id: string) {
    const out = await this.adb.shell(id, 'grep MemAvailable /proc/meminfo');
    return Number(out.match(/(\d+)/)?.[1] ?? 0) * 1024;
  }

  private async getSetting(id: string, nsKey: string) {
    const [ns, key] = nsKey.split(':');
    return (await this.adb.shell(id, `settings get ${ns} ${key}`)).trim();
  }

  private async putSetting(id: string, nsKey: string, value: string) {
    const [ns, key] = nsKey.split(':');
    if (value === 'null') await this.adb.shell(id, `settings delete ${ns} ${key}`);
    else await this.adb.shell(id, `settings put ${ns} ${key} ${value}`);
  }

  async status(id: string) {
    const d = await this.saved(id);
    const keys = [...new Set(Object.values(PRESET_SETTINGS).flatMap((s) => Object.keys(s)))];
    const current: Record<string, string> = {};
    for (const k of keys) current[k] = await this.getSetting(id, k);
    return { preset: d.optimize?.preset ?? null, disabled: d.optimize?.disabled ?? [], settings: current };
  }

  /**
   * Разовая очистка: выгружает фоновые процессы (то же, что система делает при нехватке памяти;
   * открытое приложение и системные службы не трогает) и чистит кэши приложений.
   */
  async freeNow(id: string) {
    const before = await this.memAvailable(id);
    await this.adb.shell(id, 'am kill-all');
    await this.adb.shell(id, 'pm trim-caches 999G', 60_000).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    const after = await this.memAvailable(id);
    return { before, after, freed: Math.max(0, after - before) };
  }

  async apply(id: string, preset: Preset) {
    if (!(preset in PRESET_SETTINGS)) throw new BadRequestException('Неизвестный пресет');
    // Применяем поверх исходного состояния: если уже стоит другой пресет — сначала откатываем
    const d = await this.saved(id);
    if (d.optimize) await this.revert(id);

    const prevSettings: Record<string, string> = {};
    for (const [k, v] of Object.entries(PRESET_SETTINGS[preset])) {
      prevSettings[k] = await this.getSetting(id, k);
      await this.putSetting(id, k, v);
    }

    const disabled: string[] = [];
    if (preset === 'aggressive') {
      const enabledPkgs = new Set(
        (await this.adb.shell(id, 'pm list packages -e'))
          .split('\n')
          .map((l) => l.trim().replace(/^package:/, ''))
          .filter(Boolean),
      );
      for (const pkg of AGGRESSIVE_DISABLE) {
        if (!enabledPkgs.has(pkg)) continue; // нет на устройстве или уже отключено пользователем
        const out = await this.adb.shell(id, `pm disable-user --user 0 ${pkg}`).catch((e) => String(e));
        if (/disabled/i.test(out)) disabled.push(pkg);
      }
    }

    const fresh = await this.saved(id);
    await this.store.upsert({ ...fresh, optimize: { preset, prevSettings, disabled } });
    const freed = await this.freeNow(id);
    return { ...(await this.status(id)), freed };
  }

  async revert(id: string) {
    const d = await this.saved(id);
    const st = d.optimize;
    if (!st) return this.status(id);
    for (const [k, v] of Object.entries(st.prevSettings)) await this.putSetting(id, k, v);
    for (const pkg of st.disabled) await this.adb.shell(id, `pm enable ${pkg}`).catch(() => undefined);
    await this.store.clearOptimize(id);
    return this.status(id);
  }
}
