import { CreateSocietySchema } from '@/lib/validation/schemas';

const valid = {
  name: 'Green Heights', short_name: '', slug: 'green-heights', address: '',
  primary_contact_name: '', contact_phone: '', contact_email: '', bank_name: '',
  bank_account_no: '', bank_ifsc: '', upi_id: '', receipt_prefix: 'GH',
  monthly_maintenance_amount: 2500, maintenance_payment_window_days: 7,
  penalty_rate_percent: 2, units: [{ flat_number: '101' }], initial_admin_emails: [],
};

describe('society creation schema', () => {
  it('accepts neutral configuration and optional detailed flat rows', () => {
    expect(CreateSocietySchema.safeParse({
      ...valid,
      units: [{ flat_number: '101', flat_area_sqft: 1200, monthly_amount: 2500 }],
    }).success).toBe(true);
  });

  it('rejects mutable-looking slugs, duplicate flats, and malformed admin emails', () => {
    expect(CreateSocietySchema.safeParse({ ...valid, slug: 'Green Heights' }).success).toBe(false);
    expect(CreateSocietySchema.safeParse({ ...valid, units: [{ flat_number: '101' }, { flat_number: '101' }] }).success).toBe(false);
    expect(CreateSocietySchema.safeParse({ ...valid, initial_admin_emails: ['bad-email'] }).success).toBe(false);
  });
});
