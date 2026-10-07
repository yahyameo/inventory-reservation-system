import { DynamicModule, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { DomainExceptionFilter } from './inventory/http/domain-exception.filter';
import { InventoryModule } from './inventory/inventory.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return { module: AppModule, imports: [InventoryModule.forRoot(config)] };
  }
}

/** HTTP setup shared by main.ts and the e2e tests, so tests exercise the real pipeline. */
export function configureApp(app: INestApplication): INestApplication {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
