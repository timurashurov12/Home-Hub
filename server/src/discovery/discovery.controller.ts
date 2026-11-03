import { BadRequestException, Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { DiscoveryService, localSubnets } from './discovery.service';

@Controller('api/discovery')
export class DiscoveryController {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  @Get('subnets')
  subnets() {
    return { interfaces: localSubnets(), configured: process.env.SCAN_SUBNETS ?? null };
  }

  /** Результат последнего скана (в т.ч. автоскана при запуске). */
  @Get('last')
  last() {
    return this.discovery.state;
  }

  @Post('scan')
  async scan(@Body() body: { subnet?: string }) {
    const results = await this.discovery.discover(body ?? {});
    return { results, subnets: this.discovery.state.subnets, lanReachable: this.discovery.state.lanReachable };
  }

  /** Диагностика одного IP: { ports: { adb: {port, result: open|closed|timeout|EHOSTUNREACH...} } } */
  @Post('probe')
  probe(@Body() body: { host: string }) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(body?.host ?? '')) throw new BadRequestException('Нужен IPv4-адрес');
    return this.discovery.probeHost(body.host);
  }
}
