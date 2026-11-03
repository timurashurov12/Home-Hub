import { Global, Module } from '@nestjs/common';
import { AdbService } from './adb.service';

@Global()
@Module({ providers: [AdbService], exports: [AdbService] })
export class AdbModule {}
