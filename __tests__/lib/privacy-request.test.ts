import { buildDataAccessRequestMessage, buildConsentWithdrawalMessage } from '@/lib/utils/privacy-request';

describe('buildDataAccessRequestMessage', () => {
  it('includes the flat number and society name', () => {
    const msg = buildDataAccessRequestMessage({ societyName: 'OAK', flatNumber: '204' });
    expect(msg).toContain('Flat 204');
    expect(msg).toContain('OAK');
    expect(msg).toContain('DPDP Act 2023');
  });
});

describe('buildConsentWithdrawalMessage', () => {
  it('includes the flat number and society name', () => {
    const msg = buildConsentWithdrawalMessage({ societyName: 'OAK', flatNumber: '204' });
    expect(msg).toContain('Flat 204');
    expect(msg).toContain('OAK');
    expect(msg).toContain('withdraw my consent');
  });
});
