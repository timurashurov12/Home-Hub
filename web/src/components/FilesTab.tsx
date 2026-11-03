import {
  ChevronRight, Download, File, FileAudio, FileImage, FileVideo, Folder, FolderPlus, HardDrive, Loader2, Play, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtBytes, type Player, type RemoteEntry } from '../api/client';
import { useAction, useToast } from '../toast';

const VIDEO = /\.(mp4|mkv|avi|mov|webm|ts|m2ts|flv|wmv|3gp)$/i;
const AUDIO = /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp|bmp)$/i;
const playable = (n: string) => VIDEO.test(n) || AUDIO.test(n) || IMAGE.test(n);

function EntryIcon({ e }: { e: RemoteEntry }) {
  if (e.dir) return <Folder size={16} />;
  if (VIDEO.test(e.name)) return <FileVideo size={16} />;
  if (AUDIO.test(e.name)) return <FileAudio size={16} />;
  if (IMAGE.test(e.name)) return <FileImage size={16} />;
  return <File size={16} />;
}

function PlayCard({ id, players }: { id: string; players: Player[] }) {
  const run = useAction();
  const [url, setUrl] = useState('');
  const [player, setPlayer] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await run(() => api.play(id, url.trim(), player || undefined), 'Открыто на ТВ');
    setBusy(false);
  };
  return (
    <div className="card">
      <h4>
        <Play size={16} /> Видео по ссылке
      </h4>
      <p className="muted small">
        Прямая ссылка на видео (.mp4, .mkv, .m3u8 и т.п.), YouTube или любая ссылка, которую умеет открыть плеер на ТВ.
      </p>
      <div className="row">
        <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && go()} />
        <select value={player} onChange={(e) => setPlayer(e.target.value)} title="Чем открыть">
          <option value="">Плеер по умолчанию</option>
          {players.map((p) => (
            <option key={p.package} value={p.package}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!/^https?:\/\//i.test(url.trim()) || busy} onClick={go}>
          {busy ? <Loader2 size={16} className="spin" /> : <Play size={16} />} Воспроизвести
        </button>
      </div>
    </div>
  );
}

export function FilesTab({ id }: { id: string }) {
  const run = useAction();
  const toast = useToast();
  const [path, setPath] = useState('/sdcard/Download');
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [volumes, setVolumes] = useState<{ name: string; path: string }[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [player, setPlayer] = useState('');
  const [uploading, setUploading] = useState<{ name: string; i: number; n: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (p: string) => {
      setEntries(null);
      const r = await run(() => api.files(id, p));
      if (r) {
        setPath(r.path);
        setEntries(r.entries);
      } else setEntries([]);
    },
    [id, run],
  );

  useEffect(() => {
    api.volumes(id).then(setVolumes).catch(() => undefined);
    api.players(id).then(setPlayers).catch(() => undefined);
    load('/sdcard/Download');
  }, [id, load]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    let ok = 0;
    for (const [i, f] of list.entries()) {
      setUploading({ name: f.name, i: i + 1, n: list.length });
      try {
        await api.uploadFile(id, path, f);
        ok++;
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`, 'err');
      }
    }
    setUploading(null);
    if (ok) toast(`Загружено на ТВ: ${ok} из ${list.length}`);
    load(path);
  };

  const remove = async (e: RemoteEntry) => {
    if (!confirm(`Удалить ${e.dir ? 'папку' : 'файл'} «${e.name}»${e.dir ? ' со всем содержимым' : ''}?`)) return;
    if (await run(() => api.removeFile(id, e.path), 'Удалено')) load(path);
  };

  const mkdir = async () => {
    const name = prompt('Название новой папки');
    if (name && (await run(() => api.mkdir(id, path, name), 'Папка создана'))) load(path);
  };

  const crumbs = path.split('/').filter(Boolean);

  return (
    <div className="files">
      <PlayCard id={id} players={players} />

      <div
        className={`card dropzone-card ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
        }}
      >
        <h4>
          <HardDrive size={16} /> Файлы на ТВ
        </h4>
        <div className="row">
          {volumes.map((v) => (
            <button key={v.path} className={path === v.path ? 'active' : ''} onClick={() => load(v.path)}>
              {v.name}
            </button>
          ))}
          <div className="spacer" />
          <select value={player} onChange={(e) => setPlayer(e.target.value)} title="Чем открывать файлы">
            <option value="">Открывать плеером по умолчанию</option>
            {players.map((p) => (
              <option key={p.package} value={p.package}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="row crumbs">
          {crumbs.map((c, i) => {
            const p = '/' + crumbs.slice(0, i + 1).join('/');
            return (
              <span key={p}>
                {i > 0 && <ChevronRight size={14} className="muted" />}
                <button className="link" onClick={() => load(p)}>
                  {c}
                </button>
              </span>
            );
          })}
          <div className="spacer" />
          <button onClick={() => load(path)} title="Обновить">
            <RefreshCw size={16} />
          </button>
          <button onClick={mkdir}>
            <FolderPlus size={16} /> Папка
          </button>
          <button className="primary" disabled={!!uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            {uploading ? ` ${uploading.i}/${uploading.n}: ${uploading.name}` : ' Загрузить на ТВ'}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <p className="muted small">Перетащи файлы сюда, чтобы загрузить их в эту папку.</p>

        {entries === null ? (
          <div className="empty">
            <Loader2 size={18} className="spin" /> Читаю папку…
          </div>
        ) : (
          <table className="apps">
            <tbody>
              {crumbs.length > 1 && (
                <tr>
                  <td colSpan={4}>
                    <button className="link" onClick={() => load('/' + crumbs.slice(0, -1).join('/'))}>
                      <Folder size={16} /> ..
                    </button>
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.path}>
                  <td>
                    {e.dir ? (
                      <button className="link" onClick={() => load(e.path)}>
                        <EntryIcon e={e} /> {e.name}
                      </button>
                    ) : (
                      <span>
                        <EntryIcon e={e} /> {e.name}
                      </span>
                    )}
                  </td>
                  <td className="muted small">{e.dir ? '' : fmtBytes(e.size)}</td>
                  <td className="muted small">{new Date(e.mtime).toLocaleString()}</td>
                  <td className="actions">
                    {!e.dir && playable(e.name) && (
                      <button title="Открыть на ТВ" onClick={() => run(() => api.play(id, e.path, player || undefined), 'Открыто на ТВ')}>
                        <Play size={16} />
                      </button>
                    )}
                    {!e.dir && (
                      <a className="button" href={api.downloadUrl(id, e.path)} title="Скачать на компьютер" download={e.name}>
                        <Download size={16} />
                      </a>
                    )}
                    <button className="danger" title="Удалить" onClick={() => remove(e)}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    Папка пуста
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
