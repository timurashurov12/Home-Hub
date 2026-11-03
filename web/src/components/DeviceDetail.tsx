import { Pencil, PlugZap, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type Device } from '../api/client';
import { useAction } from '../toast';
import { AppsTab } from './AppsTab';
import { MonitorTab } from './MonitorTab';
import { OverviewTab } from './OverviewTab';
import { RemoteTab } from './RemoteTab';
import { stateLabel, StateDot } from './StateDot';

type Tab = 'overview' | 'apps' | 'remote' | 'monitor';

export function DeviceDetail({ device, onChanged, onRemoved }: { device: Device; onChanged: () => void; onRemoved: () => void }) {
  const run = useAction();
  const [tab, setTab] = useState<Tab>('overview');
  const online = device.state === 'online';

  const rename = async () => {
    const name = prompt('Название ТВ', device.name);
    if (name && name !== device.name) {
      await run(() => api.rename(device.id, name));
      onChanged();
    }
  };

  const remove = async () => {
    if (!confirm(`Удалить «${device.name}» из списка?`)) return;
    await run(() => api.remove(device.id), 'Удалено');
    onRemoved();
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <h2>
            <StateDot state={device.state} /> {device.name}
          </h2>
          <div className="muted">
            {device.id} · {stateLabel(device.state)}
            {device.model && ` · ${device.model}`}
          </div>
        </div>
        <div className="spacer" />
        {device.saved && <button onClick={rename}><Pencil size={16} /> Переименовать</button>}
        {device.saved && <button onClick={() => run(() => api.connect(device.id), 'Переподключено').then(onChanged)}><PlugZap size={16} /> Переподключить</button>}
        {device.saved && <button className="danger" onClick={remove} title="Удалить из списка"><Trash2 size={16} /></button>}
      </div>

      {device.state === 'unauthorized' && (
        <div className="banner">На экране ТВ появился запрос «Разрешить отладку по USB?». Подтверди его пультом и отметь «Всегда разрешать с этого компьютера».</div>
      )}
      {device.state === 'offline' && <div className="banner">ТВ не отвечает. Проверь, что он включён и в той же сети, затем нажми «Переподключить».</div>}

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Обзор</button>
        <button className={tab === 'apps' ? 'active' : ''} onClick={() => setTab('apps')}>Приложения</button>
        <button className={tab === 'remote' ? 'active' : ''} onClick={() => setTab('remote')}>Пульт и экран</button>
        <button className={tab === 'monitor' ? 'active' : ''} onClick={() => setTab('monitor')}>Мониторинг</button>
      </div>

      {online ? (
        <>
          {tab === 'overview' && <OverviewTab id={device.id} />}
          {tab === 'apps' && <AppsTab device={device} />}
          {tab === 'remote' && <RemoteTab id={device.id} />}
          {tab === 'monitor' && <MonitorTab id={device.id} />}
        </>
      ) : (
        <div className="empty big">Устройство не в сети</div>
      )}
    </div>
  );
}
