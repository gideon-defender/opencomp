import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileMenu } from './mobile-menu';

vi.mock('./main-menu', () => ({
  MainMenu: () => <div data-testid="main-menu-stub" />,
}));

describe('MobileMenu', () => {
  it('renders the current organization badge without a switcher control', async () => {
    render(
      <MobileMenu organization={{ id: 'org_1', name: 'Acme Corp' }} organizationId="org_1" />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByTestId('main-menu-stub')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders no organization badge when organization is null', async () => {
    render(<MobileMenu organization={null} />);

    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByTestId('main-menu-stub')).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
