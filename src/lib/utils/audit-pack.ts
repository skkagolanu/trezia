// Income/expenditure and equity calculations for the audit pack.
// Income is recognized from bills; expenses are recognized when paid.

export interface IncomeExpenditureInput {
  /** Maintenance billed (not collected) for the FY — sum of bills.payable_amount, all statuses. */
  maintenanceAccrued: number;
  /** Cash-basis: other income received in the FY. */
  otherIncomeTotal: number;
  /** Cash-basis: AMC/levies collected in the FY. */
  amcTotal: number;
  /** Cash-basis: expenses paid in the FY (no payables tracked). */
  expenseTotal: number;
}

export interface IncomeExpenditure {
  totalIncome: number;
  totalExpenditure: number;
  /** Positive = surplus, negative = deficit. */
  surplusOrDeficit: number;
}

export function computeIncomeExpenditure(input: IncomeExpenditureInput): IncomeExpenditure {
  const totalIncome = input.maintenanceAccrued + input.otherIncomeTotal + input.amcTotal;
  const totalExpenditure = input.expenseTotal;
  return { totalIncome, totalExpenditure, surplusOrDeficit: totalIncome - totalExpenditure };
}

export interface BalanceSheetEquityInput {
  /** Bank + cash, from the latest recorded snapshot as on the FY end. */
  bankCash: number;
  /** Outstanding maintenance dues as on the FY end (current-month billing rule). */
  receivables: number;
  /** Lifetime CORPUS_FUND income minus lifetime CORPUS_FUND_PAYMENT expense, as on the FY end. */
  corpusFund: number;
}

export interface BalanceSheetEquity {
  totalAssets: number;
  /** Always 0 — no accounts-payable ledger exists yet. */
  totalLiabilities: number;
  corpusFund: number;
  /** Assets remaining after liabilities and corpus are accounted for. */
  reserveAndSurplus: number;
  /** Equal to totalAssets by construction — the statement balances. */
  totalEquityAndLiabilities: number;
}

export function computeBalanceSheetEquity(input: BalanceSheetEquityInput): BalanceSheetEquity {
  const totalAssets = input.bankCash + input.receivables;
  const totalLiabilities = 0;
  const reserveAndSurplus = totalAssets - totalLiabilities - input.corpusFund;
  return {
    totalAssets,
    totalLiabilities,
    corpusFund: input.corpusFund,
    reserveAndSurplus,
    totalEquityAndLiabilities: totalLiabilities + input.corpusFund + reserveAndSurplus,
  };
}
