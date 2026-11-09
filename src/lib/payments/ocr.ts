// Client-side OCR to pre-fill a resident's payment form from their UPI
// screenshot. Convenience only — every extracted field is shown to the
// resident/treasurer for human review before it is ever submitted; nothing
// here writes data or is treated as ground truth. tesseract.js is a large
// wasm-backed bundle, so it is dynamically imported only when this function
// actually runs, keeping it out of the initial page bundle.
//
// The engine assets are self-hosted under public/tesseract/ (not fetched
// from the jsdelivr CDN) because the production CSP is default-src 'self'
// and allows no third-party origin. workerBlobURL: false makes tesseract
// spawn its worker from that same-origin path instead of a blob: URL,
// which default-src 'self' would otherwise block too.

export type OcrResult = {
  amount: number | null;
  utr: string | null;
  paidOn: string | null;
  rawText: string;
};

const EMPTY_RESULT: OcrResult = { amount: null, utr: null, paidOn: null, rawText: '' };

// Matches "₹1,234.56", "Rs. 1234", "INR 1,234" first (currency-anchored, most
// reliable), then falls back to a bare two-decimal amount like "1234.00"
// which UPI screenshots commonly show even without a visible currency mark.
//
// The word boundaries on Rs/INR are load-bearing: without them the
// case-insensitive alternation matched the "rs" inside an ordinary word, so
// "Yours 12" yielded an amount of 12.
const CURRENCY_ANCHOR = /₹|\bRs\.?|\bINR\b/i;
const AMOUNT_AFTER_ANCHOR = /^\s*(\d[\d,.]*)/;
const AMOUNT_LABEL = /\bAmount\b/i;
const NUMBER_AFTER_AMOUNT_LABEL = /\d[\d,.]*/;
const BARE_DECIMAL_AMOUNT = /\b(\d[\d,]*\.\d{2})\b/;

