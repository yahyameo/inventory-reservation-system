import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp } from './app.module';
import { loadAppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = configureApp(await NestFactory.create(AppModule.forRoot(config)));
  await app.listen(config.port);
  Logger.log(
    `Listening on :${config.port} (storage=${config.storage.driver}, hold=${config.reservationHoldMs}ms)`,
    'Bootstrap',
  );
}

void bootstrap();
