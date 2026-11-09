import type { ExpenseCategory, IncomeCategory } from '@/types/database';

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  SECURITY_AGENCY:     'Security Agency',
  WATCHMAN_SALARY:     'Watchman Salary',
  ELECTRICITY:         'Electricity',
  WATER_MUNICIPAL:     'Water / Municipal',
  GARBAGE:             'Garbage',
  GENERATOR_DIESEL:    'Generator Diesel',
  LIFT_CMC:            'Lift AMC',
  LIFT_AMC:            'Lift AMC',
  LIFT_REPAIR:         'Lift Repair',
  PLUMBING:            'Plumbing',
  ELECTRICAL_REPAIR:   'Electrical Repair',
  CLEANING_SUPPLIES:   'Cleaning Supplies',
  STATIONERY:          'Stationery',
  INTERNET:            'Internet',
  MOBILE_RECHARGE:     'Mobile Recharge',
  BANK_CHARGES:        'Bank Charges',
  AUDIT:               'Audit',
  LEGAL:               'Legal',
  EVENT:               'Event',
  ADVANCE_PAYMENT:     'Advance Payment',
  CORPUS_FUND_PAYMENT: 'Corpus Fund',
  MISC:                'Misc',
};

export const INCOME_CATEGORY_LABELS: Record<IncomeCategory, string> = {
  MAINTENANCE:     'Maintenance',
  CMC:             'AMC',
  PENALTY:         'Penalty',
  AD_BOARD_INCOME: 'Ad Board',
  CORPUS_FUND:     'Corpus Fund',
  OTHER_INCOME:    'Other',
};
