import { Controller, Get, Inject } from '@nestjs/common';
import { AdbService } from './adb/adb.service';
import { CacheService } from './cache/cache.service';

@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(AdbService) private readonly adb: AdbService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  @Get()
  health() {
    return { ok: true, adb: this.adb.available, cache: this.cache.backend };
  }
}
