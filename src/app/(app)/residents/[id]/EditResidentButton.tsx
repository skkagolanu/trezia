'use client';
import { useState } from 'react';
import ResidentFormModal from '@/components/payments/ResidentFormModal';
import Button from '@/components/ui/Button';
import type { Resident } from '@/types/database';

interface Props {
  unitId: string;
  resident: Resident;
}

export default function EditResidentButton({ unitId, resident }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button data-society-write variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <ResidentFormModal
        open={open}
        onClose={() => setOpen(false)}
        unitId={unitId}
        existingResident={resident}
        onSuccess={() => {
          setOpen(false);
          window.location.reload();
        }}
      />
    </>
  );
}
