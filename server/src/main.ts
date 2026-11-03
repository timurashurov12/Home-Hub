import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllErrorsFilter } from './errors.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllErrorsFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT) || 3000;
  // 0.0.0.0 — чтобы панель открывалась и с телефона в той же сети
  await app.listen(port, process.env.HOST || '0.0.0.0');
  console.log(`TV Hub: http://localhost:${port}`);
}
bootstrap();
