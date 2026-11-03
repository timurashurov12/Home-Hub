import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';
import { AdbService, assertPackage, shQuote } from '../adb/adb.service';

export interface RemoteEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: string;
}

export interface Player {
  package: string;
  activity: string;
  label: string;
}

const ROOTS = ['/sdcard', '/storage/', '/mnt/media_rw/'];

/** Разрешаем работать только с общим хранилищем: системные разделы и данные приложений недоступны. */
export function safeRemotePath(p: string): string {
  if (typeof p !== 'string' || !p.startsWith('/')) throw new BadRequestException('Нужен абсолютный путь');
  if (/[\n\r\0]/.test(p)) throw new BadRequestException('Недопустимые символы в пути');
  const n = posix.normalize(p).replace(/\/+$/, '') || '/';
  if (!ROOTS.some((r) => n === r.replace(/\/$/, '') || n.startsWith(r.endsWith('/') ? r : `${r}/`))) {
    throw new BadRequestException('Доступно только хранилище /sdcard и подключённые накопители');
  }
  return n;
}

/** Имя файла для загрузки на ТВ: без слешей и управляющих символов. */
export function safeFileName(name: string): string {
  const n = basename(name).replace(/[\0-\x1f/\\]/g, '_').trim();
  if (!n || n === '.' || n === '..') throw new BadRequestException('Недопустимое имя файла');
  return n;
}

const KNOWN_PLAYERS: Record<string, string> = {
  'org.videolan.vlc': 'VLC',
  'com.mxtech.videoplayer.ad': 'MX Player',
  'com.mxtech.videoplayer.pro': 'MX Player Pro',
  'org.xbmc.kodi': 'Kodi',
  'is.xyz.mpv': 'mpv',
  'com.brouken.player': 'Just Player',
  'com.teamsmart.videomanager.tv': 'SmartTube',
  'com.liskovsoft.smarttubetv.beta': 'SmartTube Beta',
  'com.google.android.youtube.tv': 'YouTube',
  'com.mitv.videoplayer': 'Плеер Xiaomi',
  'com.android.gallery3d': 'Галерея',
  'org.jellyfin.androidtv': 'Jellyfin',
  'com.google.android.apps.mediashell': 'Chromecast',
};

const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|opus|wav)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|webm|ts|m2ts|m3u8|mpd|flv|wmv|3gp)(\?|$)/i;
const YT_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/i;

export function mimeFor(path: string): string | null {
  if (AUDIO_EXT.test(path)) return 'audio/*';
  if (IMAGE_EXT.test(path)) return 'image/*';
  if (VIDEO_EXT.test(path)) return 'video/*';
  return null;
}

@Injectable()
export class FilesService {
  constructor(@Inject(AdbService) private readonly adb: AdbService) {}

