import { useEffect, useMemo, useState } from 'react';
import { api, type AppInfo, type Device } from '../api/client';
import { useAction } from '../toast';
import { InstallDialog } from './InstallDialog';

export function AppsTab({ device }: { device: Device }) {
  const run = useAction();
  const id = device.id;
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [system, setSystem] = useState(false);
  const [q, setQ] = useState('');
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => setApps((await run(() => api.apps(id, system))) ?? []);
  useEffect(() => {
    setApps(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, system]);

  const filtered = useMemo(() => apps?.filter((a) => a.package.toLowerCase().includes(q.toLowerCase())) ?? [], [apps, q]);

  const act = async (pkg: string, fn: () => Promise<unknown>, ok: string, reload = false) => {
    setBusy(pkg);
    const r = await run(fn, ok);
    setBusy(null);
    if (r !== undefined && reload) load();
  };

  return (
    <div>
      <div className="row">
        <input placeholder="Поиск по пакету…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={system} onChange={(e) => setSystem(e.target.checked)} /> системные
        </label>
        <div className="spacer" />
        <button onClick={load}>↻</button>
        <button className="primary" onClick={() => setInstalling(true)}>⬇ Установить APK</button>
      </div>

      {!apps ? (
        <div className="empty">Загружаю список приложений…</div>
      ) : (
        <table className="apps">
          <thead>
            <tr>
              <th>Пакет</th>
              <th>Версия</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.package} className={a.disabled ? 'disabled' : ''}>
                <td>
                  {a.package}
                  {a.system && <span className="tag">system</span>}
                  {a.disabled && <span className="tag">отключено</span>}
                </td>
                <td className="muted">{a.versionCode ?? '—'}</td>
                <td className="actions">
                  <button disabled={busy === a.package} title="Запустить" onClick={() => act(a.package, () => api.launch(id, a.package), `Запущено: ${a.package}`)}>▶</button>
                  <button disabled={busy === a.package} title="Остановить" onClick={() => act(a.package, () => api.appAction(id, a.package, 'stop'), 'Остановлено')}>⏹</button>
                  <button
                    disabled={busy === a.package}
                    title="Очистить данные"
                    onClick={() => confirm(`Очистить данные ${a.package}?`) && act(a.package, () => api.appAction(id, a.package, 'clear'), 'Данные очищены')}
                  >🧹</button>
                  <button
                    disabled={busy === a.package}
                    title={a.disabled ? 'Включить' : 'Отключить'}
                    onClick={() => act(a.package, () => api.appAction(id, a.package, a.disabled ? 'enable' : 'disable'), a.disabled ? 'Включено' : 'Отключено', true)}
                  >{a.disabled ? '✅' : '🚫'}</button>
                  <button
                    className="danger"
                    disabled={busy === a.package}
                    title="Удалить"
                    onClick={() => confirm(`Удалить ${a.package}?${a.system ? '\nЭто системное приложение: оно будет удалено для пользователя, вернуть можно сбросом.' : ''}`) && act(a.package, () => api.appAction(id, a.package, 'uninstall'), 'Удалено', true)}
                  >🗑</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">Ничего не найдено</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {installing && <InstallDialog devices={[device]} preselect={id} onClose={() => setInstalling(false)} onDone={load} />}
    </div>
  );
}
