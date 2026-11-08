import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@triphub/database';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { clearSessionCookie, readSessionToken, requestCtx, setSessionCookie } from './auth.http';
import { CurrentUser, SessionGuard, type AuthedRequest } from './auth.guards';
import { UUID_RE } from '../tenancy/tenancy.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { AuthService, InvalidTokenError } from './auth.service';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
// NIST-style: length over composition rules.
const password = z.string().min(10).max(128);

const RegisterDto = z.object({ email, password, displayName: z.string().trim().min(1).max(80).optional() });
const code = z.string().trim().min(6).max(32);
const LoginDto = z.object({ email, password: z.string().min(1).max(128), code: code.optional() });
const CodeDto = z.object({ code });
const DisableMfaDto = z.object({ password: z.string().min(1).max(128), code });
const StepUpDto = z.object({ password: z.string().min(1).max(128), code: code.optional() });
const TokenDto = z.object({ token: z.string().min(20).max(200) });
const ResetRequestDto = z.object({ email });
const ResetConfirmDto = z.object({ token: z.string().min(20).max(200), password });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({
      code: 'validation_error',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('register')
  @RateLimit({ limit: 10, windowSec: 60 })
  @HttpCode(202)
  async register(@Body() body: unknown, @Req() req: Request) {
    const dto = parse(RegisterDto, body);
    await this.auth.register(dto.email, dto.password, dto.displayName, requestCtx(req));
    // Identical response whether or not the address already exists.
    return { status: 'verification_email_sent_if_new' };
  }

  @Post('verify-email')
  @RateLimit({ limit: 10, windowSec: 60 })
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown, @Req() req: Request) {
    const dto = parse(TokenDto, body);
    try {
      await this.auth.verifyEmail(dto.token, requestCtx(req));
    } catch (e) {
      if (e instanceof InvalidTokenError) {
        throw new BadRequestException({ code: 'invalid_or_expired_token' });
      }
      throw e;
    }
    return { status: 'verified' };
  }

  @Post('login')
  @RateLimit({ limit: 10, windowSec: 60 })
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const dto = parse(LoginDto, body);
    const { token, user } = await this.auth.login(dto.email, dto.password, dto.code, requestCtx(req));
    setSessionCookie(res, token);
    return { user: publicUser(user) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionToken as string, requestCtx(req));
    clearSessionCookie(res);
  }

  /** Always 200: lets the web header know whether someone is signed in without a failing request in the console. */
  @Get('status')
  async status(@Req() req: Request) {
    const token = readSessionToken(req);
    const authed = token ? await this.auth.authenticate(token) : null;
    return { authenticated: authed !== null };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: User) {
    return { user: publicUser(user) };
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard)
  mfaSetup(@CurrentUser() user: User, @Req() req: Request) {
    return this.auth.mfaSetup(user, requestCtx(req));
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard)
  mfaEnable(@CurrentUser() user: User, @Body() body: unknown, @Req() req: AuthedRequest) {
    const dto = parse(CodeDto, body);
    return this.auth.mfaEnable(user, dto.code, req.session!.id, requestCtx(req));
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @RateLimit({ limit: 5, windowSec: 60 })
  @UseGuards(SessionGuard)
  async mfaDisable(@CurrentUser() user: User, @Body() body: unknown, @Req() req: Request) {
    const dto = parse(DisableMfaDto, body);
    await this.auth.mfaDisable(user, dto.password, dto.code, requestCtx(req));
  }

  @Post('step-up')
  @HttpCode(204)
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard)
  async stepUp(@CurrentUser() user: User, @Body() body: unknown, @Req() req: AuthedRequest) {
    const dto = parse(StepUpDto, body);
    await this.auth.stepUp(user, req.session!.id, dto.password, dto.code, requestCtx(req));
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  async sessions(@CurrentUser() user: User, @Req() req: AuthedRequest) {
    const rows = await this.auth.listSessions(user.id);
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === req.session!.id,
      })),
    };
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async revokeOthers(@CurrentUser() user: User, @Req() req: AuthedRequest) {
    return { revoked: await this.auth.revokeOtherSessions(user.id, req.session!.id, requestCtx(req)) };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async revokeSession(@CurrentUser() user: User, @Param('sessionId') sessionId: string, @Req() req: Request) {
    if (!UUID_RE.test(sessionId)) throw new NotFoundException();
    await this.auth.revokeSession(user.id, sessionId, requestCtx(req));
  }

  @Post('password-reset/request')
  @RateLimit({ limit: 5, windowSec: 60 })
  @HttpCode(202)
  async requestReset(@Body() body: unknown, @Req() req: Request) {
    const dto = parse(ResetRequestDto, body);
    await this.auth.requestPasswordReset(dto.email, requestCtx(req));
    return { status: 'reset_email_sent_if_account_exists' };
  }

  @Post('password-reset/confirm')
  @RateLimit({ limit: 10, windowSec: 60 })
  @HttpCode(200)
  async confirmReset(@Body() body: unknown, @Req() req: Request) {
    const dto = parse(ResetConfirmDto, body);
    try {
      await this.auth.resetPassword(dto.token, dto.password, requestCtx(req));
    } catch (e) {
      if (e instanceof InvalidTokenError) {
        throw new BadRequestException({ code: 'invalid_or_expired_token' });
      }
      throw e;
    }
    return { status: 'password_updated' };
  }
}

function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    locale: u.locale,
    mfaEnabled: u.mfaEnabledAt !== null,
    // Lets the web app show the staff console link; the API still enforces access on every request.
    platformRole: u.platformRole,
  };
}
