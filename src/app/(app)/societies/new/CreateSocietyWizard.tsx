'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { CreateSocietySchema } from '@/lib/validation/schemas';
import { generateFlatNumbers, normalizeAdminEmails, parseUnitDrafts } from '@/lib/societies/wizard';

type CreationResult = { id: string; slug: string; admin_authorizations: string[] };
const STEPS = ['Identity', 'Billing', 'Flats', 'Admins', 'Review'];

export default function CreateSocietyWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', short_name: '', slug: '', address: '', primary_contact_name: '', contact_phone: '', contact_email: '',
    bank_name: '', bank_account_no: '', bank_ifsc: '', upi_id: '', receipt_prefix: 'REC',
    monthly_maintenance_amount: 2000, maintenance_payment_window_days: 7, penalty_rate_percent: 0,
  });
  const [flatText, setFlatText] = useState('');
  const [adminText, setAdminText] = useState('');
  const [generator, setGenerator] = useState({ floors: 5, firstFloor: 1, perFloor: 10, prefix: '', pattern: 'floor-unit' as 'floor-unit' | 'sequential' });
  const [created, setCreated] = useState<CreationResult | null>(null);
  const units = useMemo(() => parseUnitDrafts(flatText), [flatText]);
  const adminEmails = useMemo(() => normalizeAdminEmails(adminText), [adminText]);

  function set(name: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(previous => ({ ...previous, [name]: event.target.type === 'number' ? Number(event.target.value) : event.target.value }));
  }

  function generateFlats() {
    try {
      setFlatText(generateFlatNumbers(generator).join('\n'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Review the flat generator');
    }
  }

  function continueToNextStep() {
    if (step === 0 && (form.name.trim().length < 2 || !/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(form.slug))) {
      return toast.error('Enter a society name and a valid lowercase URL slug');
    }
    if (step === 1 && (!/^[A-Za-z0-9-]{2,20}$/.test(form.receipt_prefix) || form.monthly_maintenance_amount < 0 || form.maintenance_payment_window_days < 1 || form.maintenance_payment_window_days > 365 || form.penalty_rate_percent < 0 || form.penalty_rate_percent > 100)) {
      return toast.error('Review the billing defaults and receipt prefix');
    }
    if (step === 2 && units.length === 0) return toast.error('Add at least one flat');
    if (step === 3 && adminEmails.some(value => !/^\S+@\S+\.\S+$/.test(value))) return toast.error('Review the Admin email addresses');
    setStep(value => value + 1);
  }

  async function create() {
    const payload = { ...form, units, initial_admin_emails: adminEmails };
    const parsed = CreateSocietySchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Review the society details');
      return;
    }
    setSaving(true);
    const response = await fetch('/api/platform/societies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast.error(body.error ?? 'Could not create society');
    toast.success('Society created');
    setCreated(body as CreationResult);
  }

  if (created) return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-black/[0.07] bg-sf-surface p-6">
      <h2 className="text-lg font-semibold text-sf-label">Society created</h2>
      <p className="mt-2 text-sm text-sf-label2">The society has empty books and is ready for configuration at <strong>/s/{created.slug}</strong>.</p>
      <div className="mt-5 rounded-[10px] bg-sf-bg p-4">
        <p className="text-sm font-medium text-sf-label">Admin login instructions</p>
        <p className="mt-1 text-xs text-sf-label3">No email was sent. Ask each authorized Admin to open <strong>/login</strong> and request a magic link with the exact address below.</p>
        {created.admin_authorizations.length === 0 ? <p className="mt-3 text-sm text-sf-label3">No additional Admins were authorized.</p> : <ul className="mt-3 space-y-1 text-sm text-sf-label2">{created.admin_authorizations.map(email => <li key={email}>{email}</li>)}</ul>}
      </div>
      <div className="mt-5 flex justify-end"><button onClick={() => router.push(`/s/${created.slug}/settings`)} className="rounded-[9px] bg-sf-blue px-4 py-2 text-sm font-semibold text-white">Open society settings</button></div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-black/[0.07] bg-sf-surface p-6">
      <div className="mb-6 flex gap-2 overflow-x-auto">{STEPS.map((label, index) => <span key={label} aria-current={index === step ? 'step' : undefined} className={`rounded-full px-3 py-1 text-xs font-medium ${index === step ? 'bg-sf-blue text-white' : 'bg-sf-bg text-sf-label3'}`}>{index + 1}. {label}</span>)}</div>
      {step === 0 && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Society name"><input value={form.name} onChange={set('name')} /></Field>
        <Field label="Short name"><input value={form.short_name} onChange={set('short_name')} /></Field>
        <Field label="URL slug"><input value={form.slug} onChange={set('slug')} placeholder="demo-apartments" /></Field>
        <Field label="Primary contact"><input value={form.primary_contact_name} onChange={set('primary_contact_name')} /></Field>
        <Field label="Contact phone"><input value={form.contact_phone} onChange={set('contact_phone')} /></Field>
        <Field label="Contact email"><input type="email" value={form.contact_email} onChange={set('contact_email')} /></Field>
        <Field label="Address" wide><textarea value={form.address} onChange={set('address')} rows={3} /></Field>
        <p className="sm:col-span-2 text-xs text-sf-label3">Financial year: April–March</p>
      </div>}
      {step === 1 && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monthly maintenance"><input type="number" value={form.monthly_maintenance_amount} onChange={set('monthly_maintenance_amount')} /></Field>
        <Field label="Payment window (days)"><input type="number" value={form.maintenance_payment_window_days} onChange={set('maintenance_payment_window_days')} /></Field>
        <Field label="Penalty rate %"><input type="number" value={form.penalty_rate_percent} onChange={set('penalty_rate_percent')} /></Field>
        <Field label="Receipt prefix"><input value={form.receipt_prefix} onChange={set('receipt_prefix')} /></Field>
        <Field label="Bank name"><input value={form.bank_name} onChange={set('bank_name')} /></Field>
        <Field label="Account number"><input value={form.bank_account_no} onChange={set('bank_account_no')} /></Field>
        <Field label="IFSC"><input value={form.bank_ifsc} onChange={set('bank_ifsc')} /></Field>
        <Field label="UPI ID"><input value={form.upi_id} onChange={set('upi_id')} /></Field>
      </div>}
      {step === 2 && <div className="space-y-4"><div className="rounded-[12px] border border-sf-border bg-sf-bg p-4"><div className="grid gap-3 sm:grid-cols-5"><Field label="Floors"><input type="number" min={1} value={generator.floors} onChange={event => setGenerator(value => ({ ...value, floors: Number(event.target.value) }))} /></Field><Field label="First floor"><input type="number" value={generator.firstFloor} onChange={event => setGenerator(value => ({ ...value, firstFloor: Number(event.target.value) }))} /></Field><Field label="Flats/floor"><input type="number" min={1} value={generator.perFloor} onChange={event => setGenerator(value => ({ ...value, perFloor: Number(event.target.value) }))} /></Field><Field label="Prefix"><input value={generator.prefix} onChange={event => setGenerator(value => ({ ...value, prefix: event.target.value }))} placeholder="A-" /></Field><Field label="Pattern"><select value={generator.pattern} onChange={event => setGenerator(value => ({ ...value, pattern: event.target.value as 'floor-unit' | 'sequential' }))}><option value="floor-unit">Floor + unit</option><option value="sequential">Sequential</option></select></Field></div><div className="mt-3 flex items-center justify-between"><p className="text-xs text-sf-label3">Preview: {generator.prefix}{generator.pattern === 'floor-unit' ? `${generator.firstFloor}01` : '001'} · up to {generator.floors * generator.perFloor} flats</p><button type="button" onClick={generateFlats} className="text-sm font-medium text-sf-blue">Generate flats</button></div></div><div><p className="text-sm text-sf-label2">Paste comma-separated flat numbers, or use one row per flat.</p><p className="text-xs text-sf-label3">Optional row format: flat number | area sq ft | monthly amount</p></div><textarea className="min-h-64 w-full rounded-[10px] border border-sf-border bg-sf-bg p-3 font-mono text-sm" value={flatText} onChange={e => setFlatText(e.target.value)} placeholder={'101 | 1200 | 2500\n102 | 1150 | 2500'} /><p className="text-xs text-sf-label3">{units.length} unique flats</p></div>}
      {step === 3 && <div><p className="mb-2 text-sm text-sf-label2">Optional Admin emails. No email is sent; share the login URL after creation.</p><textarea className="min-h-48 w-full rounded-[10px] border border-sf-border bg-sf-bg p-3 text-sm" value={adminText} onChange={e => setAdminText(e.target.value)} placeholder="admin@example.com" /></div>}
      {step === 4 && <div className="space-y-3 text-sm text-sf-label2"><p><strong className="text-sf-label">{form.name}</strong> · /s/{form.slug}</p><p>{units.length} flats · {adminEmails.length} additional Admin authorizations</p><p>₹{form.monthly_maintenance_amount.toLocaleString('en-IN')} monthly · {form.maintenance_payment_window_days}-day window · {form.penalty_rate_percent}% penalty</p><p>No residents, AMC, or financial records will be copied.</p></div>}
      <div className="mt-7 flex justify-between border-t border-sf-divider pt-4"><button type="button" disabled={step === 0 || saving} onClick={() => setStep(value => value - 1)} className="rounded-[9px] border border-sf-border px-4 py-2 text-sm disabled:opacity-30">Back</button>{step < 4 ? <button type="button" onClick={continueToNextStep} className="rounded-[9px] bg-sf-blue px-4 py-2 text-sm font-semibold text-white">Continue</button> : <button type="button" disabled={saving} onClick={() => void create()} className="rounded-[9px] bg-sf-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create Society'}</button>}</div>
    </div>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactElement<{ className?: string }> }) {
  return <label className={wide ? 'sm:col-span-2' : ''}><span className="mb-1.5 block text-sm font-medium text-sf-label">{label}</span>{children && <div className="[&>*]:w-full [&>*]:rounded-[10px] [&>*]:border [&>*]:border-sf-border [&>*]:bg-sf-bg [&>*]:px-3 [&>*]:py-2 [&>*]:text-sm">{children}</div>}</label>;
}
