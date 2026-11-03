import type { Device } from '../api/client';

const LABEL = { online: 'в сети', offline: 'не в сети', unauthorized: 'ждёт подтверждения на ТВ' };

export function StateDot({ state }: { state: Device['state'] }) {
  return <span className={`dot ${state}`} title={LABEL[state]} />;
}

export const stateLabel = (s: Device['state']) => LABEL[s];
