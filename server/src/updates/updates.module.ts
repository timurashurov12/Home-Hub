import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { UpdatesController } from './updates.controller';
import { UpdatesService } from './updates.service';

@Module({ imports: [DevicesModule], controllers: [UpdatesController], providers: [UpdatesService] })
export class UpdatesModule {}
