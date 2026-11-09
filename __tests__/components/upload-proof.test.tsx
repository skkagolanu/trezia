/** @jest-environment jsdom */
// Regression coverage for the OCR-clobber bug: a resident who types an amount
// before choosing their payment screenshot must never have it silently
// replaced once recognition finishes. See src/app/(app)/my-flat/UploadProof.tsx.
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import UploadProof from '@/app/(app)/my-flat/UploadProof';
import PayButtons from '@/app/(app)/my-flat/PayButtons';
import { AccountPaymentAmountProvider } from '@/app/(app)/my-flat/AccountPaymentAmount';
import { extractPaymentFields } from '@/lib/payments/ocr';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock('@/lib/payments/ocr', () => ({ extractPaymentFields: jest.fn() }));
jest.mock('@/lib/society-path', () => ({ societyFetch: jest.fn() }));

function pngFile(name = 'proof.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, { type: 'image/png' });
}

function openForm() {
  fireEvent.click(screen.getByRole('button', { name: /upload proof/i }));
}

const MAY_BILL = {
  id: 'bill-may',
  label: 'May 2026',
  bill_period_year: 2026,
  bill_period_month: 5,
  payable_amount: 14_000,
  amount_settled: 0,
  penalty_amount: 0,
  due_date: '2026-05-10',
};