/** Indian grouping and a stray trailing separator, into a positive number. */
function toAmount(raw: string): number | null {
  const value = Number(raw.replace(/,/g, '').replace(/\.$/, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

type RankedCandidate<T> = { value: T; score: number; order: number };

function chooseCandidate<T>(candidates: RankedCandidate<T>[]): T | null {
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  const best = candidates[0];
  const tiedValues = new Set(
    candidates.filter(candidate => candidate.score === best.score).map(candidate => String(candidate.value)),
  );
  // A screenshot presenting two equally credible facts is not a safe source
  // for an automatic pre-fill. Leave the field blank for human review.
  return tiedValues.size === 1 ? best.value : null;
}

const PAYMENT_AMOUNT_CONTEXT = /\b(?:paid|sent|debited|transferred|transaction\s+amount|payment\s+amount|amount\s+paid)\b/i;
const NON_PAYMENT_AMOUNT_CONTEXT = /\b(?:cashback|reward|fee|fees|charge|charges|balance|amount\s+due|total\s+due|invoice|bill\s+amount|offer)\b/i;

function parseAmount(text: string): number | null {
  const lines = text.split(/\r?\n/);
  const candidates: RankedCandidate<number>[] = [];
  let order = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nearby = [lines[index - 1], lines[index + 1]].filter(Boolean).join(' ');
    const contextScore = (PAYMENT_AMOUNT_CONTEXT.test(line) ? 10 : 0)
      + (PAYMENT_AMOUNT_CONTEXT.test(nearby) ? 2 : 0)
      - (NON_PAYMENT_AMOUNT_CONTEXT.test(line) ? 14 : 0)
      - (NON_PAYMENT_AMOUNT_CONTEXT.test(nearby) ? 2 : 0);

    const label = line.match(AMOUNT_LABEL);
    if (label?.index !== undefined) {
      const raw = line.slice(label.index + label[0].length).match(NUMBER_AFTER_AMOUNT_LABEL)?.[0];
      const value = raw ? toAmount(raw) : null;
      if (value !== null) candidates.push({ value, score: contextScore + 7, order: order++ });
    }

    const anchor = line.match(CURRENCY_ANCHOR);
    if (anchor?.index !== undefined) {
      const raw = line.slice(anchor.index + anchor[0].length).match(AMOUNT_AFTER_ANCHOR)?.[1];
      const value = raw ? toAmount(raw) : null;
      if (value !== null) candidates.push({ value, score: contextScore + 4, order: order++ });
    }

    const bare = line.match(BARE_DECIMAL_AMOUNT)?.[1];
    const bareValue = bare ? toAmount(bare) : null;
    if (bareValue !== null) candidates.push({ value: bareValue, score: contextScore + 1, order: order++ });
  }

  return chooseCandidate(candidates);
}

// Words that sit between a reference label and the reference itself
// ("UPI transaction ID 1234…", "UTR No. 1234…"). Scanning past these but
// stopping at anything else is what keeps the search on the right line.
const REFERENCE_FILLER = /^(?:no|nos|num|number|id|ids|ref|reference|txn|transaction|upi|utr|imps|neft|rrn|bank|is|code)$/i;

// NPCI's bank-statement RRN is 12 digits, while UPI transaction identifiers can
// be alphanumeric and up to 35 characters. Requiring at least one real digit
// and rejecting status tokens stops ordinary result text from being accepted:
// the previous pattern took the alphanumeric run after any keyword, so
// "Transaction Successful" pre-filled the UTR field with "Successful". That travelled into
// resident_payment_claims.utr_reference, where migration 066's unique index
// treats one reference as one real transaction, so the second resident to
// upload a screenshot saying "Successful" collided with the first.
const STATUS_TOKEN = /^(?:success(?:ful)?|completed?|processing|pending|failed?|cancelled|canceled)\d*$/i;

function looksLikeReference(token: string): boolean {
  return /^[A-Za-z0-9]{6,35}$/.test(token)
    && /\d/.test(token)
    && !STATUS_TOKEN.test(token);
}

const REFERENCE_KEYWORD = /\b(?:UTR|UPI|Txn|Transaction|Reference|Ref|RRN|IMPS|NEFT|Order)\b/i;

// Reads the tokens after a reference label, allowing only filler words in
// between. Gives up the moment a real word appears, so a label followed by
// prose yields nothing rather than yielding the prose.
function referenceAfterLabel(rest: string): string | null {
  for (const token of rest.split(/[^A-Za-z0-9]+/)) {
    if (!token) continue;
    if (looksLikeReference(token)) return token;
    if (!REFERENCE_FILLER.test(token)) return null;
  }
  return null;
}

// UPI apps label the reference differently (UTR / UPI Ref / Txn ID) and several
// put the value on the line below the label, so each labelled line is searched
// and then the line after it. A bare 12-digit number — the standard UTR length
// for bank-rail transfers — is the last resort.
function parseUtr(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const label = lines[i].match(REFERENCE_KEYWORD);
    if (label?.index === undefined) continue;
    const sameLine = referenceAfterLabel(lines[i].slice(label.index + label[0].length));
    if (sameLine) return sameLine;
    const nextLine = lines[i + 1] === undefined ? null : referenceAfterLabel(lines[i + 1]);
    if (nextLine) return nextLine;
  }
  const bareUtr = text.match(/\b(\d{12})\b/);
  return bareUtr?.[1] ?? null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const PAYMENT_DATE_CONTEXT = /\b(?:paid|payment|transaction|transferred|debited|sent)\b/i;
const NON_PAYMENT_DATE_CONTEXT = /\b(?:due|invoice|bill|expiry|expires|valid\s+until|statement\s+period)\b/i;

function normalizedDate(match: RegExpMatchArray, kind: 'iso' | 'numeric' | 'named'): string | null {
  const year = Number(kind === 'iso' ? match[1] : match[3]);
  const month = kind === 'named' ? MONTH_NAMES[match[2].toLowerCase()] : Number(match[2]);
  const day = Number(kind === 'iso' ? match[3] : match[1]);
  return month && isValidDate(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

function parseDate(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const candidates: RankedCandidate<string>[] = [];
  let order = 0;
  const patterns: Array<{ pattern: RegExp; kind: 'iso' | 'numeric' | 'named' }> = [
    { pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, kind: 'iso' },
    { pattern: /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g, kind: 'numeric' },
    { pattern: /\b(\d{1,2})\s+([A-Za-z]{3,9})[,\s]+(\d{4})\b/g, kind: 'named' },
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nearby = [lines[index - 1], lines[index + 1]].filter(Boolean).join(' ');
    const score = (PAYMENT_DATE_CONTEXT.test(line) ? 8 : 0)
      + (PAYMENT_DATE_CONTEXT.test(nearby) ? 2 : 0)
      - (NON_PAYMENT_DATE_CONTEXT.test(line) ? 12 : 0)
      - (NON_PAYMENT_DATE_CONTEXT.test(nearby) ? 2 : 0);
    for (const { pattern, kind } of patterns) {
      for (const match of line.matchAll(pattern)) {
        const value = normalizedDate(match, kind);
        if (value) candidates.push({ value, score, order: order++ });
      }
    }
  }

  return chooseCandidate(candidates);
}

export function parsePaymentText(rawText: string): OcrResult {
  return {
    amount: parseAmount(rawText),
    utr: parseUtr(rawText),
    paidOn: parseDate(rawText),
    rawText,
  };
}

export async function extractPaymentFields(file: File): Promise<OcrResult> {
  try {
    const { default: Tesseract } = await import('tesseract.js');
    const { data } = await Tesseract.recognize(file, 'eng', {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/core',
      langPath: '/tesseract/lang',
      workerBlobURL: false,
    });
    const rawText = data.text ?? '';
    return parsePaymentText(rawText);
  } catch {
    // Heuristic, best-effort extraction — never throw back at the caller.
    // The resident/treasurer always reviews and can fill fields in manually.
    return EMPTY_RESULT;
  }
}
