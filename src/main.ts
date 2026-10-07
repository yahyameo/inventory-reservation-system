import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp } from './app.module';
import { loadAppConfig } from './config/app-config';
import { setupSwagger, SWAGGER_PATH } from './swagger';

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = configureApp(await NestFactory.create(AppModule.forRoot(config)));
  setupSwagger(app);
  await app.listen(config.port);
  Logger.log(
    `Listening on :${config.port} (storage=${config.storage.driver}, hold=${config.reservationHoldMs}ms)`,
    'Bootstrap',
  );
  Logger.log(`API docs at http://localhost:${config.port}/${SWAGGER_PATH}`, 'Bootstrap');
}

void bootstrap();
