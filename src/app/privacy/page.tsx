import type { Metadata } from 'next';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Privacy Policy · Trezia',
  alternates: { canonical: '/privacy' },
};

// name a real grievance contact, not a placeholder — pulled from
// society_config (public read: name/address/mobile are the same details a
// notice board would show, not resident PII) rather than hardcoded per
// deployment. Falls back to the bracketed placeholder only if config is
// somehow empty (fresh install, DB unreachable at build time).
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ society?: string }>;
}) {
  const { society } = await searchParams;
  let societySlug = society?.trim().toLowerCase() || null;

  // WHY: get_public_privacy_contact requires an exact slug match (post-046);
  // most direct visits (and the landing footer link) carry no ?society=, so
  // a single-society deployment must resolve its own slug here rather than
  // fall straight to the statutory placeholders. Mirrors the public redacted
  // lookup class already exposed by GET /api/societies (society names only,
  // no resident data) — active-society slugs are equally non-sensitive. A
  // multi-society deployment has no single grievance contact, so ambiguity
  // (0 or 2+ active societies) intentionally keeps the placeholder fallback.
  if (!societySlug) {
    const service = await createServiceClient();
    const { data: activeSocieties } = await service
      .from('societies')
      .select('slug')
      .eq('status', 'active')
      .limit(2);
    if (activeSocieties?.length === 1) {
      societySlug = activeSocieties[0].slug;
    }
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc('get_public_privacy_contact', {
    p_society_slug: societySlug,
  });
  const config = (data as Array<{ name: string; address: string; mobile: string }> | null)?.[0];

  const societyName = config?.name || '[YOUR_SOCIETY_NAME]';
  const societyAddress = config?.address || '[SOCIETY_ADDRESS]';
  const treasurerMobile = config?.mobile || '[TREASURER_MOBILE]';

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 text-[13px] text-sf-label2">
      <h1 className="text-[24px] font-bold text-sf-label mb-2">Privacy Policy</h1>
      <p className="text-[12px] text-sf-label2 mb-8">
        Data Fiduciary: {societyName}, {societyAddress}<br />
        Contact: {treasurerMobile}<br />
        Last updated: 19 July 2026
      </p>

      <Section title="1. Data Collected">
        <p>Name, flat number, mobile number, email address (optional).</p>
        <p className="mt-1">Not collected: Aadhaar, PAN, bank account numbers, biometrics.</p>
      </Section>

      <Section title="2. Purpose">
        <p>Managing society accounts, access, maintenance bills and receipts, and administrative notices.</p>
        <p className="mt-1">No advertising or commercial profiling. Data is shared only with the service providers needed to operate Trezia.</p>
      </Section>

      <Section title="3. Legal Basis">
        <p>Society administration and legal or accounting obligations, with consent used where required under the DPDP Act 2023.</p>
      </Section>

      <Section title="4. Retention">
        <p>Financial records: 8 years (Indian accounting law requirement).</p>
        <p className="mt-1">After a resident moves out, their active phone and email fields are cleared within 30 days under the society&rsquo;s retention process. Their name may be retained where needed for historical financial attribution.</p>
        <p className="mt-1">Old contact values may remain in restricted, append-only audit history where necessary for accountability, dispute handling, or legal retention. Audit access is limited to authorized financial operators and eligible Platform Owner recovery access.</p>
      </Section>

      <Section title="5. Your Rights (DPDP Act 2023)">
        <ul className="list-disc list-inside space-y-1">
          <li>Access: request copy at treasurer&rsquo;s office</li>
          <li>Correction: inform treasurer</li>
          <li>Erasure: request removal of active contact fields after vacating, subject to financial, audit, accountability, and legal retention duties</li>
          <li>Grievance: contact treasurer or Data Protection Board of India (dpboard.gov.in)</li>
        </ul>
      </Section>

      <Section title="6. Third-Party Processors">
        <p>Supabase provides authentication and the society database; Vercel hosts the application; Cloudflare R2 stores private society files; and Resend delivers authorized email.</p>
        <p className="mt-1">The read-only operator assistant uses Groq only when an Admin or Treasurer chooses to submit a query. These providers process data only to deliver their contracted service, under their applicable terms and data-processing commitments.</p>
      </Section>

      <Section title="7. Security">
        <p>Encrypted connections and provider-managed encryption at rest protect stored data. Access is restricted by society and role: Admins and Treasurers operate the books, Residents see only their scoped read-only views, and the deployment-provisioned Platform Owner has controlled operational and recovery access through society memberships. Reviewed subprocessors receive only the access needed to provide their service.</p>
        <p className="mt-1">Append-only audit records cover designated financial, resident, access, AMC, ledger, and treasurer-handover changes. They do not claim to capture every change in every table.</p>
      </Section>

      <Section title="8. No Advertising">
        <p>This application contains no advertising. Resident data is never used for commercial profiling or shared with any advertiser.</p>
      </Section>

      <Section title="9. Contact">
        <p>{societyName}<br />{treasurerMobile}</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-[15px] font-semibold text-sf-label mb-2">{title}</h2>
      <div className="text-sf-label2 leading-relaxed">{children}</div>
    </section>
  );
}
