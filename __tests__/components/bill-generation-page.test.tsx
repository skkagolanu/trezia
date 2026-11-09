/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import GenerateBillsPage from '@/app/(app)/bills/generate/page';

const mockSocietySingle = jest.fn();
const mockSocietyQuery = {
  select: jest.fn(),
  eq: jest.fn(),
  single: mockSocietySingle,
};
const mockSupabase = { from: jest.fn() };

mockSocietyQuery.select.mockReturnValue(mockSocietyQuery);
mockSocietyQuery.eq.mockReturnValue(mockSocietyQuery);

jest.mock('next/navigation', () => ({
  usePathname: () => '/s/green-acres/bills/generate',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { loading: jest.fn(), error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => mockSupabase),
  isDemoSessionClient: jest.fn(() => false),
}));

describe('GenerateBillsPage society resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSocietyQuery.select.mockReturnValue(mockSocietyQuery);
    mockSocietyQuery.eq.mockReturnValue(mockSocietyQuery);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'societies') return mockSocietyQuery;
      throw new Error(`Unexpected unscoped preview query for ${table}`);
    });
  });

  it('does not query units or configuration when the society lookup fails', async () => {
    mockSocietySingle.mockResolvedValue({ data: null, error: { message: 'lookup failed' } });

    render(<GenerateBillsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your flats');
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).toHaveBeenCalledWith('societies');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('units');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('society_config');
  });

  it('does not query units or configuration when the society lookup has no ID', async () => {
    mockSocietySingle.mockResolvedValue({ data: null, error: null });

    render(<GenerateBillsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your flats');
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).toHaveBeenCalledWith('societies');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('units');
    expect(mockSupabase.from).not.toHaveBeenCalledWith('society_config');
  });
});
