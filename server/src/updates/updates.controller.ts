import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import type { UpdateSource } from './sources';
import { UpdatesService } from './updates.service';

@Controller('api')
export class UpdatesController {
  constructor(@Inject(UpdatesService) private readonly updates: UpdatesService) {}

  @Get('devices/:id/updates')
  check(@Param('id') id: string, @Query('refresh') refresh?: string) {
    return this.updates.check(id, refresh === '1' || refresh === 'true');
  }

  @Post('devices/:id/updates')
  updateAll(@Param('id') id: string) {
    return this.updates.updateAll(id);
  }

  @Post('devices/:id/updates/:pkg')
  update(@Param('id') id: string, @Param('pkg') pkg: string) {
    return this.updates.update(id, pkg);
  }

  @Get('update-sources')
  sources() {
    return this.updates.sources();
  }

  @Put('update-sources/:pkg')
  setSource(@Param('pkg') pkg: string, @Body() body: UpdateSource) {
    return this.updates.setSource(pkg, body);
  }

  @Delete('update-sources/:pkg')
  removeSource(@Param('pkg') pkg: string) {
    return this.updates.removeSource(pkg);
  }
}
