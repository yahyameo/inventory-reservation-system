import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

/** Serves Swagger UI at /docs and the OpenAPI JSON at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Inventory Reservation System')
    .setDescription(
      'Flash-sale reservations that never oversell. Reserve holds stock for 2 minutes; ' +
        'confirm completes the purchase; cancel or expiry releases the stock.',
    )
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup(SWAGGER_PATH, app, () => SwaggerModule.createDocument(app, config));
}
