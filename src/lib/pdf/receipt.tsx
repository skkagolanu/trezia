import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { amountInWords, formatPdfINR } from '@/lib/utils/currency';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 40,
    color: '#111',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#244855',
    paddingBottom: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  societyName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#244855',
    textAlign: 'center',
  },
  subText: {
    fontSize: 9,
    color: '#555',
    textAlign: 'center',
    marginTop: 2,
  },
  titleRow: {
    backgroundColor: '#244855',
    paddingVertical: 6,
    marginBottom: 14,
    alignItems: 'center',
  },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#fff',
    letterSpacing: 2,
  },
  infoGrid: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 20,
  },
  infoCol: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    padding: 8,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  infoLabel: {
    fontSize: 8,
    color: '#666',
    width: 90,
    fontFamily: 'Helvetica-Bold',
  },
  infoValue: {
    fontSize: 9,
    color: '#111',
    flex: 1,
  },
  body: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    padding: 12,
    marginBottom: 20,
    backgroundColor: '#f8fafc',
  },
  bodyText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#222',
  },
  amountBox: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20,
  },
  amountLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#244855',
    marginRight: 8,
  },
  amountValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#244855',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 30,
    marginBottom: 10,
  },
  signatory: {
    alignItems: 'center',
    width: 320,
  },
  sigForText: {
    fontSize: 9,
    color: '#555',
    marginBottom: 30,
  },
  sigLine: {
    borderTopWidth: 1,
    borderTopColor: '#111',
    width: '100%',
    marginBottom: 4,
  },
  signatoryTitle: {
    fontSize: 9,
    color: '#555',
  },
  disclaimer: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
    marginTop: 10,
  },
  disclaimerText: {
    fontSize: 8,
    color: '#888',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

export interface ReceiptData {
  societyName: string;
  registrationNumber: string | null;
  address: string | null;
  mobile: string | null;
  receiptNumber: string;
  receiptDate: string;
  flatNumber: string;
  residentName: string;
  amountPaid: number;
  paymentMode: string;
  utrReference: string | null;
  monthsPeriod: string;
  monthsCovered: number;
  chargeDescription?: string;
  periodLabel?: string;
}

const MODE_DISPLAY: Record<string, string> = {
  UPI:               'UPI',
  CASH:              'Cash',
  CHEQUE:            'Cheque',
  BANK_TRANSFER:     'Bank Transfer',
  NEFT:              'NEFT',
  IMPS:              'IMPS',
  MANUAL_COLLECTION: 'Manual Collection',
  ADVANCE:           'Advance',
  OTHER:             'Other',
};

export function ReceiptPDF({ data }: { data: ReceiptData }) {
  const modeLabel = MODE_DISPLAY[data.paymentMode] ?? data.paymentMode.replace(/_/g, ' ');
  const words = amountInWords(data.amountPaid);
  const figure = formatPdfINR(data.amountPaid);
  // Non-breaking space within each "Mon YYYY" label prevents react-pdf
  // from splitting "Dec\n2024" across lines.
  const periodNbsp = data.monthsPeriod.split(', ').map(m => m.replace(' ', ' ')).join(', ');

  return (
    <Document title={`Receipt ${data.receiptNumber}`} author={data.societyName}>
      <Page size="A4" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.header}>
          <Text style={styles.societyName}>{data.societyName}</Text>
          {data.registrationNumber && (
            <Text style={styles.subText}>Reg. No: {data.registrationNumber}</Text>
          )}
          {data.address && <Text style={styles.subText}>{data.address}</Text>}
          {data.mobile && <Text style={styles.subText}>Mobile: {data.mobile}</Text>}
        </View>

        {/* Title bar */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>RECEIPT</Text>
        </View>

        {/* Two-column info grid */}
        <View style={styles.infoGrid}>
          <View style={styles.infoCol}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Resident Name</Text>
              <Text style={styles.infoValue}>{data.residentName}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Flat No.</Text>
              <Text style={styles.infoValue}>{data.flatNumber}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{data.periodLabel ?? 'Bill Period'}</Text>
              <Text style={styles.infoValue}>{periodNbsp}</Text>
            </View>
          </View>
          <View style={styles.infoCol}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Receipt No.</Text>
              <Text style={styles.infoValue}>{data.receiptNumber}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Receipt Date</Text>
              <Text style={styles.infoValue}>{data.receiptDate}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Mode</Text>
              <Text style={styles.infoValue}>{modeLabel}</Text>
            </View>
          </View>
        </View>

        {/* Amount highlight */}
        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Amount Received:</Text>
          <Text style={styles.amountValue}>{figure}</Text>
        </View>

        {/* Body paragraph */}
        <View style={styles.body}>
          <Text style={styles.bodyText}>
            {'Received with thanks from '}
            {data.residentName}
            {' (Flat No. '}
            {data.flatNumber}
            {'), the sum of '}
            {words}
            {' ('}
            {figure}
            {`) towards ${data.chargeDescription ?? 'Maintenance Charges'} for `}
            {periodNbsp}
            {' via '}
            {modeLabel}
            {data.utrReference ? ` — Txn ID ${data.utrReference}` : ''}
            {'.'}
          </Text>
        </View>

        {/* Signatory */}
        <View style={styles.footer}>
          <View style={styles.signatory}>
            <Text style={styles.sigForText}>FOR {data.societyName.toUpperCase()}</Text>
            <View style={styles.sigLine} />
            <Text style={styles.signatoryTitle}>Authorised Signatory</Text>
          </View>
        </View>

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            This is a computer-generated receipt and does not require a physical signature.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
