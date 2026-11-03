import { useEffect, useMemo, useState } from 'react';
import { api, type AppAction, type AppInfo, type Device } from '../api/client';
import { useAction, useToast } from '../toast';
import { InstallDialog } from './InstallDialog';

type View = 'user' | 'system' | 'removed';

const LEVEL = {
  safe: { text: 'можно удалить', cls: 'lvl-safe' },
  caution: { text: 'осторожно', cls: 'lvl-caution' },
  critical: { text: 'не трогать', cls: 'lvl-critical' },
} as const;

/** Подтверждение перед опасным действием. Возвращает force-флаг или null, если отменено. */
function confirmDanger(a: AppInfo, what: string): boolean | null {
  if (a.level === 'critical') {
    const typed = prompt(
      `⚠️ «${a.label}» критичен для системы.\n${a.note ?? ''}\n\nСтик может перестать загружаться или потерять связь с панелью. ` +
        `Вернуть можно через вкладку «Удалённые» или сбросом до заводских.\n\nЧтобы ${what}, введи имя пакета:\n${a.package}`,
    );
    return typed === a.package ? true : null;
  }
  const extra = a.level === 'caution' ? `\n\n⚠️ ${a.label}: ${a.note ?? 'пропадёт заметная функция'}` : '';
  const sys = a.system ? '\n\nПредустановленное приложение удаляется для пользователя, его можно вернуть во вкладке «Удалённые».' : '';
  return confirm(`${what[0].toUpperCase()}${what.slice(1)} ${a.package}?${extra}${sys}`) ? false : null;
}

