'use client';

import { createContext, useContext } from 'react';

export type SocietyRuntime = {
  societySlug: string | null;
  societyStatus: 'active' | 'suspended';
  canWrite: boolean;
};

const SocietyRuntimeContext = createContext<SocietyRuntime>({
  societySlug: null,
  societyStatus: 'active',
  canWrite: true,
});

export function SocietyRuntimeProvider({
  value,
  children,
}: {
  value: SocietyRuntime;
  children: React.ReactNode;
}) {
  return (
    <SocietyRuntimeContext.Provider value={value}>
      <div className="contents" data-society-status={value.societyStatus}>{children}</div>
    </SocietyRuntimeContext.Provider>
  );
}

export function useSocietyRuntime(): SocietyRuntime {
  return useContext(SocietyRuntimeContext);
}
