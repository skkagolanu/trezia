import { parseCsv } from '@/lib/imports/csv';
import { validateStage } from '@/lib/imports/validate';
import { templateHeader, STAGE_DEFS } from '@/lib/imports/stages';

function run(stage: Parameters<typeof validateStage>[0], csv: string) {
  return validateStage(stage, parseCsv(csv));
}

describe('validateStage — headers', () => {
  it('flags duplicate headers', () => {
    const v = run('flats', 'flat_number,flat_number\nA,B');
    expect(v.headerErrors.some(e => e.includes('Duplicate'))).toBe(true);
  });

  it('flags a missing required column', () => {
    const v = run('residents', 'full_name\nAnita');
    expect(v.headerErrors.some(e => e.includes('flat_number'))).toBe(true);
  });
});

describe('validateStage — cells', () => {
  it('accepts a clean flats row', () => {
    const v = run('flats', 'flat_number,flat_area_sqft,monthly_amount,notes\nA-101,850,2500,');
    expect(v.errorCount).toBe(0);
    expect(v.validCount).toBe(1);
    expect(v.rows[0].values.flat_area_sqft).toBe(850);
  });

  it('rejects a required missing value', () => {
    const v = run('flats', 'flat_number,monthly_amount\n,2500');
    expect(v.rows[0].errors[0].column).toBe('flat_number');
  });

  it('rejects a non-numeric amount and a negative amount', () => {
    const bad = run('expenses', 'expense_date,category,description,amount\n2025-04-01,MISC,x,abc');
    expect(bad.rows[0].errors.some(e => e.column === 'amount')).toBe(true);
    const neg = run('expenses', 'expense_date,category,description,amount\n2025-04-01,MISC,x,-5');
    expect(neg.rows[0].errors.some(e => e.column === 'amount')).toBe(true);
  });

  it('rejects an invalid enum but accepts case-insensitive canonical', () => {
    const bad = run('expenses', 'expense_date,category,description,amount\n2025-04-01,NOPE,x,10');
    expect(bad.rows[0].errors.some(e => e.column === 'category')).toBe(true);
    const ok = run('expenses', 'expense_date,category,description,amount\n2025-04-01,electricity,x,10');
    expect(ok.errorCount).toBe(0);
    expect(ok.rows[0].values.category).toBe('ELECTRICITY');
  });

  it('parses ISO and DD/MM/YYYY dates, rejects impossible ones', () => {
    const iso = run('expenses', 'expense_date,category,description,amount\n2025-04-15,MISC,x,10');
    expect(iso.rows[0].values.expense_date).toBe('2025-04-15');
    const dmy = run('expenses', 'expense_date,category,description,amount\n15/04/2025,MISC,x,10');
    expect(dmy.rows[0].values.expense_date).toBe('2025-04-15');
    const bad = run('expenses', 'expense_date,category,description,amount\n2025-02-30,MISC,x,10');
    expect(bad.rows[0].errors.some(e => e.column === 'expense_date')).toBe(true);
  });

  it('bounds the bill month to 1..12', () => {
    const header = templateHeader('bills').join(',');
    const good = run('bills', `${header}\nA-101,2025,4,INV-1,2025-04-01,2025-04-10,2500,0,0,ISSUED`);
    expect(good.errorCount).toBe(0);
    const bad = run('bills', `${header}\nA-101,2025,13,INV-1,2025-04-01,2025-04-10,2500,0,0,ISSUED`);
    expect(bad.rows[0].errors.some(e => e.column === 'bill_period_month')).toBe(true);
  });

  it('coerces booleans in the residents stage', () => {
    const header = templateHeader('residents').join(',');
    const v = run('residents', `${header}\nA-101,Anita,OWNER,,,yes,true`);
    expect(v.rows[0].values.is_primary).toBe(true);
    expect(v.rows[0].values.is_active).toBe(true);
  });
});

describe('stage template headers match the column contract', () => {
  it('every stage template lists its column keys in order', () => {
    for (const stage of Object.keys(STAGE_DEFS) as Array<keyof typeof STAGE_DEFS>) {
      expect(templateHeader(stage)).toEqual(STAGE_DEFS[stage].columns.map(c => c.key));
    }
  });
});
