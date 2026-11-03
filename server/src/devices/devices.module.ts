import { Inject, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { DevicesStore } from './devices.store';
import { DnsController } from './dns.controller';
import { DnsService } from './dns.service';
import { OptimizeController } from './optimize.controller';
import { OptimizeService } from './optimize.service';
import { StatsService } from './stats.service';

@Module({ controllers: [DevicesController, OptimizeController, DnsController], providers: [DevicesService, DevicesStore, StatsService, OptimizeService, DnsService], exports: [DevicesService] })
export class DevicesModule implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(@Inject(DevicesService) private readonly devices: DevicesService) {}

  onApplicationBootstrap() {
    // Автопереподключение сохранённых ТВ: при старте и раз в 30 секунд
    const tick = () => this.devices.reconnectAll().catch(() => undefined);
    tick();
    this.timer = setInterval(tick, 30_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
