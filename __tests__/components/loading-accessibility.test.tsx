/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Loading from '@/app/(app)/loading';
import UploadProof from '@/app/(app)/my-flat/UploadProof';
import { extractPaymentFields } from '@/lib/payments/ocr';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock('@/lib/payments/ocr', () => ({ extractPaymentFields: jest.fn() }));
jest.mock('@/lib/society-path', () => ({ societyFetch: jest.fn() }));

function pngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'proof.png', { type: 'image/png' });
}

describe('loading accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('announces app loading while hiding reduced-motion skeletons from assistive technology', () => {
    const { container } = render(<Loading />);

    expect(screen.getByRole('status', { name: 'Loading page content' })).toHaveAttribute('aria-busy', 'true');
    const skeleton = container.querySelector('[aria-hidden="true"] .animate-pulse');
    expect(skeleton).toHaveClass('motion-reduce:animate-none');
  });

  it.each([
    ['payment proof', <UploadProof key="payment" bills={[]} suggestedAmount={0} />, /upload proof/i],
  ])('announces %s recognition and reduces spinner motion', (_name, component, openButton) => {
    (extractPaymentFields as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const { container } = render(component);

    fireEvent.click(screen.getByRole('button', { name: openButton }));
    fireEvent.change(screen.getByLabelText('Payment screenshot'), { target: { files: [pngFile()] } });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/reading your screenshot/i);
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveClass('motion-reduce:animate-none');
  });
});
