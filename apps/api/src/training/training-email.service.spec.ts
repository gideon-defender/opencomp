import { triggerEmail } from '../email/trigger-email';
import { TrainingCertificatePdfService } from './training-certificate-pdf.service';
import { TrainingEmailService } from './training-email.service';

jest.mock('../email/trigger-email', () => ({
  triggerEmail: jest.fn(),
}));

const mockTriggerEmail = triggerEmail as jest.Mock;

describe('TrainingEmailService locale threading', () => {
  const certificatePdfService = {
    generateTrainingCertificatePdf: jest.fn(),
    generateHipaaCertificatePdf: jest.fn(),
  } as unknown as TrainingCertificatePdfService;

  let service: TrainingEmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    (
      certificatePdfService.generateTrainingCertificatePdf as jest.Mock
    ).mockResolvedValue(Buffer.from('pdf'));
    mockTriggerEmail.mockResolvedValue({ id: 'email-1' });
    service = new TrainingEmailService(certificatePdfService);
  });

  it('sends a Spanish subject and template for locale es', async () => {
    await service.sendTrainingCompletedEmail({
      toEmail: 'ana@example.com',
      toName: 'Ana',
      organizationName: 'Acme',
      completedAt: new Date('2026-01-15T00:00:00Z'),
      locale: 'es',
    });

    expect(mockTriggerEmail).toHaveBeenCalledTimes(1);
    // TrainingCompletedEmail is invoked directly, so `react` is the rendered
    // <Html> element — its lang carries the threaded locale.
    const payload = mockTriggerEmail.mock.calls[0][0] as {
      subject: string;
      react: { props: { lang: string } };
    };
    expect(payload.subject).toContain('¡Felicidades!');
    expect(payload.react.props.lang).toBe('es');
  });

  it('falls back to English subject and template when locale is omitted', async () => {
    await service.sendTrainingCompletedEmail({
      toEmail: 'bob@example.com',
      toName: 'Bob',
      organizationName: 'Acme',
      completedAt: new Date('2026-01-15T00:00:00Z'),
    });

    expect(mockTriggerEmail).toHaveBeenCalledTimes(1);
    const payload = mockTriggerEmail.mock.calls[0][0] as {
      subject: string;
      react: { props: { lang: string } };
    };
    expect(payload.subject).toContain('Congratulations!');
    expect(payload.react.props.lang).toBe('en');
  });
});
