import { useState } from 'react';
import { api, type Device, type InstallResult } from '../api/client';
import { Modal } from './Modal';

export function InstallDialog({ devices, preselect, onClose, onDone }: {
  devices: Device[];
  preselect: string | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const online = devices.filter((d) => d.state === 'online');
  const [ids, setIds] = useState<string[]>(online.some((d) => d.id === preselect) ? [preselect!] : online.map((d) => d.id));
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InstallResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  const nameOf = (id: string) => devices.find((d) => d.id === id)?.name ?? id;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      setResults(mode === 'file' ? await api.installFile(ids, file!) : await api.installUrl(ids, url));
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = ids.length > 0 && (mode === 'file' ? !!file : /^https?:\/\//.test(url));

  return (
    <Modal title="Установка APK" onClose={onClose}>
      <div className="tabs small">
        <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>Файл</button>
        <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>По ссылке</button>
      </div>

      {mode === 'file' ? (
        <label
          className={`dropzone ${file ? 'has-file' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) setFile(f);
          }}
        >
          <input type="file" accept=".apk" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? <>📦 {file.name} <small className="muted">({(file.size / 1048576).toFixed(1)} МБ)</small></> : 'Перетащи .apk сюда или нажми, чтобы выбрать'}
        </label>
      ) : (
        <input className="full" placeholder="https://example.com/app.apk" value={url} onChange={(e) => setUrl(e.target.value)} />
      )}

      <h4>На какие ТВ</h4>
      <div className="checks">
        {online.map((d) => (
          <label key={d.id}>
            <input type="checkbox" checked={ids.includes(d.id)} onChange={() => toggle(d.id)} /> {d.name} <small className="muted">{d.id}</small>
          </label>
        ))}
        {online.length === 0 && <div className="empty">Нет ТВ в сети</div>}
      </div>

      {error && <div className="result err">{error}</div>}
      {results?.map((r) => (
        <div key={r.id} className={`result ${r.ok ? 'ok' : 'err'}`}>
          {r.ok ? '✅' : '❌'} {nameOf(r.id)}: {r.ok ? 'установлено' : r.output}
        </div>
      ))}

      <div className="modal-foot">
        <button onClick={onClose}>Закрыть</button>
        <button className="primary" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Устанавливаю…' : `Установить на ${ids.length} ТВ`}
        </button>
      </div>
    </Modal>
  );
}
