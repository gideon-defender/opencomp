import { renderToStaticMarkup } from 'react-dom/server';
import { AccessGrantedEmail } from './access-granted';
import { AccessReclaimEmail } from './access-reclaim';
import { AccessRequestNotificationEmail } from './access-request-notification';
import { InviteEmail } from './invite-member';
import { LoginEmailChangedEmail } from './login-email-changed';
import { NdaSigningEmail } from './nda-signing';
import { TrustDomainMisconfiguredEmail } from './trust-domain-misconfigured';
import { runLocaleCases, type LocaleCase } from './locale-cases';

const expiresAt = new Date('2026-12-31T00:00:00Z');

const cases: LocaleCase[] = [
  {
    name: 'AccessGrantedEmail',
    enMarker: 'Access Granted ✓',
    esMarker: 'Acceso concedido ✓',
    build: (locale) =>
      renderToStaticMarkup(
        AccessGrantedEmail({
          toName: 'Ada',
          organizationName: 'Acme',
          expiresAt,
          portalUrl: 'https://portal.example.com/a',
          locale,
        }),
      ),
  },
  {
    name: 'AccessReclaimEmail',
    enMarker: 'Access Your Data',
    esMarker: 'Accede a tus datos',
    build: (locale) =>
      renderToStaticMarkup(
        AccessReclaimEmail({
          toName: 'Ada',
          organizationName: 'Acme',
          accessLink: 'https://portal.example.com/a',
          expiresAt,
          locale,
        }),
      ),
  },
  {
    name: 'AccessRequestNotificationEmail',
    enMarker: 'New Access Request',
    esMarker: 'Nueva solicitud de acceso',
    build: (locale) =>
      renderToStaticMarkup(
        AccessRequestNotificationEmail({
          organizationName: 'Acme',
          requesterName: 'Bob',
          requesterEmail: 'bob@example.com',
          reviewUrl: 'https://app.example.com/review',
          locale,
        }),
      ),
  },
  {
    name: 'InviteEmail',
    enMarker: 'Get started',
    esMarker: 'Comenzar',
    build: (locale) =>
      renderToStaticMarkup(
        InviteEmail({
          organizationName: 'Acme',
          inviteLink: 'https://app.example.com/invite/1',
          locale,
        }),
      ),
  },
  {
    name: 'LoginEmailChangedEmail',
    enMarker: 'Your login email was changed',
    esMarker: 'Tu correo de inicio de sesión ha cambiado',
    build: (locale) =>
      renderToStaticMarkup(
        LoginEmailChangedEmail({
          organizationName: 'Acme',
          oldEmail: 'old@example.com',
          newEmail: 'new@example.com',
          locale,
        }),
      ),
  },
  {
    name: 'NdaSigningEmail',
    enMarker: 'NDA Signature Required',
    esMarker: 'Firma del NDA requerida',
    build: (locale) =>
      renderToStaticMarkup(
        NdaSigningEmail({
          toName: 'Ada',
          organizationName: 'Acme',
          ndaSigningLink: 'https://portal.example.com/nda',
          locale,
        }),
      ),
  },
  {
    name: 'TrustDomainMisconfiguredEmail',
    enMarker: 'Trust Portal Domain Needs Attention',
    esMarker: 'El dominio del Portal de Confianza necesita atención',
    build: (locale) =>
      renderToStaticMarkup(
        TrustDomainMisconfiguredEmail({
          toName: 'Ada',
          organizationName: 'Acme',
          domain: 'trust.example.com',
          settingsUrl: 'https://app.example.com/settings',
          locale,
        }),
      ),
  },
];

describe('email template localization: trust + invites (en/es)', () => {
  runLocaleCases(cases);
});
