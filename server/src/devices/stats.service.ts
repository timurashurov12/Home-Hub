import { Inject, Injectable } from '@nestjs/common';
import { AdbService } from '../adb/adb.service';

export interface ProcStat {
  pid: number;
  name: string;
  cpu: number; // %
  mem: number; // %
  res: number; // байт
}

export interface AppMem {
  name: string;
  pid: number;
  bytes: number;
}

export interface DeviceStats {
  at: string;
  cpu: { usage: number; cores: number; load: [number, number, number] };
  temps: { zone: string; celsius: number }[];
  memory: { total: number; available: number; swapTotal: number; swapFree: number };
  storage: { total: number; used: number; available: number } | null;
  topCpu: ProcStat[];
  topMem: AppMem[];
}

const SEP = '__TVHUB_SEP__';

function cpuTicks(line: string) {
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (n[3] ?? 0) + (n[4] ?? 0); // idle + iowait
  const total = n.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return { idle, total };
}

/** Размер из top: 12K, 34M, 1.2G или просто число (КБ). */
function parseSize(s: string): number {
  const m = s.match(/^([\d.]+)([KMGT]?)/i);
  if (!m) return 0;
  const mult = { '': 1024, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2].toUpperCase() as 'K'] ?? 1024;
  return Math.round(Number(m[1]) * mult);
}

/** Разбор вывода toybox top (Android 8+). Колонки находим по заголовку. */
export function parseTop(out: string, limit = 10): ProcStat[] {
  const lines = out.split('\n');
  // берём последний кадр: первый у top часто показывает нагрузку с момента запуска процесса
  let hdr = -1;
  lines.forEach((l, i) => {
    if (/^\s*PID\s/.test(l.replace(/\x1b\[[0-9;]*m/g, ''))) hdr = i;
  });
  if (hdr < 0) return [];
  const cols = lines[hdr]
    .replace(/\x1b\[[0-9;]*m/g, '')
    .trim()
    .replace(/S\[%CPU\]/, 'S %CPU')
    .split(/\s+/);
  const idx = (n: string) => cols.indexOf(n);
  const iPid = idx('PID');
  const iCpu = idx('%CPU');
  const iMem = idx('%MEM');
  const iRes = idx('RES');
  const iName = Math.max(idx('ARGS'), idx('NAME'), idx('CMD'), cols.length - 1);
  const res: ProcStat[] = [];
  for (const raw of lines.slice(hdr + 1)) {
    const l = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!l || !/^\d/.test(l)) continue;
    const p = l.split(/\s+/);
    const name = p.slice(iName).join(' ');
    // пропускаем сам top и потоки ядра вида [kworker/0:1]
    if (!name || name.startsWith('top ') || name === 'top' || name.startsWith('[')) continue;
    res.push({
      pid: Number(p[iPid]),
      name: name.split(' ')[0],
      cpu: Number(p[iCpu]) || 0,
      mem: Number(p[iMem]) || 0,
      res: iRes >= 0 ? parseSize(p[iRes]) : 0,
    });
  }
  return res.sort((a, b) => b.cpu - a.cpu).slice(0, limit);
}

/** «Total PSS/RSS by process» из dumpsys meminfo. */
/** Температуры из `dumpsys thermalservice` (Android 10+): Temperature{mValue=45.0, mType=0, mName=CPU, ...} */
export function parseThermalService(out: string) {
  const section = out.split(/Current temperatures from HAL:/)[1]?.split(/\n\S/)[0] ?? out;
  const res: { zone: string; celsius: number }[] = [];
  for (const m of section.matchAll(/Temperature\{mValue=(-?[\d.]+),[^}]*?mName=([^,}]+)/g)) {
    const c = Number(m[1]);
    if (c > 0 && c < 150 && !res.some((r) => r.zone === m[2])) res.push({ zone: m[2].trim(), celsius: Math.round(c * 10) / 10 });
  }
  return res;
}

export function parseMeminfo(out: string, limit = 10): AppMem[] {
  // PSS точнее отражает реальное потребление (делит общие страницы), RSS — запасной вариант
  let start = out.search(/Total PSS by process:/);
  if (start < 0) start = out.search(/Total RSS by process:/);
  if (start < 0) return [];
  const res: AppMem[] = [];
  for (const l of out.slice(start).split('\n').slice(1)) {
    const m = l.match(/^\s*([\d,]+)K(?: kB)?:\s+(\S+)\s+\(pid\s+(\d+)/);
    if (!m) {
      if (res.length && !l.trim()) break;
      continue;
    }
    res.push({ bytes: Number(m[1].replace(/,/g, '')) * 1024, name: m[2], pid: Number(m[3]) });
  }
  return res.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

@Injectable()
export class StatsService {
  constructor(@Inject(AdbService) private readonly adb: AdbService) {}

  async stats(id: string): Promise<DeviceStats> {
    const cmds = [
      'head -1 /proc/stat; sleep 1; head -1 /proc/stat',
      'grep -c ^processor /proc/cpuinfo',
      'cat /proc/loadavg',
      'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type 2>/dev/null) $(cat $z/temp 2>/dev/null)"; done',
      'cat /proc/meminfo',
      'df /data',
      'top -b -n 2 -d 1 -m 15',
      'dumpsys meminfo',
      'dumpsys thermalservice',
    ];
    const out = await this.adb.shell(id, cmds.join(`; echo ${SEP}; `), 30_000);
    const parts = out.split(SEP).map((s) => s.trim());
    // недостающие блоки (команда не поддерживается прошивкой) считаем пустыми
    const p = Array.from({ length: cmds.length }, (_, i) => parts[i] ?? '');

    const statLines = p[0].split('\n').filter((l) => l.startsWith('cpu '));
    let usage = 0;
    if (statLines.length >= 2) {
      const a = cpuTicks(statLines[0]);
      const b = cpuTicks(statLines[1]);
      const dt = b.total - a.total;
      usage = dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 1000) / 10 : 0;
    }
    const la = p[2].split(/\s+/);
    const load = [0, 1, 2].map((i) => Number(la[i]) || 0) as [number, number, number];

    const sysfsTemps = p[3]
      .split('\n')
      .map((l) => l.trim().match(/^(\S+)\s+(-?\d+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => {
        const v = Number(m[2]);
        // обычно миллиградусы, но некоторые зоны отдают градусы
        const celsius = Math.abs(v) > 1000 ? v / 1000 : v;
        return { zone: m[1], celsius: Math.round(celsius * 10) / 10 };
      })
      .filter((t) => t.celsius > 0 && t.celsius < 150);
    // sysfs часто закрыт для shell — тогда берём данные thermal HAL
    const temps = sysfsTemps.length ? sysfsTemps : parseThermalService(p[8] ?? '');

    const mem = (k: string) => Number(p[4].match(new RegExp(`${k}:\\s+(\\d+)`))?.[1] ?? 0) * 1024;
    const df = p[5].split('\n')[1]?.trim().split(/\s+/) ?? [];

    return {
      at: new Date().toISOString(),
      cpu: { usage, cores: Number(p[1]) || 0, load },
      temps,
      memory: { total: mem('MemTotal'), available: mem('MemAvailable'), swapTotal: mem('SwapTotal'), swapFree: mem('SwapFree') },
      storage:
        df.length >= 4 ? { total: Number(df[1]) * 1024, used: Number(df[2]) * 1024, available: Number(df[3]) * 1024 } : null,
      topCpu: parseTop(p[6]),
      topMem: parseMeminfo(p[7]),
    };
  }
}
