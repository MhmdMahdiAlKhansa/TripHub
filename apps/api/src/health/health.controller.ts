import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DB_PING } from './health.tokens';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(@Inject(DB_PING) private readonly ping: () => Promise<void>) {}

  /** Liveness: process is up. No dependencies checked. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Returns 503 when the database is down. */
  @Get('ready')
  async ready() {
    try {
      await this.ping();
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks: { database: 'down' },
      });
    }
  }
}
