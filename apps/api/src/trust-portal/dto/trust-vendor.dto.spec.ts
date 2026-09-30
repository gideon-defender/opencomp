import { UpdateVendorTrustSettingsSchema } from './trust-vendor.dto';

describe('UpdateVendorTrustSettingsSchema', () => {
  it('accepts http(s) logo URLs', () => {
    expect(
      UpdateVendorTrustSettingsSchema.safeParse({
        logoUrl: 'https://example.com/logo.png',
      }).success,
    ).toBe(true);
  });

  it('rejects non-http(s) logo URLs that would render in <img src>', () => {
    expect(
      UpdateVendorTrustSettingsSchema.safeParse({
        logoUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      UpdateVendorTrustSettingsSchema.safeParse({
        logoUrl: 'data:image/svg+xml,<svg/>',
      }).success,
    ).toBe(false);
  });

  it('accepts null and undefined logo URLs', () => {
    expect(
      UpdateVendorTrustSettingsSchema.safeParse({ logoUrl: null }).success,
    ).toBe(true);
    expect(UpdateVendorTrustSettingsSchema.safeParse({}).success).toBe(true);
  });
});
