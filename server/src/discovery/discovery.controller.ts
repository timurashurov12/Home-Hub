import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { DiscoveryService, localSubnets } from './discovery.service';

@Controller('api/discovery')
export class DiscoveryController {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  @Get('subnets')
  subnets() {
    return { interfaces: localSubnets(), configured: process.env.SCAN_SUBNETS ?? null };
  }

  @Post('scan')
  scan(@Body() body: { port?: number; subnet?: string }) {
    return this.discovery.discover(body ?? {});
  }
}
