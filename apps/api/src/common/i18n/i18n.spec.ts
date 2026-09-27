import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, throwError } from 'rxjs';
import { PermissionGuard } from '../../auth/permission.guard';
import { localizeHttpException } from './localize-error';
import { withErrorCode } from './error-messages';
import { LocalizedErrorsInterceptor } from './localized-errors.interceptor';
import { resolveLocale } from './locale';

jest.mock('../../auth/auth.server', () => ({
  auth: { api: { hasPermission: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  RESTRICTED_ROLES: ['employee', 'contractor'],
  PRIVILEGED_ROLES: ['owner', 'admin', 'auditor'],
}));

describe('resolveLocale', () => {
  it.each([
    ['en', 'en'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['en-US', 'en'],
    ['fr', 'en'],
    ['fr-FR, fr;q=0.9, en;q=0.8', 'en'],
    ['fr, es;q=0.9', 'es'],
    ['ES-mx', 'es'],
    ['*', 'en'],
  ])('resolves %s to %s', (header: string, expected: string) => {
    expect(resolveLocale(header)).toBe(expected);
  });

  it('falls back to en for a missing header', () => {
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale('')).toBe('en');
  });
});

describe('localizeHttpException', () => {
  it('translates a known message to Spanish, preserving class and status', () => {
    const error = new NotFoundException('Policy not found');
    const result = localizeHttpException({ error, acceptLanguage: 'es' });

    expect(result).toBeInstanceOf(NotFoundException);
    expect(result.message).toBe('Política no encontrada');
    expect(result.getStatus()).toBe(404);
  });

  it('leaves unknown messages unchanged', () => {
    const error = new BadRequestException('Something bespoke happened');
    localizeHttpException({ error, acceptLanguage: 'es' });

    expect(error.message).toBe('Something bespoke happened');
    expect(error.getStatus()).toBe(400);
  });

  it('returns English untouched when the locale resolves to en', () => {
    const error = new BadRequestException(
      'Only custom frameworks can be edited',
    );
    localizeHttpException({ error, acceptLanguage: 'fr' });

    expect(error.message).toBe('Only custom frameworks can be edited');
  });

  it('translates the Checkr credentials message', () => {
    const error = new UnauthorizedException('Checkr credentials are invalid.');
    localizeHttpException({ error, acceptLanguage: 'es-MX' });

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe('Las credenciales de Checkr no son válidas.');
    expect(error.getStatus()).toBe(401);
  });

  it('translates every remaining error code', () => {
    const cases = [
      ['Access denied', 'Acceso denegado'],
      ['No fields to update', 'No hay campos para actualizar'],
    ] as const;
    for (const [english, spanish] of cases) {
      const error = new ForbiddenException(english);
      localizeHttpException({ error, acceptLanguage: 'es' });
      expect(error.message).toBe(spanish);
      expect(error.getStatus()).toBe(403);
    }
  });

  it('translates by code even when the English text was reworded', () => {
    // The code rides on `cause`, not on the message text — rewording the
    // English string must not drop the translation.
    const error = withErrorCode(
      new NotFoundException('Policy relocated permanently'),
      'POLICY_NOT_FOUND',
    );
    localizeHttpException({ error, acceptLanguage: 'es' });

    expect(error.message).toBe('Política no encontrada');
    expect(error.getStatus()).toBe(404);
  });

  it('does not leak the code into the HTTP response', () => {
    const error = withErrorCode(
      new NotFoundException('Policy not found'),
      'POLICY_NOT_FOUND',
    );

    const response = error.getResponse() as Record<string, unknown>;
    expect(response).not.toHaveProperty('cause');
    expect(response).not.toHaveProperty('code');
    expect(response.message).toBe('Policy not found');
  });

  it('ignores a foreign cause payload', () => {
    const error = new BadRequestException('Something bespoke happened');
    (error as unknown as { cause?: unknown }).cause = new Error('boom');
    localizeHttpException({ error, acceptLanguage: 'es' });

    expect(error.message).toBe('Something bespoke happened');
  });

  it('translates array-form response messages', () => {
    const error = new BadRequestException([
      'No fields to update',
      'Something bespoke happened',
    ]);
    localizeHttpException({ error, acceptLanguage: 'es' });

    const response = error.getResponse() as { message: string[] };
    expect(response.message).toEqual([
      'No hay campos para actualizar',
      'Something bespoke happened',
    ]);
  });

  it('translates string-form responses', () => {
    const error = new NotFoundException('Policy not found');
    (error as unknown as { response: string }).response = 'Policy not found';
    localizeHttpException({ error, acceptLanguage: 'es' });

    expect(error.message).toBe('Política no encontrada');
  });

  it('translates object-form response messages', () => {
    const error = new NotFoundException('Policy not found');
    localizeHttpException({ error, acceptLanguage: 'es' });

    const response = error.getResponse() as { message: string };
    expect(response.message).toBe('Política no encontrada');
  });
});

describe('LocalizedErrorsInterceptor (guard-level Spanish proof)', () => {
  function contextWithLanguage(
    acceptLanguage: string | undefined,
  ): ExecutionContext {
    const request = {
      headers: acceptLanguage ? { 'accept-language': acceptLanguage } : {},
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('emits the guard ForbiddenException with a Spanish message for es', async () => {
    // Scoped API key missing the required permission -> guard throws the
    // real 'API key lacks required permission scope' ForbiddenException.
    const reflector = {
      getAllAndOverride: () => [{ resource: 'policy', actions: ['delete'] }],
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const guardContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          isApiKey: true,
          apiKeyScopes: ['policy:read'],
          headers: {},
          method: 'DELETE',
          url: '/v1/policies/123',
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;

    const thrown = await guard.canActivate(guardContext).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(ForbiddenException);

    const interceptor = new LocalizedErrorsInterceptor();
    const handler = {
      handle: () => throwError(() => thrown),
    } as unknown as CallHandler;
    const result = interceptor.intercept(contextWithLanguage('es'), handler);

    let caught: unknown = null;
    try {
      await lastValueFrom(result);
    } catch (streamError: unknown) {
      caught = streamError;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    const forbidden = caught as ForbiddenException;
    expect(forbidden.message).toBe(
      'La clave de API no tiene el ámbito de permiso requerido',
    );
    expect(forbidden.getStatus()).toBe(403);
  });

  it('reads the first entry of an array-form accept-language header', async () => {
    const interceptor = new LocalizedErrorsInterceptor();
    const handler = {
      handle: () => throwError(() => new NotFoundException('Policy not found')),
    } as unknown as CallHandler;
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'accept-language': ['es', 'en'] } }),
      }),
    } as unknown as ExecutionContext;

    let caught: unknown = null;
    try {
      await lastValueFrom(interceptor.intercept(context, handler));
    } catch (streamError: unknown) {
      caught = streamError;
    }

    expect((caught as NotFoundException).message).toBe(
      'Política no encontrada',
    );
  });

  it('leaves errors untouched when the header is missing', async () => {
    const interceptor = new LocalizedErrorsInterceptor();
    const handler = {
      handle: () => throwError(() => new NotFoundException('Policy not found')),
    } as unknown as CallHandler;

    let caught: unknown = null;
    try {
      await lastValueFrom(
        interceptor.intercept(contextWithLanguage(undefined), handler),
      );
    } catch (streamError: unknown) {
      caught = streamError;
    }

    expect((caught as NotFoundException).message).toBe('Policy not found');
  });

  it('passes non-HttpException errors through unchanged', async () => {
    const interceptor = new LocalizedErrorsInterceptor();
    const handler = {
      handle: () => throwError(() => new Error('boom')),
    } as unknown as CallHandler;

    let caught: unknown = null;
    try {
      await lastValueFrom(
        interceptor.intercept(contextWithLanguage('es'), handler),
      );
    } catch (streamError: unknown) {
      caught = streamError;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('boom');
  });

  it('logs untranslated messages at debug level for non-English requests', async () => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    try {
      const interceptor = new LocalizedErrorsInterceptor();
      const handler = {
        handle: () =>
          throwError(
            () => new BadRequestException('Something bespoke happened'),
          ),
      } as unknown as CallHandler;

      let caught: unknown = null;
      try {
        await lastValueFrom(
          interceptor.intercept(contextWithLanguage('es'), handler),
        );
      } catch (streamError: unknown) {
        caught = streamError;
      }

      expect((caught as BadRequestException).message).toBe(
        'Something bespoke happened',
      );
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug.mock.calls[0]?.[0]).toContain('Untranslated');
    } finally {
      debug.mockRestore();
    }
  });
});
