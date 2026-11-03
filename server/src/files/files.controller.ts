import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { diskStorage } from 'multer';
import { FilesService } from './files.service';

const fileUpload = FileInterceptor('file', {
  storage: diskStorage({ destination: tmpdir(), filename: (_r, _f, cb) => cb(null, `tvhub-up-${Date.now()}-${Math.random().toString(36).slice(2)}`) }),
  limits: { fileSize: 16 * 1024 * 1024 * 1024 },
});

@Controller('api/devices/:id')
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Get('files')
  list(@Param('id') id: string, @Query('path') path?: string) {
    return this.files.list(id, path || '/sdcard');
  }

  @Get('volumes')
  volumes(@Param('id') id: string) {
    return this.files.volumes(id);
  }

  /** multipart: file + path (папка на ТВ) */
  @Post('files')
  @UseInterceptors(fileUpload)
  async upload(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body('path') path: string) {
    if (!file) throw new BadRequestException('Нужен файл');
    // multer отдаёт имя в latin1 — восстанавливаем UTF-8 (кириллица в названиях)
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    try {
      return await this.files.upload(id, file.path, name, path || '/sdcard/Download');
    } finally {
      await rm(file.path, { force: true });
    }
  }

  @Get('files/download')
  async download(@Param('id') id: string, @Query('path') path: string, @Res() res: Response) {
    const f = await this.files.pull(id, String(path ?? ''));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    const stream = createReadStream(f.local);
    const cleanup = () => rm(f.dir, { recursive: true, force: true }).catch(() => undefined);
    stream.on('close', cleanup);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  @Post('files/mkdir')
  mkdir(@Param('id') id: string, @Body() body: { path: string; name: string }) {
    return this.files.mkdir(id, String(body?.path ?? ''), String(body?.name ?? ''));
  }

  @Delete('files')
  remove(@Param('id') id: string, @Query('path') path: string) {
    return this.files.remove(id, String(path ?? ''));
  }

  @Get('players')
  players(@Param('id') id: string) {
    return this.files.players(id);
  }

  /** Открыть видео: url — http(s)-ссылка или путь к файлу на ТВ; player — пакет плеера (необязательно). */
  @Post('play')
  play(@Param('id') id: string, @Body() body: { url: string; player?: string }) {
    return this.files.play(id, String(body?.url ?? '').trim(), body?.player || undefined);
  }
}
