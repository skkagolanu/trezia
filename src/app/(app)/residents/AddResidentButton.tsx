'use client';
import { useState } from 'react';
import ResidentFormModal from '@/components/payments/ResidentFormModal';
import Button from '@/components/ui/Button';

interface Props {
  units?: Array<{ id: string; flat_number: string }>;
  unitId?: string;
}

export default function AddResidentButton({ units = [], unitId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button data-society-write onClick={() => setOpen(true)}>+ Add Resident</Button>
      <ResidentFormModal
        open={open}
        onClose={() => setOpen(false)}
        unitId={unitId}
        unitOptions={units}
        onSuccess={() => {
          setOpen(false);
          window.location.reload();
        }}
      />
    </>
  );
}
