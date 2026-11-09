'use client';
import { societyFetch } from '@/lib/society-path';
import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { ResidentSchema } from '@/lib/validation/schemas';
import type { Resident } from '@/types/database';

interface Props {
  open: boolean;
  onClose: () => void;
  unitId?: string;
  onSuccess: () => void;
  existingResident?: Resident;
  unitOptions?: Array<{ id: string; flat_number: string }>;
}

type FieldErrors = Partial<Record<string, string>>;

const OCCUPANCY_OPTIONS = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'TENANT', label: 'Tenant' },
  { value: 'VACANT', label: 'Vacant' },
];

const NOTIFICATION_OPTIONS = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'NONE', label: 'None' },
];

function buildInitialState(existing?: Resident) {
  return {
    full_name: existing?.full_name ?? '',
    occupancy_type: existing?.occupancy_type ?? 'OWNER',
    phone: existing?.phone ?? '',
    email: existing?.email ?? '',
    notification_channel: existing?.notification_channel ?? 'EMAIL',
    is_primary: existing?.is_primary ?? true,
    move_in_date: existing?.move_in_date ?? '',
    notes: existing?.notes ?? '',
    consent_given: existing?.consent_given ?? false,
  };
}

export default function ResidentFormModal({
  open,
  onClose,
  unitId,
  onSuccess,
  existingResident,
  unitOptions = [],
}: Props) {
  const isEdit = Boolean(existingResident);
  const initialUnitId = unitId ?? existingResident?.unit_id ?? '';

  const [form, setForm] = useState(buildInitialState(existingResident));
  const [selectedUnitId, setSelectedUnitId] = useState(initialUnitId);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(existingResident));
      setSelectedUnitId(initialUnitId);
      setErrors({});
      setServerError('');
    }
  }, [open, existingResident, initialUnitId]);

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError('');

    const parsed = ResidentSchema.safeParse({
      ...form,
      unit_id: selectedUnitId,
      phone: form.phone || undefined,
      email: form.email || undefined,
      move_in_date: form.move_in_date || undefined,
      notes: form.notes || undefined,
    });

    if (!parsed.success) {
      const fieldErrs: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString();
        if (key) fieldErrs[key] = issue.message;
      }
      setErrors(fieldErrs);
      return;
    }

    setLoading(true);
    try {
      const body = isEdit
        ? { ...parsed.data, id: existingResident!.id }
        : parsed.data;

      const res = await societyFetch('/api/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setServerError(json.error ?? 'Something went wrong. Please try again.');
        return;
      }

      onSuccess();
    } catch {
      setServerError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Resident' : 'Add Resident'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!unitId && !existingResident && (
          <Select
            label="Flat"
            value={selectedUnitId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedUnitId(e.target.value)}
            options={unitOptions.map(unit => ({ value: unit.id, label: unit.flat_number }))}
            placeholder="Select flat…"
            error={errors.unit_id}
            required
          />
        )}

        <Input
          label="Full Name"
          value={form.full_name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('full_name', e.target.value)}
          error={errors.full_name}
          required
          autoFocus
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Occupancy Type"
            value={form.occupancy_type}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('occupancy_type', e.target.value as typeof form.occupancy_type)}
            options={OCCUPANCY_OPTIONS}
            error={errors.occupancy_type}
          />

          <Select
            label="Notification Channel"
            value={form.notification_channel}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set('notification_channel', e.target.value as typeof form.notification_channel)}
            options={NOTIFICATION_OPTIONS}
            error={errors.notification_channel}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('phone', e.target.value)}
            error={errors.phone}
            placeholder="10-digit mobile number"
            hint="Indian mobile number (6–9 followed by 9 digits)"
          />

          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('email', e.target.value)}
            error={errors.email}
            placeholder="resident@example.com"
          />
        </div>

        <Input
          label="Move-in Date"
          type="date"
          value={form.move_in_date}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('move_in_date', e.target.value)}
          error={errors.move_in_date}
        />

        <Input
          label="Notes"
          value={form.notes}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('notes', e.target.value)}
          error={errors.notes}
          placeholder="Optional notes"
        />

        <div className="flex items-center gap-3">
          <input
            id="is_primary"
            type="checkbox"
            checked={form.is_primary}
            onChange={(e) => set('is_primary', e.target.checked)}
            className="h-4 w-4 rounded border-black/[0.25] accent-[var(--sf-blue)]"
          />
          <label htmlFor="is_primary" className="text-[14px] font-medium text-sf-label">
            Primary resident for this flat
          </label>
        </div>

        <div className="rounded-[10px] border border-sf-orange/[0.25] bg-sf-orange/[0.07] p-4">
          <div className="flex gap-3">
            <input
              id="consent_given"
              type="checkbox"
              checked={form.consent_given}
              onChange={(e) => set('consent_given', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-black/[0.25] accent-[var(--sf-blue)]"
            />
            <label htmlFor="consent_given" className="text-[13px] text-sf-label2">
              <span className="font-medium text-sf-label">DPDP Consent: </span>
              The resident has been informed that their personal data (name, phone, email) will be
              stored and used for society communication purposes under the Digital Personal Data
              Protection Act, 2023, and has provided consent.
            </label>
          </div>
          {errors.consent_given && (
            <p className="mt-1 text-[12px] text-sf-red">{errors.consent_given}</p>
          )}
        </div>

        {serverError && (
          <p className="rounded-[10px] border border-sf-red/[0.25] bg-sf-red/[0.07] px-3 py-2 text-[14px] text-sf-red">
            {serverError}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Save Changes' : 'Add Resident'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
