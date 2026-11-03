import { Controller, Get, Inject } from '@nestjs/common';
import { AdbService } from './adb/adb.service';

@Controller('api/health')
export class HealthController {
  constructor(@Inject(AdbService) private readonly adb: AdbService) {}

  @Get()
  health() {
    return { ok: true, adb: this.adb.available };
  }
}
