/** @jest-environment jsdom */
// Per-society checklist dismissal persists in a cookie.
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SetupChecklistPanel from '@/components/onboarding/SetupChecklistPanel';
import type { SetupItem } from '@/components/onboarding/setup-items';

const ITEMS: SetupItem[] = [
  {
    id: 'billing_config',
    title: 'Set your maintenance amount and billing window',
    body: 'Bills cannot be generated until these are set.',
    href: '/s/green-acres/settings',
    severity: 'blocking',
  },
  {
    id: 'upi_payment',
    title: 'Set up a UPI ID or payment QR',
    body: 'Residents only see bank-transfer details without this.',
    href: '/s/green-acres/settings',
    severity: 'recommended',
  },
];

function clearCookies() {
  document.cookie.split(';').forEach(c => {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
}

beforeEach(() => { clearCookies(); });

describe('SetupChecklistPanel', () => {
  it('renders every item as a heading, description, and direct link', () => {
    render(<SetupChecklistPanel items={ITEMS} cookieName="tz_setup_dismissed_soc-1" />);

    expect(screen.getByText('Set your maintenance amount and billing window')).toBeInTheDocument();
    expect(screen.getByText('Set up a UPI ID or payment QR')).toBeInTheDocument();
    expect(screen.getByText('Optional')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'Fix now' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/s/green-acres/settings');
  });

  it('hides itself and sets a durable cookie when dismissed', () => {
    render(<SetupChecklistPanel items={ITEMS} cookieName="tz_setup_dismissed_soc-1" />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss setup checklist/i }));

    expect(screen.queryByText('Set your maintenance amount and billing window')).not.toBeInTheDocument();
    expect(document.cookie).toContain('tz_setup_dismissed_soc-1=1');
  });
});
