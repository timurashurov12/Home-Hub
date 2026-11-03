import { Gauge, RotateCcw, Sparkles, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, fmtBytes, type OptimizeStatus } from '../api/client';
import { useAction } from '../toast';

const PRESETS = {
  soft: {
    title: 'Мягко',
    text: 'Анимации вдвое быстрее. Интерфейс отзывчивее, внешне почти без изменений.',
  },
  aggressive: {
    title: 'Агрессивно',
    text:
      'Анимации выключены, кэшированные приложения замораживаются, отключаются фоновые сервисы, которые держат память: ' +
      'рекомендации на главном экране, Play Игры, Play Фильмы, YouTube Music, заставка, аналитика Xiaomi. Всё возвращается кнопкой «Откатить».',
  },
} as const;

export function OptimizeCard({ id, onDone }: { id: string; onDone: () => void }) {
  const run = useAction();
  const [st, setSt] = useState<OptimizeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [freed, setFreed] = useState<number | null>(null);

  useEffect(() => {
    api.optimize(id).then(setSt).catch(() => undefined);
  }, [id]);

  const free = async () => {
    setBusy('free');
    const r = await run(() => api.optimizeFree(id));
    if (r) setFreed(r.freed);
    setBusy(null);
    onDone();
  };

  const preset = async (p: 'soft' | 'aggressive') => {
    if (p === 'aggressive' && !confirm(`Применить «Агрессивно»?\n\n${PRESETS.aggressive.text}`)) return;
    setBusy(p);
    const r = await run(() => api.optimizePreset(id, p), `Применено: ${PRESETS[p].title}`);
    if (r) {
      setSt(r);
      setFreed(r.freed.freed);
    }
    setBusy(null);
    onDone();
  };

  const revert = async () => {
    setBusy('revert');
    const r = await run(() => api.optimizeRevert(id), 'Настройки возвращены');
    if (r) setSt(r);
    setBusy(null);
    onDone();
  };

  return (
    <div className="card optimize">
      <b><Gauge size={16} /> Оптимизация памяти</b>
      <div className="row">
        <button className="primary" disabled={!!busy} onClick={free}>
          <Zap size={16} /> {busy === 'free' ? 'Освобождаю…' : 'Освободить память сейчас'}
        </button>
        {freed !== null && <span className="muted">освобождено ≈ {fmtBytes(freed)}</span>}
      </div>
      <p className="hint small">
        Выгружает приложения, работающие в фоне (открытое сейчас не трогает), и чистит их кэш. Это разовое действие:
        со временем фон снова заполнится.
      </p>

      <div className="presets">
        {(Object.keys(PRESETS) as ('soft' | 'aggressive')[]).map((p) => (
          <div key={p} className={`preset ${st?.preset === p ? 'on' : ''}`}>
            <div className="row tight">
              <b><Sparkles size={14} /> {PRESETS[p].title}</b>
              <div className="spacer" />
              {st?.preset === p ? (
                <span className="tag lvl-safe">включено</span>
              ) : (
                <button disabled={!!busy} onClick={() => preset(p)}>{busy === p ? 'Применяю…' : 'Применить'}</button>
              )}
            </div>
            <div className="muted small">{PRESETS[p].text}</div>
          </div>
        ))}
      </div>

      {st?.preset && (
        <div className="row">
          <span className="muted small">
            {st.disabled.length > 0 && `Отключено сервисов: ${st.disabled.length}. `}Всё можно вернуть как было.
          </span>
          <div className="spacer" />
          <button disabled={!!busy} onClick={revert}>
            <RotateCcw size={16} /> {busy === 'revert' ? 'Откатываю…' : 'Откатить'}
          </button>
        </div>
      )}
    </div>
  );
}
