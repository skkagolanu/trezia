/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OperationsTabs from '@/components/operations/OperationsTabs';
import { DocumentsContent } from '@/components/operations/OperationsContent';
import ExportForm from '@/app/(app)/export/ExportForm';
import type { DocumentItem } from '@/components/operations/types';

jest.mock('next/navigation', () => ({
  usePathname: () => '/s/test-society/operations',
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/components/operations/AttachmentManager', () => ({
  __esModule: true,
  default: ({ canWrite }: { canWrite: boolean }) => <span>{canWrite ? 'Manage file' : 'Published file'}</span>,
}));

const document: DocumentItem = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Society bylaws', category: 'BYLAWS',
  description: 'Rules approved by the association.', document_date: '2026-01-01',
  published_to_residents: true, archived_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

describe('Operations UI boundaries', () => {
  it('shows Residents only the Documents tab', () => {
    const html = renderToStaticMarkup(<OperationsTabs active="documents" resident />);
    expect(html).toContain('Documents');
    expect(html).not.toContain('Vendors &amp; AMCs');
    expect(html).not.toContain('Assets');
  });

  it('keeps published documents read-only for Residents', () => {
    const html = renderToStaticMarkup(<DocumentsContent items={[document]} canWrite={false} resident />);
    expect(html).toContain('Society bylaws');
    expect(html).toContain('Published file');
    expect(html).not.toContain('Add document');
    expect(html).not.toContain('Resident published');
  });

  it('does not offer the administrator manifest to a Treasurer', () => {
    const html = renderToStaticMarkup(<ExportForm canManageBackups={false} />);
    expect(html).not.toContain('Data + artifact manifest');
    expect(html).toContain('Payments CSV');
  });
});
