import { createServerClient } from '@supabase/ssr';
import { createClient as createRawClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { isDemoSession } from '@/lib/demo/session.server';
import { createServiceClient } from '@/lib/supabase/server';

jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/demo/session.server', () => ({ isDemoSession: jest.fn() }));
jest.mock('@/lib/supabase/mock-client', () => ({ createDemoClient: jest.fn() }));

describe('createServiceClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-from-env';
    (isDemoSession as jest.Mock).mockResolvedValue(false);
  });

  it('uses the raw server-only client without forwarding user cookies', async () => {
    const client = { from: jest.fn() };
    (createRawClient as jest.Mock).mockReturnValue(client);

    await expect(createServiceClient()).resolves.toBe(client);

    expect(createRawClient).toHaveBeenCalledWith(
      'https://project.example.test',
      'service-role-key-from-env',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );
    expect(cookies).not.toHaveBeenCalled();
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