export function AppsTab({ device }: { device: Device }) {
  const run = useAction();
  const toast = useToast();
  const id = device.id;
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [view, setView] = useState<View>('user');
  const [q, setQ] = useState('');
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const needSystem = view !== 'user';
  const load = async () => setApps((await run(() => api.apps(id, needSystem))) ?? []);
  useEffect(() => {
    setApps(null);
    setSelected(new Set());
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, needSystem]);

  const filtered = useMemo(() => {
    const qq = q.toLowerCase();
    return (apps ?? [])
      .filter((a) => (view === 'removed' ? a.removed : view === 'system' ? a.system && !a.removed : !a.system))
      .filter((a) => a.package.toLowerCase().includes(qq) || a.label?.toLowerCase().includes(qq));
  }, [apps, q, view]);

  const act = async (a: AppInfo, action: AppAction, ok: string, reload = false, force = false) => {
    setBusy(a.package);
    const r = await run(() => api.appAction(id, a.package, action, force), ok);
    setBusy(null);
    if (r !== undefined && reload) load();
    return r !== undefined;
  };

  const dangerous = (a: AppInfo, action: AppAction, what: string, ok: string, reload = false) => {
    const force = confirmDanger(a, what);
    if (force !== null) act(a, action, ok, reload, force);
  };

  const toggle = (pkg: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(pkg)) n.delete(pkg);
      else n.add(pkg);
      return n;
    });

  const selectSafe = () => setSelected(new Set(filtered.filter((a) => a.level === 'safe').map((a) => a.package)));

  const bulk = async (action: 'uninstall' | 'restore') => {
    const list = filtered.filter((a) => selected.has(a.package));
    const risky = list.filter((a) => a.level === 'critical');
    if (risky.length) {
      toast(`Сними отметку с критичных пакетов: ${risky.map((r) => r.package).join(', ')}`, 'err');
      return;
    }
    const caution = list.filter((a) => a.level === 'caution');
    const msg =
      action === 'uninstall'
        ? `Удалить ${list.length} прилож.?${caution.length ? `\n\n⚠️ Среди них «осторожно»: ${caution.map((c) => c.label).join(', ')}` : ''}\n\nИх можно будет вернуть во вкладке «Удалённые».`
        : `Восстановить ${list.length} прилож.?`;
    if (!confirm(msg)) return;
    setBusy('*');
    let ok = 0;
    for (const a of list) {
      try {
        await api.appAction(id, a.package, action);
        ok++;
      } catch (e) {
        toast(`${a.package}: ${(e as Error).message}`, 'err');
      }
    }
    setBusy(null);
    toast(`${action === 'uninstall' ? 'Удалено' : 'Восстановлено'}: ${ok} из ${list.length}`);
    setSelected(new Set());
    load();
  };

  const counts = useMemo(
    () => ({
      user: apps?.filter((a) => !a.system).length,
      system: needSystem ? apps?.filter((a) => a.system && !a.removed).length : undefined,
      removed: needSystem ? apps?.filter((a) => a.removed).length : undefined,
    }),
    [apps, needSystem],
  );
  const bulkMode = view !== 'user';

  return (
    <div>
      <div className="tabs small">
        <button className={view === 'user' ? 'active' : ''} onClick={() => setView('user')}>Мои {counts.user != null && `(${counts.user})`}</button>
        <button className={view === 'system' ? 'active' : ''} onClick={() => setView('system')}>Предустановленные {counts.system != null && `(${counts.system})`}</button>
        <button className={view === 'removed' ? 'active' : ''} onClick={() => setView('removed')}>Удалённые {counts.removed != null && `(${counts.removed})`}</button>
      </div>

      {view === 'system' && (
        <p className="hint">
          Предустановленные приложения удаляются для пользователя (<code>pm uninstall --user 0</code>): без root и обратимо,
          их можно вернуть во вкладке «Удалённые». Метки: <span className="tag lvl-safe">можно удалить</span>
          <span className="tag lvl-caution">осторожно</span> <span className="tag lvl-critical">не трогать</span>. Пакеты без метки
          справочнику неизвестны: удаляй их, только если знаешь, что это.
        </p>
      )}

      <div className="row">
        <input placeholder="Поиск по пакету или названию…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="spacer" />
        {view === 'system' && <button onClick={selectSafe}>Отметить «можно удалить»</button>}
        {bulkMode && selected.size > 0 && (
          <button className={view === 'removed' ? 'primary' : 'danger'} disabled={busy === '*'} onClick={() => bulk(view === 'removed' ? 'restore' : 'uninstall')}>
            {busy === '*' ? 'Выполняю…' : view === 'removed' ? `Восстановить (${selected.size})` : `Удалить (${selected.size})`}
          </button>
        )}
        <button onClick={load}>↻</button>
        {view === 'user' && <button className="primary" onClick={() => setInstalling(true)}>⬇ Установить APK</button>}
      </div>

      {!apps ? (
        <div className="empty">Загружаю список приложений…</div>
      ) : (
        <table className="apps">
          <thead>
            <tr>
              {bulkMode && <th />}
              <th>Приложение</th>
              {view !== 'removed' && <th>Версия</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.package} className={a.disabled ? 'disabled' : ''}>
                {bulkMode && (
                  <td className="sel">
                    <input type="checkbox" checked={selected.has(a.package)} onChange={() => toggle(a.package)} />
                  </td>
                )}
                <td>
                  {a.label && <div className="app-label">{a.label}</div>}
                  <div className={a.label ? 'muted small' : ''}>
                    {a.package}
                    {a.level && <span className={`tag ${LEVEL[a.level].cls}`}>{LEVEL[a.level].text}</span>}
                    {a.disabled && <span className="tag">отключено</span>}
                  </div>
                  {a.note && <div className="muted small">{a.note}</div>}
                </td>
                {view !== 'removed' && <td className="muted">{a.versionCode ?? '—'}</td>}
                <td className="actions">
                  {a.removed ? (
                    <button disabled={busy === a.package} onClick={() => act(a, 'restore', `Восстановлено: ${a.package}`, true)}>↺ Восстановить</button>
                  ) : (
                    <>
                      <button disabled={busy === a.package} title="Запустить" onClick={() => run(() => api.launch(id, a.package), `Запущено: ${a.package}`)}>▶</button>
                      <button disabled={busy === a.package} title="Остановить" onClick={() => act(a, 'stop', 'Остановлено')}>⏹</button>
                      <button disabled={busy === a.package} title="Очистить данные" onClick={() => dangerous(a, 'clear', 'очистить данные', 'Данные очищены')}>🧹</button>
                      <button
                        disabled={busy === a.package}
                        title={a.disabled ? 'Включить' : 'Отключить'}
                        onClick={() => (a.disabled ? act(a, 'enable', 'Включено', true) : dangerous(a, 'disable', 'отключить', 'Отключено', true))}
                      >{a.disabled ? '✅' : '🚫'}</button>
                      <button className="danger" disabled={busy === a.package} title="Удалить" onClick={() => dangerous(a, 'uninstall', 'удалить', 'Удалено', true)}>🗑</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">{view === 'removed' ? 'Удалённых предустановленных приложений нет' : 'Ничего не найдено'}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {installing && <InstallDialog devices={[device]} preselect={id} onClose={() => setInstalling(false)} onDone={load} />}
    </div>
  );
}
