/** @jest-environment jsdom */
import { createBrowserClient } from '@supabase/ssr';
import { createDemoClient } from '@/lib/supabase/mock-client';
import { createClient } from '@/lib/supabase/client';

jest.mock('@supabase/ssr', () => ({ createBrowserClient: jest.fn() }));
jest.mock('@/lib/supabase/mock-client', () => ({ createDemoClient: jest.fn(() => ({ fixture: true })) }));

describe('browser demo client boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = 'trezia_demo=; path=/; max-age=0';
  });

  it('returns the in-memory fixture client without constructing Supabase', () => {
    document.cookie = 'trezia_demo=1; path=/';
    expect(createClient()).toEqual({ fixture: true });
    expect(createDemoClient).toHaveBeenCalledTimes(1);
    expect(createBrowserClient).not.toHaveBeenCalled();
  });
});
