import 'reflect-metadata';
import path from 'node:path';
import { config } from 'dotenv';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from './observability/observability';

config({ path: path.resolve(__dirname, '../../../.env') });

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(JsonLogger));
  // Behind a reverse proxy/CDN set TRUST_PROXY (e.g. "1") so req.ip - used by rate limits - is the client.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('TripHub API').setVersion('0.0.0').build(),
  );
  SwaggerModule.setup('api/docs', app, doc);
  await app.listen(Number(process.env.API_PORT ?? 4000));
}
void bootstrap();
