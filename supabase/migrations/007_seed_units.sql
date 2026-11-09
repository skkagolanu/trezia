-- Seed units.
INSERT INTO units (flat_number) VALUES
('[FLAT_101]'), ('[FLAT_102]'), ('[FLAT_103]'), ('[FLAT_104]'), ('[FLAT_105]'),
('[FLAT_106]'), ('[FLAT_107]'), ('[FLAT_108]'), ('[FLAT_109]'), ('[FLAT_110]'),
('[FLAT_111]'),
('[FLAT_201]'), ('[FLAT_202]'), ('[FLAT_203]'), ('[FLAT_204]'), ('[FLAT_205]'),
('[FLAT_206]'), ('[FLAT_207]'), ('[FLAT_208]'), ('[FLAT_209]'), ('[FLAT_210]'),
('[FLAT_211]'),
('[FLAT_301]'), ('[FLAT_302]'), ('[FLAT_303]'), ('[FLAT_304]'), ('[FLAT_305]'),
('[FLAT_306]'), ('[FLAT_307]'), ('[FLAT_308]'), ('[FLAT_309]'), ('[FLAT_310]'),
('[FLAT_311]'),
('[FLAT_401]'), ('[FLAT_402]'), ('[FLAT_403]'), ('[FLAT_404]'), ('[FLAT_405]'),
('[FLAT_406]'), ('[FLAT_407]'), ('[FLAT_408]'), ('[FLAT_409]'), ('[FLAT_410]'),
('[FLAT_411]'),
('[FLAT_501]'), ('[FLAT_502]'), ('[FLAT_503]'), ('[FLAT_504]'), ('[FLAT_505]'),
('[FLAT_506]'), ('[FLAT_507]'), ('[FLAT_508]'), ('[FLAT_509]'), ('[FLAT_510]'),
('[FLAT_511]');

INSERT INTO society_config (
  name,
  registration_number,
  address,
  mobile,
  receipt_prefix,
  next_receipt_no,
  monthly_maintenance_amount
) VALUES (
  '[YOUR_SOCIETY_FULL_NAME]',
  '[YOUR_SOCIETY_REG_NUMBER]',
  '[YOUR_SOCIETY_FULL_ADDRESS]',
  '[TREASURER_MOBILE]',
  '[YOUR_RECEIPT_PREFIX]',
  1,
  2000.00
);
