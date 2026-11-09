import { extractPaymentFields, parsePaymentText } from '@/lib/payments/ocr';
import { contentSecurityPolicy } from '@/lib/security/csp';

jest.mock('tesseract.js', () => ({
  __esModule: true,
  default: { recognize: jest.fn() },
}));

import Tesseract from 'tesseract.js';

const recognizeMock = Tesseract.recognize as jest.Mock;

function makeFile(): File {
  return new File(['x'], 'p.png', { type: 'image/png' });
}

beforeEach(() => {
  recognizeMock.mockReset();
});

describe('extractPaymentFields', () => {
  it('parses a bank acknowledgement whose OCR puts the integer amount before its Rs. label', () => {
    const transactionId = 'OMO2608241703501234567890';
    const text = [
      'PhonePe',
      'Transaction Acknowledgement',
      'Thank you',
      'Transaction',
      `Id ${transactionId}¢`,
      'Transaction Payment Successful',
      'Status',
      'Amount 3053',
      'Paid (Rs.)',
      'Bank OMO2608241704071234567890',
      'Reference',
      'Number',
      'Transaction 24/08/2026',
      'Date',
    ].join('\n');

    expect(parsePaymentText(text)).toMatchObject({
      amount: 3053,
      utr: transactionId,
      paidOn: '2026-08-24',
    });
  });

  it('parses a GPay-style screenshot (currency amount, bare 12-digit UTR fallback, "dd Mon yyyy" date)', async () => {
    recognizeMock.mockResolvedValue({
      data: {
        text: 'Google Pay\nPayment successful\n₹2,000\nUPI Ref No. 123456789012\n15 Jul 2026',
      },
    });

    const result = await extractPaymentFields(makeFile());

    expect(result.amount).toBe(2000);
    expect(result.utr).toBe('123456789012');
    expect(result.paidOn).toBe('2026-07-15');
    expect(result.rawText).toContain('Google Pay');
  });

  it('parses a PhonePe-style screenshot (decimal currency amount, keyword-anchored UTR, dd/mm/yyyy date)', async () => {
    recognizeMock.mockResolvedValue({
      data: {
        text: 'PhonePe\nPaid ₹1,234.56\nTxn: T25061540213\n21/07/2026',
      },
    });

    const result = await extractPaymentFields(makeFile());

    expect(result.amount).toBe(1234.56);
    expect(result.utr).toBe('T25061540213');
    expect(result.paidOn).toBe('2026-07-21');
  });

  it('parses a bare decimal amount and a keyword-anchored UTR with no currency symbol', async () => {
    recognizeMock.mockResolvedValue({
      data: { text: '2500.00\nUTR 123456789012' },
    });

    const result = await extractPaymentFields(makeFile());

    expect(result.amount).toBe(2500);
    expect(result.utr).toBe('123456789012');
    expect(result.paidOn).toBeNull();
  });

  it('does not mistake the words after a keyword for a reference ("Transaction Successful")', async () => {
    recognizeMock.mockResolvedValue({
      data: { text: 'Paytm\nTransaction Successful\n₹10,000\n23 Aug 2026' },
    });

    const result = await extractPaymentFields(makeFile());

    expect(result.utr).toBeNull();
    expect(result.amount).toBe(10000);
    expect(result.paidOn).toBe('2026-08-23');
  });

  it('rejects every alphabetic status word a UPI screenshot puts next to a keyword', async () => {
    const words = ['Successful', 'Completed', 'Processing', 'Pending', 'Failed', 'Cancelled', 'Reference'];
    for (const word of words) {
      recognizeMock.mockResolvedValue({ data: { text: `UPI Transaction ${word}` } });
      await expect(extractPaymentFields(makeFile())).resolves.toMatchObject({ utr: null });
    }
  });

  it('rejects status tokens even when OCR joins them to a year', async () => {
    recognizeMock.mockResolvedValue({ data: { text: 'UPI Transaction SUCCESS2026' } });

    await expect(extractPaymentFields(makeFile())).resolves.toMatchObject({ utr: null });
  });

  it('accepts a labelled alphanumeric UPI transaction ID up to the documented 35-character limit', async () => {
    const transactionId = 'NPCIABCDEFGHIJKLMNOPQRSTUVWXY123456';
    expect(transactionId).toHaveLength(35);
    recognizeMock.mockResolvedValue({ data: { text: `UPI transaction ID ${transactionId}` } });

    await expect(extractPaymentFields(makeFile())).resolves.toMatchObject({ utr: transactionId });
  });

  it('reads a reference printed on the line below its label', async () => {
    recognizeMock.mockResolvedValue({
      data: { text: 'Payment Successful\nUPI transaction ID\n432112345678\n₹2,000' },
    });

    await expect(extractPaymentFields(makeFile())).resolves.toMatchObject({ utr: '432112345678' });
  });

  it('does not read an amount out of the "rs" inside an ordinary word', async () => {
    recognizeMock.mockResolvedValue({ data: { text: 'Yours 12 sincerely' } });

    await expect(extractPaymentFields(makeFile())).resolves.toMatchObject({ amount: null });
  });

  it('prefers the paid amount over cashback and fees', () => {
    expect(parsePaymentText([
      'Cashback earned ₹50',
      'Convenience fee ₹2.00',
      'Amount paid ₹14,600.00',
      'Transaction ID 123456789012',
    ].join('\n')).amount).toBe(14_600);
  });

  it('prefers the transaction date over invoice and due dates', () => {
    expect(parsePaymentText([
      'Invoice date 01/08/2026',
      'Due date 10/08/2026',
      'Payment completed',
      'Transaction date 24/08/2026',
    ].join('\n')).paidOn).toBe('2026-08-24');
  });

  it('leaves equally credible conflicting amounts blank instead of guessing', () => {
    expect(parsePaymentText('₹1,000.00\n₹2,000.00').amount).toBeNull();
  });

  it('returns all nulls but keeps rawText for garbage text with no numbers, and does not throw', async () => {
    const text = 'Thank you for using our app. Have a nice day.';
    recognizeMock.mockResolvedValue({ data: { text } });

    const result = await extractPaymentFields(makeFile());

    expect(result.amount).toBeNull();
    expect(result.utr).toBeNull();
    expect(result.paidOn).toBeNull();
    expect(result.rawText).toBe(text);
  });

  it('returns an all-null empty result and does not throw when tesseract.recognize rejects', async () => {
    recognizeMock.mockRejectedValue(new Error('worker init failed'));

    await expect(extractPaymentFields(makeFile())).resolves.toEqual({
      amount: null,
      utr: null,
      paidOn: null,
      rawText: '',
    });
  });

  it('loads every engine asset from a same-origin path so the production CSP does not block OCR', async () => {
    recognizeMock.mockResolvedValue({ data: { text: '' } });

    await extractPaymentFields(makeFile());

    const options = recognizeMock.mock.calls[0][2];
    expect(options.workerBlobURL).toBe(false);

    for (const key of ['workerPath', 'corePath', 'langPath'] as const) {
      expect(options[key]).toEqual(expect.any(String));
      expect(options[key]).toMatch(/^\/tesseract\//);
      expect(options[key]).not.toMatch(/^https?:/);
    }
  });
});

// The other way recognition dies silently. ocr.ts swallows every error, so a
// policy that blocks the worker, the wasm compile or the language fetch shows a
// progress bar and then pre-fills nothing — with nothing logged. Development
// adds 'unsafe-eval', which masks exactly the failure production enforces, so
// these assert the PRODUCTION policy.
describe('the production CSP permits the self-hosted recognition path', () => {
  const directives = (policy: string) => new Map(
    policy.split(';').map(part => part.trim()).filter(Boolean).map(part => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values];
    }),
  );

  const production = directives(contentSecurityPolicy(false));

  it("allows the worker from this origin, and not from blob: — matching workerBlobURL: false", () => {
    expect(production.get('worker-src')).toEqual(["'self'"]);
  });

  it("carries 'wasm-unsafe-eval' so the core can instantiate", () => {
    expect(production.get('script-src')).toContain("'wasm-unsafe-eval'");
  });

  it("does not carry 'unsafe-eval' in production, which would hide this failure", () => {
    expect(production.get('script-src')).not.toContain("'unsafe-eval'");
    expect(directives(contentSecurityPolicy(true)).get('script-src')).toContain("'unsafe-eval'");
  });

  it('allows same-origin script and fetch for the core and the language model', () => {
    expect(production.get('default-src')).toEqual(["'self'"]);
    expect(production.get('script-src')).toContain("'self'");
    expect(production.get('connect-src')).toContain("'self'");
    // Demo mode strips third-party origins but must keep 'self'.
    expect(directives(contentSecurityPolicy(false, true)).get('connect-src')).toEqual(["'self'"]);
  });
});
