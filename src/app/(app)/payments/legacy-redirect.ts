// `/payments?type=X` is a hard external contract — bookmarks, notification links,
// other slices' hrefs. Rather than update every caller in lockstep with moving
// each view to its own route, this makes the OLD querystring form permanently
// forward to the NEW path. A call site this change misses becomes a redirect,
// never a dead link. Pure and exported so the mapping is unit-tested directly
// (see __tests__/app/payments/legacy-redirect.test.ts).
const TYPE_ROUTES: Record<string, string> = {
  amc: '/payments/levies',
  bills: '/payments/bills',
  'other-income': '/payments/other-income',
  attention: '/payments/attention',
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function resolveLegacyTypeRedirect(params: RawSearchParams): string | null {
  const rawType = params.type;
  const type = Array.isArray(rawType) ? rawType[0] : rawType;
  if (!type) return null;

  const target = TYPE_ROUTES[type];
  // 'all' | 'maintenance' | any unrecognized value — these still live at
  // /payments itself, so there is nothing to redirect.
  if (!target) return null;

  const qs = new URLSearchParams();
  // Prefer a native attention-route param when both forms are present. This
  // avoids sending duplicate `cat`/`page` keys, whose interpretation differs
  // between URL consumers, while retaining legacy links that only have acat
  // and apage.
  const hasCanonicalAttentionParam = (legacyKey: 'acat' | 'apage', canonicalKey: 'cat' | 'page') =>
    type === 'attention' && params[legacyKey] !== undefined && params[canonicalKey] !== undefined;
  for (const [key, value] of Object.entries(params)) {
    if (key === 'type' || value === undefined) continue;
    if (
      (key === 'acat' && hasCanonicalAttentionParam('acat', 'cat')) ||
      (key === 'apage' && hasCanonicalAttentionParam('apage', 'page'))
    ) continue;
    // The attention tab's focused-category params become plain names on its
    // own route (cat/page); the legacy acat/apage names must still be
    // honoured here since they are exactly what an old link carries.
    const outKey =
      type === 'attention' && key === 'acat' ? 'cat' :
      type === 'attention' && key === 'apage' ? 'page' :
      key;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(outKey, v);
    } else {
      qs.set(outKey, value);
    }
  }

  const qsString = qs.toString();
  return qsString ? `${target}?${qsString}` : target;
}
