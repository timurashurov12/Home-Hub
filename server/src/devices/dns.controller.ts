import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { DnsService, type DnsRequest } from './dns.service';

@Controller('api')
export class DnsController {
  constructor(@Inject(DnsService) private readonly dns: DnsService) {}

  @Get('devices/:id/dns')
  status(@Param('id') id: string) {
    return this.dns.status(id);
  }

  @Post('devices/:id/dns')
  enable(@Param('id') id: string, @Body() body: DnsRequest) {
    return this.dns.enable(id, body ?? ({} as DnsRequest));
  }

  @Post('devices/:id/dns/off')
  disable(@Param('id') id: string) {
    return this.dns.disable(id);
  }

  @Post('dns/all')
  enableAll(@Body() body: DnsRequest) {
    return this.dns.enableAll(body ?? ({} as DnsRequest));
  }

  @Post('dns/all/off')
  disableAll() {
    return this.dns.disableAll();
  }
}