describe('UploadProof — recognition must never overwrite what the resident typed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Carried over from the previous source-text assertion in upload-proof.test.ts,
  // which pinned the literal expression `setAutofilled(result.amount != null || ...)`
  // and so broke the moment that logic was restructured. Same intent, asserted
  // behaviourally instead: the "we found details" hint must reflect reality.
  it('does not claim it found details when recognition returned nothing', async () => {
    (extractPaymentFields as jest.Mock).mockResolvedValue({
      amount: null, utr: null, paidOn: null, rawText: '',
    });

    render(<UploadProof bills={[]} suggestedAmount={500} />);
    openForm();
    fireEvent.change(screen.getByLabelText(/payment screenshot/i) as HTMLInputElement, {
      target: { files: [pngFile()] },
    });

    await waitFor(() => expect(extractPaymentFields).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/We found some details/i)).not.toBeInTheDocument();
  });

  it('tells the resident to check the details when recognition did find some', async () => {
    (extractPaymentFields as jest.Mock).mockResolvedValue({
      amount: 1500, utr: null, paidOn: null, rawText: '',
    });

    render(<UploadProof bills={[]} suggestedAmount={0} />);
    openForm();
    fireEvent.change(screen.getByLabelText(/payment screenshot/i) as HTMLInputElement, {
      target: { files: [pngFile()] },
    });

    expect(await screen.findByText(/We found some details/i)).toBeInTheDocument();
  });

  it('keeps a resident-typed amount after recognition finds a different one', async () => {
    (extractPaymentFields as jest.Mock).mockResolvedValue({
      amount: 9999, utr: 'UPI/OCR/123', paidOn: '2026-01-05', rawText: '',
    });

    render(<UploadProof bills={[]} suggestedAmount={0} />);
    openForm();

    const amountInput = screen.getByLabelText(/amount paid/i) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: '1234' } });
    expect(amountInput.value).toBe('1234');

    const fileInput = screen.getByLabelText(/payment screenshot/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    await waitFor(() => expect(extractPaymentFields).toHaveBeenCalledTimes(1));
    // Fields the resident did not touch (UTR, date) are still filled in from
    // the screenshot — only the typed field must survive untouched.
    const utrInput = screen.getByLabelText(/utr/i) as HTMLInputElement;
    await waitFor(() => expect(utrInput.value).toBe('UPI/OCR/123'));

    expect(amountInput.value).toBe('1234');
  });

  it('still fills the amount from recognition when the resident has not typed one', async () => {
    (extractPaymentFields as jest.Mock).mockResolvedValue({
      amount: 4500, utr: null, paidOn: null, rawText: '',
    });

    render(<UploadProof bills={[]} suggestedAmount={5000} />);
    openForm();

    const fileInput = screen.getByLabelText(/payment screenshot/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    const amountInput = screen.getByLabelText(/amount paid/i) as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe('4500'));
  });

  it('falls back to the suggested amount when recognition finds nothing and the field is untouched', async () => {
    (extractPaymentFields as jest.Mock).mockResolvedValue({
      amount: null, utr: null, paidOn: null, rawText: '',
    });

    render(<UploadProof bills={[]} suggestedAmount={5000} />);
    openForm();

    const fileInput = screen.getByLabelText(/payment screenshot/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    const amountInput = screen.getByLabelText(/amount paid/i) as HTMLInputElement;
    await waitFor(() => expect(amountInput.value).toBe('5000'));
  });

  it('accepts any positive amount and previews surplus as account credit', () => {
    render(<UploadProof bills={[MAY_BILL]} suggestedAmount={14_000} />);
    openForm();

    const amountInput = screen.getByLabelText(/amount paid/i) as HTMLInputElement;
    expect(amountInput.value).toBe('14000');
    fireEvent.change(amountInput, { target: { value: '15000' } });

    expect(screen.getByText(/₹1,000 left over will be kept as credit/i)).toBeInTheDocument();
  });

  it('carries an edited account payment amount into the proof form', () => {
    render(
      <AccountPaymentAmountProvider initialAmount={15_750}>
        <PayButtons
          suggestedAmount={15_750}
          canPayOnline={false}
          upiLink="upi://pay?pa=society%40example&am=15750.00"
        />
        <UploadProof bills={[MAY_BILL]} suggestedAmount={15_750} />
      </AccountPaymentAmountProvider>,
    );

    fireEvent.change(screen.getByLabelText('Amount to pay'), { target: { value: '15000' } });
    openForm();

    expect(screen.getByLabelText(/amount paid/i)).toHaveValue(15000);
    expect(screen.getByText(/₹1,000 left over will be kept as credit/i)).toBeInTheDocument();
  });

  it('allows a fully paid resident to enter a direct-UPI account prepayment', () => {
    render(
      <AccountPaymentAmountProvider initialAmount={0}>
        <PayButtons
          suggestedAmount={0}
          canPayOnline={false}
          upiLink="upi://pay?pa=society%40example&am=0.00"
        />
      </AccountPaymentAmountProvider>,
    );

    expect(screen.getByLabelText('Amount to pay')).toHaveValue(null);
    expect(screen.getByRole('link', { name: /Pay by UPI/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(screen.getByLabelText('Amount to pay'), { target: { value: '600' } });
    expect(screen.getByRole('link', { name: 'Pay ₹600 by UPI' })).toHaveAttribute('href', expect.stringContaining('am=600.00'));
  });

  it('previews the oldest charge across levy and maintenance ledgers', () => {
    render(<UploadProof
      bills={[MAY_BILL]}
      levies={[{
        id: 'levy-old', levy_label: 'Lift repair levy', outstanding: 1_750,
        created_at: '2026-04-01T00:00:00.000Z',
      }]}
      suggestedAmount={15_750}
    />);
    openForm();

    const preview = screen.getByText('This will cover:').parentElement;
    expect(preview).not.toBeNull();
    const rows = within(preview as HTMLElement).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Lift repair levy — ₹1,750');
    expect(rows[1]).toHaveTextContent('May 2026 maintenance — ₹14,000');
  });

  it('shows a part-settled month by its remaining balance', () => {
    render(<UploadProof bills={[{ ...MAY_BILL, payable_amount: 2_000, amount_settled: 500 }]} suggestedAmount={1_500} />);
    openForm();
    fireEvent.click(screen.getByRole('radio', { name: /chosen maintenance months/i }));

    const monthOption = screen.getByText('May 2026').closest('label');
    expect(monthOption).not.toBeNull();
    expect(within(monthOption as HTMLElement).getByText('₹1,500')).toBeInTheDocument();
    expect(within(monthOption as HTMLElement).queryByText('₹2,000')).not.toBeInTheDocument();
  });

  it('focuses the first field when opened and restores focus to its trigger when cancelled', async () => {
    render(<UploadProof bills={[MAY_BILL]} suggestedAmount={14_000} />);
    const trigger = screen.getByRole('button', { name: /upload proof/i });
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByLabelText(/payment screenshot/i)).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /upload proof/i })).toHaveFocus());
  });

  it('rejects an oversized screenshot before starting recognition', () => {
    (extractPaymentFields as jest.Mock).mockResolvedValue({ amount: null, utr: null, paidOn: null, rawText: '' });
    const oversized = pngFile();
    Object.defineProperty(oversized, 'size', { value: 4 * 1024 * 1024 + 1 });

    render(<UploadProof bills={[MAY_BILL]} suggestedAmount={14_000} />);
    openForm();
    fireEvent.change(screen.getByLabelText(/payment screenshot/i), { target: { files: [oversized] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/no larger than 4 MiB/i);
    expect(extractPaymentFields).not.toHaveBeenCalled();
  });

  it('keeps the form usable when recognition fails', async () => {
    (extractPaymentFields as jest.Mock).mockRejectedValue(new Error('worker unavailable'));
    render(<UploadProof bills={[MAY_BILL]} suggestedAmount={14_000} />);
    openForm();
    fireEvent.change(screen.getByLabelText(/payment screenshot/i), { target: { files: [pngFile()] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/enter the payment details manually/i);
    expect(screen.getByLabelText(/amount paid/i)).toBeEnabled();
  });
});
