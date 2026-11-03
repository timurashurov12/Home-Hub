import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/** Ошибки adb (обычный Error) отдаём как 502 с текстом, HttpException — как есть. */
@Catch()
export class AllErrorsFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const body = e.getResponse();
      const message = typeof body === 'string' ? body : (body as any).message ?? e.message;
      return res.status(e.getStatus()).json({ message: Array.isArray(message) ? message.join(', ') : message });
    }
    res.status(502).json({ message: (e as Error)?.message ?? 'Ошибка' });
  }
}