  async list(id: string, path = '/sdcard'): Promise<{ path: string; entries: RemoteEntry[] }> {
    const dir = safeRemotePath(path);
    // stat по каждому элементу; %F — тип, %s — размер, %Y — mtime, %n — путь
    const out = await this.adb.shell(
      id,
      `cd ${shQuote(dir)} 2>/dev/null || { echo __NODIR__; exit 0; }; for f in * .[!.]*; do [ -e "$f" ] && stat -c '%F|%s|%Y|%n' -- "$f"; done`,
      30_000,
    );
    if (out.includes('__NODIR__')) throw new BadRequestException('Папка не найдена');
    const entries = out
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter(Boolean)
      .map((l) => {
        const [type, size, mtime, ...rest] = l.split('|');
        const name = rest.join('|');
        return {
          name,
          path: posix.join(dir, name),
          dir: type === 'directory',
          size: Number(size) || 0,
          mtime: new Date(Number(mtime) * 1000).toISOString(),
        };
      })
      .filter((e) => e.name && !Number.isNaN(Date.parse(e.mtime)));
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'ru'));
    return { path: dir, entries };
  }

  /** Подключённые флешки и SD-карты (/storage/XXXX-XXXX). */
  async volumes(id: string) {
    const out = await this.adb.shell(id, `ls -1 /storage 2>/dev/null`);
    const extra = out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^[0-9A-F]{4}-[0-9A-F]{4}$/i.test(s))
      .map((s) => ({ name: `Накопитель ${s}`, path: `/storage/${s}` }));
    return [
      { name: 'Внутренняя память', path: '/sdcard' },
      { name: 'Загрузки', path: '/sdcard/Download' },
      { name: 'Видео', path: '/sdcard/Movies' },
      ...extra,
    ];
  }

  async upload(id: string, localPath: string, originalName: string, dir: string) {
    const target = posix.join(safeRemotePath(dir), safeFileName(originalName));
    const out = await this.adb.push(id, localPath, target);
    if (/error|failed/i.test(out) && !/pushed/i.test(out)) throw new BadRequestException(out.trim());
    // чтобы файл сразу появился в галерее/плеерах
    await this.adb.shell(id, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${shQuote(`file://${target}`)}`).catch(() => undefined);
    return { ok: true, path: target };
  }

  /** Скачивает файл с ТВ во временную папку. Вызывающий должен удалить dir после отдачи. */
  async pull(id: string, path: string) {
    const remote = safeRemotePath(path);
    const dir = await mkdtemp(join(tmpdir(), 'tvhub-pull-'));
    const local = join(dir, safeFileName(posix.basename(remote)));
    try {
      await this.adb.pull(id, remote, local);
      const st = await stat(local);
      if (st.isDirectory()) throw new BadRequestException('Скачать можно только файл');
      return { dir, local, name: posix.basename(remote), size: st.size };
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e instanceof BadRequestException ? e : new BadRequestException(`Не удалось скачать: ${(e as Error).message}`);
    }
  }

  async mkdir(id: string, dir: string, name: string) {
    const target = posix.join(safeRemotePath(dir), safeFileName(name));
    const out = await this.adb.shell(id, `mkdir -p ${shQuote(target)} && echo OK`);
    if (!out.includes('OK')) throw new BadRequestException(out.trim() || 'Не удалось создать папку');
    return { ok: true, path: target };
  }

  async remove(id: string, path: string) {
    const target = safeRemotePath(path);
    // корень хранилища и сами тома удалять нельзя
    const depth = target.split('/').filter(Boolean).length;
    if (target === '/sdcard' || (target.startsWith('/storage/') && depth <= 2) || depth < 2) {
      throw new BadRequestException('Эту папку удалить нельзя');
    }
    const out = await this.adb.shell(id, `rm -rf ${shQuote(target)} && echo OK`);
    if (!out.includes('OK')) throw new BadRequestException(out.trim() || 'Не удалось удалить');
    return { ok: true };
  }

  /** Приложения, которые умеют открывать видео по ссылке. */
  async players(id: string): Promise<Player[]> {
    const queries = [
      `cmd package query-activities --brief -a android.intent.action.VIEW -d 'https://example.com/v.mp4' -t 'video/*'`,
      `cmd package query-activities --brief -a android.intent.action.VIEW -d 'https://www.youtube.com/watch?v=x'`,
    ];
    const out = (await Promise.all(queries.map((q) => this.adb.shell(id, q).catch(() => '')))).join('\n');
    const seen = new Map<string, Player>();
    for (const m of out.matchAll(/^\s*([\w.]+)\/([\w.$]+)\s*$/gm)) {
      const [, pkg, act] = m;
      if (seen.has(pkg) || /^(com\.android\.(chrome|browser)|android)$/.test(pkg)) continue;
      seen.set(pkg, { package: pkg, activity: act, label: KNOWN_PLAYERS[pkg] ?? pkg });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Открывает видео по ссылке (или файл на ТВ) в плеере. player — пакет; без него Android выберет сам. */
  async play(id: string, target: string, player?: string) {
    let uri: string;
    let mime: string | null;
    if (/^https?:\/\/\S+$/i.test(target)) {
      uri = target;
      // YouTube-ссылки открываем как обычную ссылку: их перехватывает YouTube/SmartTube
      mime = YT_RE.test(target) ? null : (mimeFor(target) ?? 'video/*');
    } else {
      const p = safeRemotePath(target);
      uri = `file://${p}`;
      mime = mimeFor(p) ?? 'video/*';
    }
    const args = ['am start -a android.intent.action.VIEW', `-d ${shQuote(uri)}`];
    if (mime) args.push(`-t ${shQuote(mime)}`);
    if (player) {
      assertPackage(player);
      args.push(`-p ${player}`);
    }
    const out = await this.adb.shell(id, args.join(' '));
    if (/Error|unable to resolve|No Activity found/i.test(out)) {
      // некоторые плееры не объявляют http + video/* — пробуем без MIME
      if (mime && /^https?:/i.test(uri)) {
        const retry = await this.adb.shell(id, ['am start -a android.intent.action.VIEW', `-d ${shQuote(uri)}`, ...(player ? [`-p ${player}`] : [])].join(' '));
        if (!/Error|unable to resolve|No Activity found/i.test(retry)) return { ok: true };
      }
      throw new BadRequestException(player ? `${player} не умеет открывать такую ссылку` : 'На ТВ нет приложения, которое откроет эту ссылку');
    }
    return { ok: true };
  }
}
