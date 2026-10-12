import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';

export type UserRole = 'meeting_lead';

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  email: string;
  roles: UserRole[];
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
    }
  }
}

export interface AuthProvider {
  getUser(request: Request): Promise<AuthenticatedUser | null>;
  createLoginHandler?: RequestHandler;
}

const SESSION_COOKIE = 'rd_sync_dev_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const sessionSchema = z.object({
  sub: z.string().uuid(),
  exp: z.number().int().positive(),
}).strict();

function getSigningSecret(): string {
  const secret = process.env.AUTH_DEV_STUB_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_DEV_STUB_SECRET must be set to at least 32 characters for dev-stub auth');
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function serializeCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${new Date(Date.now() + maxAge * 1000).toUTCString()}`;
}

const devStubProvider: AuthProvider = {
  async getUser(request) {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;
    const cookie = cookieHeader.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) return null;

    const token = cookie.slice(SESSION_COOKIE.length + 1);
    const separator = token.lastIndexOf('.');
    if (separator <= 0) return null;
    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!safeEqual(signature, sign(payload))) return null;

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    const session = sessionSchema.safeParse(parsedPayload);
    if (!session.success || session.data.exp <= Math.floor(Date.now() / 1000)) return null;

    const result = await query<{
      id: string;
      display_name: string;
      email: string;
    }>(
      `SELECT id, display_name, email FROM person WHERE id = $1 AND active = true`,
      [session.data.sub],
    );
    const person = result.rows[0];
    if (!person) return null;
    return {
      id: person.id,
      displayName: person.display_name,
      email: person.email,
      roles: person.id === '10000000-0000-4000-8000-000000000001' ? ['meeting_lead'] : [],
    };
  },

  createLoginHandler: async (request, response, next) => {
    try {
      const body = z.object({ userId: z.string().uuid() }).strict().safeParse(request.body);
      if (!body.success) {
        response.status(400).json({ error: { code: 'validation_error', message: 'Choose a valid seeded user' } });
        return;
      }
      const result = await query<{ id: string }>(
        `SELECT id FROM person WHERE id = $1 AND active = true`,
        [body.data.userId],
      );
      if (!result.rows[0]) {
        response.status(400).json({ error: { code: 'invalid_user', message: 'User is not an active seeded user' } });
        return;
      }

      const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
      const payload = Buffer.from(JSON.stringify({ sub: body.data.userId, exp })).toString('base64url');
      const token = `${payload}.${sign(payload)}`;
      response.setHeader('Set-Cookie', serializeCookie(token, SESSION_TTL_SECONDS));
      response.status(200).json({ authenticated: true, expiresAt: new Date(exp * 1000).toISOString() });
    } catch (error) {
      next(error);
    }
  },
};

const providers: Record<string, AuthProvider> = { 'dev-stub': devStubProvider };

export function assertAuthConfiguration(): void {
  const providerName = process.env.AUTH_PROVIDER ?? 'dev-stub';
  if (process.env.NODE_ENV === 'production' && providerName === 'dev-stub') {
    throw new Error('Refusing to start in production with AUTH_PROVIDER=dev-stub');
  }
  if (!providers[providerName]) throw new Error(`Unsupported AUTH_PROVIDER: ${providerName}`);
  if (providerName === 'dev-stub') getSigningSecret();
}

function getProvider(): AuthProvider {
  const providerName = process.env.AUTH_PROVIDER ?? 'dev-stub';
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unsupported AUTH_PROVIDER: ${providerName}`);
  return provider;
}

export async function getUser(request: Request): Promise<AuthenticatedUser | null> {
  return getProvider().getUser(request);
}

export function createDevLoginHandler(): RequestHandler | null {
  if (process.env.NODE_ENV === 'production') return null;
  const handler = getProvider().createLoginHandler;
  if (!handler) throw new Error('The configured auth provider does not support development login');
  return handler;
}

export const requireUser: RequestHandler = async (request, response, next) => {
  try {
    const user = await getUser(request);
    if (!user) {
      response.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
      return;
    }
    request.authenticatedUser = user;
    response.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRole(role: UserRole): RequestHandler {
  return async (request, response, next) => {
    try {
      const user = await getUser(request);
      if (!user) {
        response.status(401).json({ error: { code: 'unauthorized', message: 'Authentication required' } });
        return;
      }
      request.authenticatedUser = user;
      response.locals.user = user;
      if (!user.roles.includes(role)) {
        response.status(403).json({ error: { code: 'forbidden', message: 'Insufficient permissions' } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getActor(request: Request): AuthenticatedUser {
  const user = request.authenticatedUser;
  if (!user) throw new Error('getActor must be called after requireUser or requireRole');
  return user;
}

export const authSessionCookieProperties = {
  oidc: 'httpOnly, Secure, SameSite=Lax, explicit 12-hour expiry',
} as const;
