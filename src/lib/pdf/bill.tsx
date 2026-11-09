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
  metaGrid: {
    flexDirection: 'row',
    marginBottom: 14,
    gap: 10,
  },
  metaCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 3,
    padding: 6,
  },
  metaLabel: {
    fontSize: 7,
    color: '#666',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 9,
    color: '#111',
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#244855',
    backgroundColor: '#eef2f2',
    padding: 4,
    marginBottom: 6,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 9,
    color: '#666',
    width: 100,
  },
  infoValue: {
    fontSize: 9,
    color: '#111',
    flex: 1,
  },
  table: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 3,
    marginBottom: 14,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableRowLast: {
    flexDirection: 'row',
  },
  col1: { flex: 3, padding: 6 },
  col2: { flex: 1, padding: 6 },
  col3: { flex: 1, padding: 6 },
  col4: { flex: 1.5, padding: 6, alignItems: 'flex-end' },
  col5: { flex: 1.5, padding: 6, alignItems: 'flex-end' },
  thText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#555',
  },
  tdText: {
    fontSize: 9,
    color: '#111',
  },
  tdRight: {
    fontSize: 9,
    color: '#111',
    textAlign: 'right',
  },
  totalsBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 3,
    marginBottom: 14,
    overflow: 'hidden',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  totalRowHighlight: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#eef2f2',
  },
  totalLabel: { fontSize: 9, color: '#444' },
  totalValue: { fontSize: 9, color: '#111', fontFamily: 'Helvetica-Bold' },
  totalLabelBig: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#244855' },
  totalValueBig: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#244855' },
  wordsBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 3,
    padding: 8,
    marginBottom: 20,
    backgroundColor: '#f8fafc',
  },
  wordsLabel: { fontSize: 8, color: '#666', marginBottom: 2 },
  wordsText: { fontSize: 9, color: '#111', fontFamily: 'Helvetica-Bold' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    marginBottom: 10,
  },
  signatory: {
    alignItems: 'center',
    width: 180,
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

export interface BillData {
  societyName: string;
  registrationNumber: string | null;
  address: string | null;
  mobile: string | null;
  gstin: string | null;
  panNumber: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  flatNumber: string;
  residentName: string;
  residentPhone: string | null;
  residentEmail: string | null;
  flatAreaSqft: number | null;
  baseAmount: number;
  cgstPercent: number;
  sgstPercent: number;
  cgstAmount: number;
  sgstAmount: number;
  previousDue: number;
  penaltyAmount: number;
  chequeDishonour: number;
  payableAmount: number;
  billPeriod: string;
}

export function BillPDF({ data }: { data: BillData }) {
  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.societyName}>
      <Page size="A4" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.header}>
          <Text style={styles.societyName}>{data.societyName}</Text>
          {data.registrationNumber && (
            <Text style={styles.subText}>Reg. No: {data.registrationNumber}</Text>
          )}
          {data.address && <Text style={styles.subText}>{data.address}</Text>}
          {data.mobile && <Text style={styles.subText}>Mobile: {data.mobile}</Text>}
          {(data.gstin || data.panNumber) && (
            <Text style={styles.subText}>
              {data.gstin ? `GSTIN: ${data.gstin}` : ''}
              {data.gstin && data.panNumber ? '  |  ' : ''}
              {data.panNumber ? `PAN: ${data.panNumber}` : ''}
            </Text>
          )}
        </View>

        {/* Title bar */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>MAINTENANCE INVOICE</Text>
        </View>

        {/* Invoice meta grid */}
        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Invoice Number</Text>
            <Text style={styles.metaValue}>{data.invoiceNumber}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Invoice Date</Text>
            <Text style={styles.metaValue}>{data.invoiceDate}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Due Date</Text>
            <Text style={styles.metaValue}>{data.dueDate}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Bill Period</Text>
            <Text style={styles.metaValue}>{data.billPeriod}</Text>
          </View>
        </View>

        {/* Invoice To */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INVOICE TO</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Name</Text>
            <Text style={styles.infoValue}>{data.residentName}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Flat No.</Text>
            <Text style={styles.infoValue}>{data.flatNumber}</Text>
          </View>
          {data.flatAreaSqft != null && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Area</Text>
              <Text style={styles.infoValue}>{data.flatAreaSqft} sq.ft.</Text>
            </View>
          )}
          {data.residentPhone && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Mobile</Text>
              <Text style={styles.infoValue}>{data.residentPhone}</Text>
            </View>
          )}
          {data.residentEmail && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{data.residentEmail}</Text>
            </View>
          )}
        </View>

        {/* Line Items */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <View style={styles.col1}><Text style={styles.thText}>Description</Text></View>
            <View style={styles.col2}><Text style={styles.thText}>SAC</Text></View>
            <View style={styles.col3}><Text style={styles.thText}>Units</Text></View>
            <View style={styles.col4}><Text style={[styles.thText, { textAlign: 'right' }]}>Rate (Rs.)</Text></View>
            <View style={styles.col5}><Text style={[styles.thText, { textAlign: 'right' }]}>Amount (Rs.)</Text></View>
          </View>
          <View style={styles.tableRowLast}>
            <View style={styles.col1}>
              <Text style={styles.tdText}>Maintenance Charges — {data.billPeriod}</Text>
            </View>
            <View style={styles.col2}><Text style={styles.tdText}>998833</Text></View>
            <View style={styles.col3}><Text style={styles.tdText}>1</Text></View>
            <View style={styles.col4}><Text style={styles.tdRight}>{formatPdfINR(data.baseAmount)}</Text></View>
            <View style={styles.col5}><Text style={styles.tdRight}>{formatPdfINR(data.baseAmount)}</Text></View>
          </View>
        </View>

        {/* Totals */}
        <View style={styles.totalsBox}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Current Bill</Text>
            <Text style={styles.totalValue}>{formatPdfINR(data.baseAmount)}</Text>
          </View>
          {data.cgstPercent > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>CGST @ {data.cgstPercent}%</Text>
              <Text style={styles.totalValue}>{formatPdfINR(data.cgstAmount)}</Text>
            </View>
          )}
          {data.sgstPercent > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>SGST @ {data.sgstPercent}%</Text>
              <Text style={styles.totalValue}>{formatPdfINR(data.sgstAmount)}</Text>
            </View>
          )}
          {data.previousDue > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Previous Outstanding</Text>
              <Text style={styles.totalValue}>{formatPdfINR(data.previousDue)}</Text>
            </View>
          )}
          {data.penaltyAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Penalty</Text>
              <Text style={styles.totalValue}>{formatPdfINR(data.penaltyAmount)}</Text>
            </View>
          )}
          {data.chequeDishonour > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Cheque Dishonour Charges</Text>
              <Text style={styles.totalValue}>{formatPdfINR(data.chequeDishonour)}</Text>
            </View>
          )}
          <View style={styles.totalRowHighlight}>
            <Text style={styles.totalLabelBig}>Total Payable</Text>
            <Text style={styles.totalValueBig}>{formatPdfINR(data.payableAmount)}</Text>
          </View>
        </View>

        {/* Amount in words */}
        <View style={styles.wordsBox}>
          <Text style={styles.wordsLabel}>Amount in Words</Text>
          <Text style={styles.wordsText}>{amountInWords(data.payableAmount)}</Text>
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
            This is an electronically generated document, hence does not require signature.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
