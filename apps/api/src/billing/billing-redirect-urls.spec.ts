import { BadRequestException } from '@nestjs/common';
import { validateBillingRedirectUrl } from './billing-redirect-urls';

describe('validateBillingRedirectUrl', () => {
  it('allows http only for local development hosts', () => {
    expect(() =>
      validateBillingRedirectUrl('http://localhost:3000/org_1/billing'),
    ).not.toThrow();

    expect(() =>
      validateBillingRedirectUrl('http://app.gideondefender.com/org_1/billing'),
    ).toThrow(BadRequestException);
  });

  it('allows the dev host over https', () => {
    expect(() =>
      validateBillingRedirectUrl(
        'https://opencomp.dev.gideondefender.com/org_1/billing',
      ),
    ).not.toThrow();
  });
});
