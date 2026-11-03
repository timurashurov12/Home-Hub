import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { OptimizeService } from './optimize.service';

@Controller('api/devices/:id/optimize')
export class OptimizeController {
  constructor(@Inject(OptimizeService) private readonly opt: OptimizeService) {}

  @Get()
  status(@Param('id') id: string) {
    return this.opt.status(id);
  }

  /** Разово освободить память: выгрузить фоновые процессы и почистить кэши */
  @Post('free')
  free(@Param('id') id: string) {
    return this.opt.freeNow(id);
  }

  /** Применить пресет soft | aggressive */
  @Post('preset')
  preset(@Param('id') id: string, @Body('preset') preset: 'soft' | 'aggressive') {
    return this.opt.apply(id, preset);
  }

  /** Вернуть всё как было до пресета */
  @Post('revert')
  revert(@Param('id') id: string) {
    return this.opt.revert(id);
  }
}
