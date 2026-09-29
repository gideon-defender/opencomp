import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { resolveLocale } from './locale';
import { localizeHttpException } from './localize-error';

type RequestWithLanguage = {
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * Global interceptor: translates known error-code messages in thrown
 * HttpExceptions according to the request's Accept-Language header.
 *
 * Status codes, exception classes, and response shapes are untouched —
 * only message text changes. Guards (HybridAuthGuard/PermissionGuard),
 * @RequirePermission metadata, DTOs, and ValidationPipe behavior are
 * unaffected.
 */
@Injectable()
export class LocalizedErrorsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LocalizedErrorsInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithLanguage | undefined>();
    const header = request?.headers?.['accept-language'];
    const acceptLanguage = Array.isArray(header) ? header[0] : header;

    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpException) {
          const before = error.message;
          localizeHttpException({ error, acceptLanguage });
          // Coverage signal: a non-English request whose message did not
          // change hit an error with no translation. Debug level only —
          // the message can carry resource IDs, so never log above debug.
          if (
            resolveLocale(acceptLanguage) !== 'en' &&
            error.message === before
          ) {
            this.logger.debug(
              `Untranslated error for non-English request: ` +
                `status=${error.getStatus()} message="${before.slice(0, 120)}"`,
            );
          }
        }
        return throwError(() => error);
      }),
    );
  }
}
