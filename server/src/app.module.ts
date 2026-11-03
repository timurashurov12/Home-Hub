import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AdbModule } from './adb/adb.module';
import { CacheModule } from './cache/cache.module';
import { DevicesModule } from './devices/devices.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { FilesModule } from './files/files.module';
import { UpdatesModule } from './updates/updates.module';
import { HealthController } from './health.controller';

const webDist = join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: [
    CacheModule,
    AdbModule,
    DevicesModule,
    DiscoveryModule,
    FilesModule,
    UpdatesModule,
    ...(existsSync(webDist) ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'] })] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
