import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { formatPdfINR } from '@/lib/utils/currency';

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, padding: 40, color: '#111' },
  header: { borderBottomWidth: 2, borderBottomColor: '#244855', paddingBottom: 10, marginBottom: 10, alignItems: 'center' },
  societyName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#244855', textAlign: 'center' },
  subText: { fontSize: 9, color: '#555', textAlign: 'center', marginTop: 2 },
  titleRow: { backgroundColor: '#E64833', paddingVertical: 6, marginBottom: 14, alignItems: 'center' },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#fff', letterSpacing: 1.5 },
  metaGrid: { flexDirection: 'row', marginBottom: 16, gap: 20 },
  metaCol: { flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 4, padding: 8 },
  metaRow: { flexDirection: 'row', marginBottom: 6 },
  metaLabel: { fontSize: 8, color: '#666', width: 78, fontFamily: 'Helvetica-Bold' },
  metaValue: { fontSize: 9, color: '#111', flex: 1 },
  intro: { fontSize: 10, lineHeight: 1.5, color: '#222', marginBottom: 12 },
  table: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 4, marginBottom: 14 },
  thRow: { flexDirection: 'row', backgroundColor: '#244855' },
  th: { color: '#fff', fontSize: 9, fontFamily: 'Helvetica-Bold', padding: 6 },
  tdRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#eef2f5' },
  td: { fontSize: 9, color: '#222', padding: 6 },
  colNo: { width: 40 },
  colPeriod: { flex: 1 },
  colAmt: { width: 110, textAlign: 'right' },
  totalRow: { flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: '#244855', backgroundColor: '#f8fafc' },
  totalLabel: { flex: 1, fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#244855', padding: 6, textAlign: 'right' },
  totalValue: { width: 110, fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#E64833', padding: 6, textAlign: 'right' },
  payBox: { borderWidth: 1, borderColor: '#E64833', borderRadius: 4, padding: 10, marginBottom: 14, backgroundColor: 'rgba(230,72,51,0.05)' },
  payText: { fontSize: 10, color: '#111', lineHeight: 1.5 },
  payStrong: { fontFamily: 'Helvetica-Bold', color: '#E64833' },
  footerNote: { fontSize: 9, color: '#444', lineHeight: 1.5, marginBottom: 24 },
  sign: { flexDirection: 'row', justifyContent: 'flex-end' },
  signBox: { alignItems: 'center', width: 240 },
  signFor: { fontSize: 9, color: '#555', marginBottom: 28 },
  signLine: { borderTopWidth: 1, borderTopColor: '#111', width: '100%', marginBottom: 4 },
  signTitle: { fontSize: 9, color: '#555' },
  disclaimer: { borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, marginTop: 14 },
  disclaimerText: { fontSize: 8, color: '#888', textAlign: 'center', fontStyle: 'italic' },
});

export interface DuesNoticeItem {
  period: string; // e.g. "Oct 2025"
  amount: number;
}

export interface DuesNoticeData {
  societyName: string;
  registrationNumber: string | null;
  address: string | null;
  mobile: string | null;
  upiId: string | null;
  noticeTitle: string;
  noticeDate: string;
  payByDate: string;
  footer: string;
  flatNumber: string;
  residentName: string;
  items: DuesNoticeItem[];
  chargesCount: number;
  totalDue: number;
  /** True when the flat has dues but no itemised bills (older arrears). */
  unitemised?: boolean;
}

function NoticePage({ d }: { d: DuesNoticeData }) {
  const nbsp = (s: string) => s.replace(' ', ' ');
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.societyName}>{d.societyName}</Text>
        {d.registrationNumber && <Text style={styles.subText}>Reg. No: {d.registrationNumber}</Text>}
        {d.address && <Text style={styles.subText}>{d.address}</Text>}
        {d.mobile && <Text style={styles.subText}>Mobile: {d.mobile}</Text>}
      </View>

      <View style={styles.titleRow}><Text style={styles.title}>{d.noticeTitle.toUpperCase()}</Text></View>

      <View style={styles.metaGrid}>
        <View style={styles.metaCol}>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Flat No.</Text><Text style={styles.metaValue}>{d.flatNumber}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Resident</Text><Text style={styles.metaValue}>{d.residentName}</Text></View>
        </View>
        <View style={styles.metaCol}>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Notice Date</Text><Text style={styles.metaValue}>{d.noticeDate}</Text></View>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Charges</Text><Text style={styles.metaValue}>{d.chargesCount}</Text></View>
        </View>
      </View>

      <Text style={styles.intro}>
        {'Dear '}{d.residentName}{', our records show the following charges are outstanding for Flat '}
        {d.flatNumber}{'. The balance includes all payable maintenance and AMC listed below.'}
      </Text>

      <View style={styles.table}>
        <View style={styles.thRow}>
          <Text style={[styles.th, styles.colNo]}>#</Text>
          <Text style={[styles.th, styles.colPeriod]}>Particulars</Text>
          <Text style={[styles.th, styles.colAmt]}>Amount</Text>
        </View>
        {d.items.map((it, i) => (
          <View style={styles.tdRow} key={i}>
            <Text style={[styles.td, styles.colNo]}>{i + 1}</Text>
            <Text style={[styles.td, styles.colPeriod]}>{nbsp(it.period)}</Text>
            <Text style={[styles.td, styles.colAmt]}>{formatPdfINR(it.amount)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Outstanding</Text>
          <Text style={styles.totalValue}>{formatPdfINR(d.totalDue)}</Text>
        </View>
      </View>

      <View style={styles.payBox}>
        <Text style={styles.payText}>
          {'Please pay '}<Text style={styles.payStrong}>{formatPdfINR(d.totalDue)}</Text>
          {' on or before '}<Text style={styles.payStrong}>{d.payByDate}</Text>
          {d.upiId ? `. UPI: ${d.upiId}` : '.'}
        </Text>
      </View>

      <Text style={styles.footerNote}>{d.footer}</Text>

      <View style={styles.sign}>
        <View style={styles.signBox}>
          <Text style={styles.signFor}>FOR {d.societyName.toUpperCase()}</Text>
          <View style={styles.signLine} />
          <Text style={styles.signTitle}>Treasurer / Authorised Signatory</Text>
        </View>
      </View>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          This is a computer-generated dues reminder. If payment has already been made, please ignore this notice.
        </Text>
      </View>
    </Page>
  );
}

export function DuesNoticePDF({ notices }: { notices: DuesNoticeData[] }) {
  const title = notices.length === 1 ? `Dues Notice — Flat ${notices[0].flatNumber}` : 'Dues Notices';
  return (
    <Document title={title} author={notices[0]?.societyName ?? 'Society'}>
      {notices.map((d, i) => <NoticePage d={d} key={i} />)}
    </Document>
  );
}
