'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type AccountPaymentAmountValue = {
  amount: string;
  setAmount: (amount: string) => void;
};

const AccountPaymentAmountContext = createContext<AccountPaymentAmountValue | null>(null);

export function AccountPaymentAmountProvider({
  initialAmount,
  children,
}: {
  initialAmount: number;
  children: ReactNode;
}) {
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '');
  const value = useMemo(() => ({ amount, setAmount }), [amount]);

  return (
    <AccountPaymentAmountContext.Provider value={value}>
      {children}
    </AccountPaymentAmountContext.Provider>
  );
}

export function useAccountPaymentAmount(): AccountPaymentAmountValue | null {
  return useContext(AccountPaymentAmountContext);
}
