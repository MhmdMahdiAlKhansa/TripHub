import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  LoggerService,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// ------------------------------------------------------------------ request id

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
export type RequestWithId = Request & { id?: string };

/** Accepts a caller-supplied id only if it is a short, safe token; otherwise generates one. */
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}

// ------------------------------------------------------------------ logging

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|code|hash|mfa|otp|iban|card/i;

/** Deep-copies a value, replacing the value of any sensitive-looking key. Bounded depth. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

export const LOG_SINK = Symbol('LOG_SINK');

@Injectable()
export class JsonLogger implements LoggerService {
  private readonly sink: (line: string) => void;
  constructor(@Optional() @Inject(LOG_SINK) sink?: (line: string) => void) {
    this.sink = sink ?? ((l) => process.stdout.write(l + '\n'));
  }

  private write(level: string, message: unknown, rest: unknown[]) {
    const extra = rest.filter((r) => r !== undefined && typeof r !== 'string');
    const context = rest.find((r) => typeof r === 'string');
    this.sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        context,
        msg: typeof message === 'string' ? message : redact(message),
        ...(extra.length ? { data: redact(extra) } : {}),
      }),
    );
  }
  log = (m: unknown, ...r: unknown[]) => this.write('info', m, r);
  warn = (m: unknown, ...r: unknown[]) => this.write('warn', m, r);
  error = (m: unknown, ...r: unknown[]) => this.write('error', m, r);
  debug = (m: unknown, ...r: unknown[]) => this.write('debug', m, r);
  verbose = (m: unknown, ...r: unknown[]) => this.write('debug', m, r);
}

// ------------------------------------------------------------------ errors

const DEFAULT_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'rate_limited',
};

/**
 * Every error leaves the API in one shape: { status, code, message, requestId, ...safe extras }.
 * Unknown errors (database, bugs) are logged server-side and returned as a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const res = http.getResponse<Response>();
    const requestId = req.id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const obj: Record<string, unknown> = typeof raw === 'string' ? { message: raw } : { ...(raw as object) };
      delete obj.statusCode;
      delete obj.error;
      const message = typeof obj.message === 'string' ? obj.message : (HttpStatus[status] ?? 'Error');
      const code = typeof obj.code === 'string' ? obj.code : (DEFAULT_CODES[status] ?? 'error');
      if (status >= 500) this.logger.error('http 5xx', 'Http', { requestId, status, message });
      res.status(status).json({ ...obj, status, code, message, requestId });
      return;
    }

    this.logger.error('unhandled exception', 'Http', {
      requestId,
      name: exception instanceof Error ? exception.name : typeof exception,
      message: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });
    res.status(500).json({ status: 500, code: 'internal_error', message: 'Internal server error', requestId });
  }
}

@Module({
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }, JsonLogger],
  exports: [JsonLogger],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
