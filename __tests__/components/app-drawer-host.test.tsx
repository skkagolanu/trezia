/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppDrawerHost from '@/components/layout/AppDrawerHost';

const push = jest.fn();
const refresh = jest.fn();
const closeDrawer = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => '/s/oak/payments',
  useRouter: () => ({ push, refresh }),
}));

jest.mock('@/lib/context/DrawerContext', () => ({
  useDrawer: () => ({ activeRoute: '/payments/new', closeDrawer }),
}));

jest.mock('@/components/ui/Drawer', () => ({
  __esModule: true,
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
}));

jest.mock('@/components/forms/PaymentForm', () => ({
  __esModule: true,
  default: ({ onSuccess }: { onSuccess: (result: { type: 'maintenance'; flatNumber: string }) => void }) => (
    <button type="button" onClick={() => onSuccess({ type: 'maintenance', flatNumber: 'A-101' })}>
      Complete payment
    </button>
  ),
}));

describe('AppDrawerHost payment completion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('navigates to the new receipt and refreshes server data', async () => {
    render(<AppDrawerHost />);
    fireEvent.click(await screen.findByRole('button', { name: 'Complete payment' }));

    expect(closeDrawer).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/s/oak/payments?type=all&period=all&flat=A-101');
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
