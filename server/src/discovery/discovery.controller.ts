import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
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
  scan(@Body() body: { subnet?: string }) {
    return this.discovery.discover(body ?? {});
  }
}
