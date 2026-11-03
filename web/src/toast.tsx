import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Kind = 'ok' | 'err';
const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: Kind }[]>([]);
  const push = useCallback((msg: string, kind: Kind = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Обёртка: выполнить действие, показать ошибку тостом. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        return r;
      } catch (e) {
        toast((e as Error).message, 'err');
        return undefined;
      }
    },
    [toast],
  );
}
