import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enMessages from '../../../../../../../messages/en.json';
import esMessages from '../../../../../../../messages/es.json';
import { CarouselControls } from './CarouselControls';

vi.mock('@trycompai/design-system', () => ({
  Button: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
  } & Record<string, unknown>) => <button {...props}>{children}</button>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

function renderWithLocale(locale: 'en' | 'es') {
  const messages = locale === 'en' ? enMessages : esMessages;
  const handlePrevious = () => {};
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CarouselControls currentIndex={0} total={3} onPrevious={handlePrevious} />
    </NextIntlClientProvider>,
  );
}

describe.each([
  ['en', 'Previous video', 'Next video', '1 of 3'],
  ['es', 'Video anterior', 'Video siguiente', '1 de 3'],
] as const)('CarouselControls (%s)', (locale, prevLabel, nextLabel, count) => {
  afterEach(() => {
    cleanup();
  });

  it('renders translated strings', () => {
    renderWithLocale(locale);
    expect(screen.getByLabelText(prevLabel)).toBeDefined();
    expect(screen.getByLabelText(nextLabel)).toBeDefined();
    expect(screen.getByText(count)).toBeDefined();
  });
});
