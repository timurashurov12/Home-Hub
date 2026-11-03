export interface Device {
  id: string;
  name: string;
  host?: string;
  port?: number;
  saved: boolean;
  state: 'online' | 'offline' | 'unauthorized';
  model?: string;
}

export interface FoundHost {
  host: string;
  adbPort: number | null;
  name?: string;
  model?: string;
  manufacturer?: string;
  kind: 'android-tv' | 'cast' | 'adb';
  sources: string[];
}

export interface ScanState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  results: FoundHost[];
  subnets: string[];
  lanReachable: boolean | null;
}

export interface ProbeResult {
  host: string;
  ports: Record<'adb' | 'androidTvRemote' | 'cast', { port: number; result: string }>;
  info: { name?: string; model?: string; manufacturer?: string } | null;
}

export interface DeviceInfo {
  manufacturer: string;
  model: string;
  device: string;
  android: string;
  sdk: number;
  build: string;
  resolution?: string;
  memory: { total: number; available: number };
  storage: { total: number; used: number; available: number } | null;
  uptimeSec: number;
  deviceName: string | null;
  screenOn: boolean;
  wifiIp: string | null;
}

export interface AppInfo {
  package: string;
  versionCode?: string;
  system: boolean;
  disabled: boolean;
  removed?: boolean;
  level?: 'safe' | 'caution' | 'critical';
  label?: string;
  note?: string;
}

export interface DeviceStats {
  at: string;
  cpu: { usage: number; cores: number; load: [number, number, number] };
  temps: { zone: string; celsius: number }[];
  memory: { total: number; available: number; swapTotal: number; swapFree: number };
  storage: { total: number; used: number; available: number } | null;
  topCpu: { pid: number; name: string; cpu: number; mem: number; res: number }[];
  topMem: { name: string; pid: number; bytes: number }[];
}

export interface OptimizeStatus {
  preset: 'soft' | 'aggressive' | null;
  disabled: string[];
  settings: Record<string, string>;
}

export interface FreeResult {
  before: number;
  after: number;
  freed: number;
}

export type AppAction = 'stop' | 'clear' | 'uninstall' | 'disable' | 'enable' | 'restore';

export interface InstallResult {
  id: string;
  ok: boolean;
  output: string;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
  return data as T;
}

const d = (id: string) => `/api/devices/${encodeURIComponent(id)}`;
const p = (pkg: string) => encodeURIComponent(pkg);

export const api = {
  health: () => req<{ ok: boolean; adb: boolean }>('GET', '/api/health'),
  devices: () => req<Device[]>('GET', '/api/devices'),
  addDevice: (host: string, port: number, name?: string) =>
    req<{ id: string; pendingAuth?: boolean }>('POST', '/api/devices', { host, port, name }),
  rename: (id: string, name: string) => req('PATCH', d(id), { name }),
  remove: (id: string) => req('DELETE', d(id)),
  connect: (id: string) => req('POST', `${d(id)}/connect`),
  probe: (host: string) => req<ProbeResult>('POST', '/api/discovery/probe', { host }),
  lastScan: () => req<ScanState>('GET', '/api/discovery/last'),
  scan: (subnet?: string) => req<{ results: FoundHost[]; subnets: string[]; lanReachable: boolean | null }>('POST', '/api/discovery/scan', subnet ? { subnet } : {}),
  info: (id: string) => req<DeviceInfo>('GET', `${d(id)}/info`),
  apps: (id: string, system: boolean) => req<AppInfo[]>('GET', `${d(id)}/apps?system=${system}`),
  launch: (id: string, pkg: string) => req('POST', `${d(id)}/apps/${p(pkg)}/launch`),
  appAction: (id: string, pkg: string, action: AppAction, force = false) =>
    req('POST', `${d(id)}/apps/${p(pkg)}/${action}${force ? '?force=true' : ''}`),
  installFile: (ids: string[], file: File) => {
    const fd = new FormData();
    fd.append('deviceIds', ids.join(','));
    fd.append('apk', file);
    return req<InstallResult[]>('POST', '/api/install', fd);
  },
  installUrl: (ids: string[], url: string) => req<InstallResult[]>('POST', '/api/install-url', { deviceIds: ids, url }),
  key: (id: string, key: string) => req('POST', `${d(id)}/key`, { key }),
  text: (id: string, text: string) => req('POST', `${d(id)}/text`, { text }),
  openUrl: (id: string, url: string) => req('POST', `${d(id)}/open-url`, { url }),
  screenshotUrl: (id: string) => `${d(id)}/screenshot?t=${Date.now()}`,
  reboot: (id: string) => req('POST', `${d(id)}/reboot`),
  optimize: (id: string) => req<OptimizeStatus>('GET', `${d(id)}/optimize`),
  optimizeFree: (id: string) => req<FreeResult>('POST', `${d(id)}/optimize/free`),
  optimizePreset: (id: string, preset: 'soft' | 'aggressive') =>
    req<OptimizeStatus & { freed: FreeResult }>('POST', `${d(id)}/optimize/preset`, { preset }),
  optimizeRevert: (id: string) => req<OptimizeStatus>('POST', `${d(id)}/optimize/revert`),
  stats: (id: string) => req<DeviceStats>('GET', `${d(id)}/stats`),
};

export function fmtBytes(n: number) {
  if (!n) return '0';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

export function fmtUptime(s: number) {
  const dd = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [dd && `${dd} д`, h && `${h} ч`, `${m} мин`].filter(Boolean).join(' ');
}

/** Настройка «искать устройства при запуске» (хранится в браузере). */
export const autoScanPref = {
  get: () => {
    try {
      return localStorage.getItem('tvhub.autoScan') !== 'off';
    } catch {
      return true;
    }
  },
  set: (on: boolean) => {
    try {
      localStorage.setItem('tvhub.autoScan', on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  },
};
