import {
  Body, Controller, Delete, Get, Header, Inject, Param, Patch, Post, Query, StreamableFile,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { DevicesService } from './devices.service';
import { StatsService } from './stats.service';

const apkUpload = FileInterceptor('apk', {
  storage: diskStorage({ destination: tmpdir(), filename: (_r, _f, cb) => cb(null, `tvhub-${Date.now()}-${Math.random().toString(36).slice(2)}.apk`) }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /\.(apk)$/i.test(f.originalname)),
});

function parseIds(raw: string | string[] | undefined): string[] {
  const ids = (Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new BadRequestException('Не выбраны устройства');
  return ids;
}

@Controller('api')
export class DevicesController {
  constructor(
    @Inject(DevicesService) private readonly devices: DevicesService,
    @Inject(StatsService) private readonly statsSvc: StatsService,
  ) {}

  /** Мониторинг: CPU, температура, память, топ процессов */
  @Get('devices/:id/stats')
  stats(@Param('id') id: string) {
    return this.statsSvc.stats(id);
  }

  @Get('devices')
  list() {
    return this.devices.list();
  }

  @Post('devices')
  add(@Body() b: { host: string; port?: number; name?: string }) {
    return this.devices.add(b.host, Number(b.port) || 5555, b.name);
  }

  @Patch('devices/:id')
  rename(@Param('id') id: string, @Body() b: { name: string }) {
    return this.devices.rename(id, b.name);
  }

  @Delete('devices/:id')
  remove(@Param('id') id: string) {
    return this.devices.remove(id);
  }

  @Post('devices/:id/connect')
  connect(@Param('id') id: string) {
    return this.devices.reconnect(id).then((output) => ({ ok: true, output }));
  }

  @Get('devices/:id/info')
  info(@Param('id') id: string) {
    return this.devices.info(id);
  }

  @Get('devices/:id/apps')
  apps(@Param('id') id: string, @Query('system') system?: string) {
    return this.devices.apps(id, system === 'true');
  }

  @Get('devices/:id/apps/:pkg')
  appDetails(@Param('id') id: string, @Param('pkg') pkg: string) {
    return this.devices.appDetails(id, pkg);
  }

  @Post('devices/:id/apps/:pkg/launch')
  launch(@Param('id') id: string, @Param('pkg') pkg: string) {
    return this.devices.launch(id, pkg);
  }

  @Post('devices/:id/apps/:pkg/:action')
  appAction(
    @Param('id') id: string,
    @Param('pkg') pkg: string,
    @Param('action') action: string,
    @Query('force') force?: string,
  ) {
    if (!['stop', 'clear', 'uninstall', 'disable', 'enable', 'restore'].includes(action)) throw new BadRequestException();
    return this.devices.appAction(id, pkg, action as any, force === 'true');
  }

  /** Установка APK на одно или несколько ТВ: multipart с полем apk и deviceIds=a,b,c */
  @Post('install')
  @UseInterceptors(apkUpload)
  async install(@UploadedFile() file: Express.Multer.File | undefined, @Body('deviceIds') deviceIds: string) {
    if (!file) throw new BadRequestException('Нужен файл .apk');
    try {
      return await this.devices.installMany(parseIds(deviceIds), file.path);
    } finally {
      await rm(file.path, { force: true });
    }
  }

  @Post('install-url')
  installUrl(@Body() b: { url: string; deviceIds: string[] }) {
    return this.devices.installFromUrl(parseIds(b.deviceIds), b.url);
  }

  @Post('devices/:id/key')
  key(@Param('id') id: string, @Body('key') key: string) {
    return this.devices.key(id, String(key));
  }

  @Post('devices/:id/text')
  text(@Param('id') id: string, @Body('text') text: string) {
    return this.devices.text(id, String(text ?? ''));
  }

  @Post('devices/:id/open-url')
  openUrl(@Param('id') id: string, @Body('url') url: string) {
    return this.devices.openUrl(id, String(url ?? ''));
  }

  @Get('devices/:id/screenshot')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'no-store')
  async screenshot(@Param('id') id: string) {
    return new StreamableFile(await this.devices.screenshot(id));
  }

  @Post('devices/:id/reboot')
  reboot(@Param('id') id: string) {
    return this.devices.reboot(id);
  }
}
