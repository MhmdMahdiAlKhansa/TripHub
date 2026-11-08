import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
  SetMetadata,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import Redis from 'ioredis';

export interface HitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSec: number): Promise<HitResult>;
}
export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** Fixed-window counter in process memory. Used in tests and as a single-instance fallback. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  async hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowSec * 1000 };
      this.buckets.set(key, b);
    }
    b.count++;
    return { allowed: b.count <= limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
}

/** Shared across API instances. Fails OPEN on Redis errors so an outage does not take auth down. */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}
  async hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
    try {
      const k = `rl:${key}`;
      const count = await this.redis.incr(k);
      if (count === 1) await this.redis.expire(k, windowSec);
      const ttl = await this.redis.ttl(k);
      if (ttl < 0) await this.redis.expire(k, windowSec);
      return { allowed: count <= limit, retryAfterSec: Math.max(1, ttl) };
    } catch {
      return { allowed: true, retryAfterSec: 1 };
    }
  }
}

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
}
const KEY = 'triphub:ratelimit';
export const RateLimit = (o: RateLimitOptions) => SetMetadata(KEY, o);

const DEFAULT: RateLimitOptions = { limit: 300, windowSec: 60 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const opts =
      this.reflector.getAllAndOverride<RateLimitOptions | undefined>(KEY, [ctx.getHandler(), ctx.getClass()]) ??
      DEFAULT;
    const ipHash = createHash('sha256')
      .update(req.ip ?? 'unknown')
      .digest('hex')
      .slice(0, 24);
    const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    const r = await this.limiter.hit(`${route}:${ipHash}`, opts.limit, opts.windowSec);
    if (!r.allowed) {
      res.setHeader('Retry-After', String(r.retryAfterSec));
      throw new HttpException(
        { code: 'rate_limited', retryAfterSec: r.retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

@Module({
  providers: [
    {
      provide: RATE_LIMITER,
      useFactory: () => {
        const url = process.env.REDIS_URL;
        if (!url || process.env.NODE_ENV === 'test') return new MemoryRateLimiter();
        return new RedisRateLimiter(new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false }));
      },
    },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule implements OnApplicationShutdown {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}
  async onApplicationShutdown() {
    if (this.limiter instanceof RedisRateLimiter) await (this.limiter as any).redis.quit();
  }
}
