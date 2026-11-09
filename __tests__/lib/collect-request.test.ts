import { buildCollectMessage, buildUpiLink, buildWhatsAppLink } from '@/lib/utils/collect-request';

describe('buildCollectMessage', () => {
  it('uses the resident name when present', () => {
    const msg = buildCollectMessage({ societyName: 'Demo Apartments', flatNumber: '204', residentName: 'Priya Sharma', amount: 4000, monthsOwed: 2 });
    expect(msg).toContain('Dear Priya Sharma,');
    expect(msg).toContain('Flat 204');
    expect(msg).toContain('₹4,000');
    expect(msg).toContain('2 months');
  });

  it('falls back to a generic greeting without a resident name', () => {
    const msg = buildCollectMessage({ societyName: 'Demo Apartments', flatNumber: '101', residentName: null, amount: 2000, monthsOwed: 1 });
    expect(msg).toContain('Dear Resident,');
  });

  it('singularises "1 month"', () => {
    const msg = buildCollectMessage({ societyName: 'Demo Apartments', flatNumber: '101', residentName: 'X', amount: 2000, monthsOwed: 1 });
    expect(msg).toContain('1 month outstanding');
    expect(msg).not.toContain('1 months');
  });
});

describe('buildWhatsAppLink', () => {
  it('prefixes the India country code and strips non-digits', () => {
    const link = buildWhatsAppLink('98765 43210', 'hello');
    expect(link).toBe('https://wa.me/919876543210?text=hello');
  });

  it('URL-encodes the message', () => {
    const link = buildWhatsAppLink('9876543210', '₹2,000 due & payable');
    expect(link).toContain(encodeURIComponent('₹2,000 due & payable'));
  });
});

describe('buildUpiLink', () => {
  it('builds a upi://pay deep link with all fields', () => {
    const link = buildUpiLink({ vpa: 'society@upi', payeeName: 'Demo Apartments', amount: 4000, note: 'Maintenance dues' });
    expect(link).toBe('upi://pay?pa=society%40upi&pn=Demo+Apartments&am=4000.00&cu=INR&tn=Maintenance+dues');
  });

  it('returns null when no VPA is configured', () => {
    expect(buildUpiLink({ vpa: null, payeeName: 'Demo Apartments', amount: 100, note: 'x' })).toBeNull();
  });

  it('formats the amount with 2 decimal places', () => {
    const link = buildUpiLink({ vpa: 'a@b', payeeName: 'X', amount: 1999.5, note: 'n' });
    expect(link).toContain('am=1999.50');
  });
});
