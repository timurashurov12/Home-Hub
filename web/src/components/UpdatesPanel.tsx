import { ArrowUpCircle, ExternalLink, GitBranch, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtBytes, type AppUpdate } from '../api/client';
import { useAction, useToast } from '../toast';

const ORIGIN = { custom: 'ваш источник', builtin: 'встроенный', auto: 'найдено в F-Droid' } as const;

function sourceText(a: AppUpdate) {
  if (!a.source) return null;
  return a.source.type === 'github' ? `GitHub ${a.source.repo}` : 'F-Droid';
}

export function UpdatesPanel({ id }: { id: string }) {
  const run = useAction();
  const toast = useToast();
  const [data, setData] = useState<{ checkedAt: string; apps: AppUpdate[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      const r = await run(() => api.updates(id, refresh));
      if (r) setData(r);
      setLoading(false);
    },
    [id, run],
  );

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const update = async (a: AppUpdate) => {
    setBusy(a.package);
    const r = await run(() => api.updateApp(id, a.package), `${a.label ?? a.package} обновлено до ${a.latest?.version}`);
    setBusy(null);
    if (r) load();
  };

  const updateAll = async () => {
    setBusy('*');
    const r = await run(() => api.updateAll(id));
    setBusy(null);
    if (r) {
      const ok = r.filter((x) => x.ok).length;
      r.filter((x) => !x.ok).forEach((x) => toast(`${x.package}: ${x.error}`, 'err'));
      toast(`Обновлено: ${ok} из ${r.length}`, ok === r.length ? 'ok' : 'err');
      load();
    }
  };

  const editSource = async (a: AppUpdate) => {
    const cur = a.source?.type === 'github' ? a.source.repo : '';
    const repo = prompt(
      `Откуда обновлять ${a.package}?\n\nУкажи GitHub-репозиторий (owner/repo или ссылку), где в релизах лежит APK.\n` +
        `Напиши «fdroid», чтобы брать из F-Droid. Пустое поле — убрать свой источник.`,
      cur,
    );
    if (repo === null) return;
    const v = repo.trim();
    if (!v) {
      if (a.source?.origin === 'custom') await run(() => api.removeUpdateSource(a.package), 'Источник убран');
    } else if (v.toLowerCase() === 'fdroid') {
      await run(() => api.setUpdateSource(a.package, { type: 'fdroid' }), 'Источник сохранён');
    } else {
      const pattern = prompt('Шаблон имени APK (необязательно), например «stable» или «universal». Оставь пустым, если в релизе один APK.', a.source?.type === 'github' ? (a.source.assetPattern ?? '') : '');
      if (pattern === null) return;
      await run(() => api.setUpdateSource(a.package, { type: 'github', repo: v, assetPattern: pattern.trim() || undefined }), 'Источник сохранён');
    }
    load(true);
  };

  if (!data) {
    return (
      <div className="empty">
        <Loader2 size={18} className="spin" /> Проверяю версии приложений…
      </div>
    );
  }

  const withUpdates = data.apps.filter((a) => a.hasUpdate);
  const visible = showAll ? data.apps : data.apps.filter((a) => a.source || a.hasUpdate);

  return (
    <div>
      <p className="hint">
        Версии сравниваются с последними релизами на GitHub (для популярных приложений Android TV источник известен заранее) и с F-Droid —
        он проверяется для любого приложения. Приложения из Google Play обновляет сам Play Маркет. Для остальных можно указать
        GitHub-репозиторий кнопкой <Settings2 size={13} />.
      </p>

      <div className="row">
        <span className="muted small">Проверено {new Date(data.checkedAt).toLocaleTimeString()}</span>
        <div className="spacer" />
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> показать все приложения
        </label>
        <button onClick={() => load(true)} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Проверить
        </button>
        <button className="primary" disabled={!withUpdates.length || busy !== null} onClick={updateAll}>
          <ArrowUpCircle size={16} /> Обновить всё {withUpdates.length > 0 && `(${withUpdates.length})`}
        </button>
      </div>

      <table className="apps">
        <thead>
          <tr>
            <th>Приложение</th>
            <th>Установлено</th>
            <th>Последняя</th>
            <th>Источник</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <tr key={a.package}>
              <td>
                <div className="app-label">{a.label ?? a.package}</div>
                {a.label && <div className="muted small">{a.package}</div>}
                {a.error && <div className="warn-text small">{a.error}</div>}
              </td>
              <td>{a.installed.versionName ?? '—'}</td>
              <td>
                {a.latest ? (
                  <a href={a.latest.page} target="_blank" rel="noreferrer" className={a.hasUpdate ? 'ok-text' : ''}>
                    {a.latest.version} <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="muted">—</span>
                )}
                {a.latest?.size ? <div className="muted small">{fmtBytes(a.latest.size)}</div> : null}
              </td>
              <td className="small">
                {a.source ? (
                  <>
                    {a.source.type === 'github' && <GitBranch size={12} />} {sourceText(a)}
                    <div className="muted">{ORIGIN[a.source.origin]}</div>
                  </>
                ) : (
                  <span className="muted">не найден</span>
                )}
              </td>
              <td className="actions">
                {a.hasUpdate && (
                  <button className="primary" disabled={busy !== null} onClick={() => update(a)}>
                    {busy === a.package ? <Loader2 size={16} className="spin" /> : <ArrowUpCircle size={16} />} Обновить
                  </button>
                )}
                <button title="Указать источник обновлений" onClick={() => editSource(a)}>
                  <Settings2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                Для установленных приложений источник обновлений не найден. Включи «показать все приложения» и укажи GitHub-репозиторий
                нужного.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
