/**
 * Откуда брать обновления для сторонних приложений.
 *  github — последний релиз репозитория на GitHub (APK из assets)
 *  fdroid — официальный репозиторий F-Droid (проверяется автоматически для любого пакета)
 *
 * APKMirror и Google Play не используются: у APKMirror нет API и он закрыт от ботов,
 * а приложения из Play обновляет сам Play Маркет на ТВ.
 */
export type UpdateSource =
  | { type: 'github'; repo: string; assetPattern?: string; prerelease?: boolean; label?: string }
  | { type: 'fdroid'; label?: string };

/** Популярные приложения для Android TV, которые распространяются через GitHub. */
export const BUILTIN_SOURCES: Record<string, UpdateSource> = {
  'com.teamsmart.videomanager.tv': { type: 'github', repo: 'yuliskov/SmartTube', assetPattern: 'stable', label: 'SmartTube' },
  'com.liskovsoft.smarttubetv.beta': { type: 'github', repo: 'yuliskov/SmartTube', assetPattern: 'beta', prerelease: true, label: 'SmartTube Beta' },
  'org.jellyfin.androidtv': { type: 'github', repo: 'jellyfin/jellyfin-androidtv', label: 'Jellyfin для Android TV' },
  'is.xyz.mpv': { type: 'github', repo: 'mpv-android/mpv-android', label: 'mpv' },
  'org.schabi.newpipe': { type: 'github', repo: 'TeamNewPipe/NewPipe', label: 'NewPipe' },
  'com.github.libretube': { type: 'github', repo: 'libre-tube/LibreTube', label: 'LibreTube' },
  'com.termux': { type: 'github', repo: 'termux/termux-app', label: 'Termux' },
  'org.localsend.localsend_app': { type: 'github', repo: 'localsend/localsend', label: 'LocalSend' },
};

export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Сравнивает версии вида 1.2.3, v29.71, 0.21.2-beta: >0 если a новее b. */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .replace(/^[^\d]*/, '')
      .split(/[^\d]+/)
      .filter(Boolean)
      .map(Number);
  const x = norm(a);
  const y = norm(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const ABI_TOKENS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86', 'arm64', 'armv7', 'armeabi'];
const ABI_ALIASES: Record<string, string[]> = {
  'arm64-v8a': ['arm64-v8a', 'arm64', 'aarch64'],
  'armeabi-v7a': ['armeabi-v7a', 'armv7', 'armeabi', 'arm32'],
  x86_64: ['x86_64'],
  x86: ['x86'],
};

/**
 * Выбирает APK под архитектуру устройства. abis — ro.product.cpu.abilist в порядке предпочтения.
 * Сборки под чужую архитектуру отбрасываются, универсальные подходят всем.
 */
export function pickAsset<T extends { name: string }>(assets: T[], abis: string[], pattern?: string): T | null {
  let apks = assets.filter((a) => a.name.toLowerCase().endsWith('.apk'));
  if (pattern) {
    const re = new RegExp(pattern, 'i');
    const m = apks.filter((a) => re.test(a.name));
    if (m.length) apks = m;
  }
  let best: { a: T; score: number } | null = null;
  for (const a of apks) {
    const n = a.name.toLowerCase();
    const tokens = ABI_TOKENS.filter((t) => n.includes(t));
    let score: number;
    if (!tokens.length || n.includes('universal')) score = 1;
    else {
      const idx = abis.findIndex((abi) => (ABI_ALIASES[abi] ?? [abi]).some((al) => n.includes(al)));
      // x86 содержится в x86_64 — уточняем, чтобы не спутать
      if (idx < 0 || (abis[idx] === 'x86' && n.includes('x86_64'))) continue;
      score = 10 - idx;
    }
    if (n.includes('debug')) score -= 0.5;
    if (!best || score > best.score) best = { a, score };
  }
  return best?.a ?? null;
}
