export interface StructuredPaymentReceiptItem {
  service_code: string;
  description: string;
  quantity: number;
  unit_amount_minor: number;
  unit_amount_usd: string;
  line_total_minor: number;
  line_total_usd: string;
}

export interface StructuredPaymentReceipt {
  receipt_number: string;
  invoice_id: string;
  invoice_number: string;
  status: string;
  organization_name: string;
  provider_name: string;
  customer_name: string;
  customer_email_masked?: string;
  currency: string;
  total_minor: number;
  total_usd: string;
  amount_paid_minor: number;
  amount_paid_usd: string;
  amount_refunded_minor: number;
  amount_refunded_usd: string;
  balance_due_minor: number;
  balance_due_usd: string;
  service_date: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  settlement_reference: string;
  paypal_order_id?: string | null;
  paypal_capture_id: string | null;
  paypal_refund_id?: string | null;
  payment_source_type?: string;
  payment_source_label?: string;
  settlement_verification:
    | 'paypal_sandbox_verified'
    | 'sample_demo_settlement_not_live_paypal';
  is_live_paypal_capture: boolean;
  verification_badge: string;
  line_items: StructuredPaymentReceiptItem[];
  pdf_download_url?: string;
  pdf_base64?: string;
  pdf_byte_length?: number;
}

function escapePdfString(input: string): string {
  return String(input || '')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Generates a standards-compliant PDF 1.4 document (US Letter 612x792pt)
 * containing all required Section 7D receipt fields and prominent verification provenance.
 */
export function generateReceiptPdfString(receipt: StructuredPaymentReceipt): string {
  const isLive = Boolean(receipt.is_live_paypal_capture);
  const isRefunded =
    String(receipt.status || '').toLowerCase() === 'refunded' ||
    Number(receipt.amount_refunded_minor || 0) > 0;
  const ops: string[] = [];

  // Top Header Banner
  if (isLive) {
    ops.push('0.00 0.19 0.53 rg'); // PayPal Deep Blue #003087
  } else {
    ops.push('0.71 0.33 0.04 rg'); // Amber #B45309 for Demo Simulation
  }
  ops.push('36 708 540 54 re f');

  // Header Title
  ops.push('1 1 1 rg');
  const headerTitle = isRefunded
    ? 'PAYPAL AI BILLING KIT - OFFICIAL REFUND & PAYMENT RECEIPT'
    : 'PAYPAL AI BILLING KIT - OFFICIAL PAYMENT RECEIPT';
  ops.push(`BT /F2 13.5 Tf 48 738 Td (${escapePdfString(headerTitle)}) Tj ET`);
  const subtitle = isLive
    ? `VERIFIED PAYPAL SANDBOX TRANSACTION | CAPTURE ID: ${receipt.paypal_capture_id || receipt.receipt_number}${
        receipt.paypal_refund_id ? ` | REFUND ID: ${receipt.paypal_refund_id}` : ''
      }`
    : 'SAMPLE DEMO RECORD - SIMULATED SETTLEMENT (NOT A LIVE PAYPAL CAPTURE)';
  ops.push(`BT /F1 8.5 Tf 48 720 Td (${escapePdfString(subtitle)}) Tj ET`);

  // Provenance Callout Box
  if (isLive) {
    ops.push(isRefunded ? '0.95 0.96 1.00 rg' : '0.93 0.99 0.96 rg');
    ops.push('36 666 540 32 re f');
    ops.push(isRefunded ? '0.12 0.25 0.68 rg' : '0.02 0.37 0.27 rg');
    ops.push(
      `BT /F2 9.5 Tf 48 683 Td (${escapePdfString(
        `PROVENANCE: ${receipt.verification_badge} (${receipt.settlement_verification})${
          isRefunded ? ' - REFUNDED' : ''
        }`
      )}) Tj ET`
    );
    ops.push(
      `BT /F1 8.5 Tf 48 672 Td (${escapePdfString(
        `Verified against PayPal Sandbox Orders/Captures v2 API. PayPal Capture ID: ${receipt.paypal_capture_id}${
          receipt.paypal_refund_id ? ` | PayPal Refund ID: ${receipt.paypal_refund_id}` : ''
        }`
      )}) Tj ET`
    );
  } else {
    ops.push('1.00 0.98 0.92 rg');
    ops.push('36 666 540 32 re f');
    ops.push('0.57 0.25 0.05 rg');
    ops.push(
      'BT /F2 9.5 Tf 48 683 Td (WARNING: SAMPLE DEMO RECORD - NOT A GENUINE PAYPAL TRANSACTION) Tj ET'
    );
    ops.push(
      `BT /F1 8.5 Tf 48 672 Td (${escapePdfString(
        `Reference: ${receipt.settlement_reference} | Provenance: ${receipt.settlement_verification}`
      )}) Tj ET`
    );
  }

  // Metadata Section
  ops.push('0.06 0.09 0.16 rg');
  const metaRows: Array<[string, string]> = [
    ['Receipt Number:', receipt.receipt_number],
    ['Invoice Number:', `#${receipt.invoice_number}`],
    ['Business / Provider:', `${receipt.organization_name} (${receipt.provider_name})`],
    [
      'Customer Identity:',
      `${receipt.customer_name} (${receipt.customer_email_masked || 'a***@demo.paypal-billing-kit.local'})`,
    ],
    ['Payment Status:', receipt.status.toUpperCase()],
    [
      'Payment Method:',
      receipt.payment_source_label ||
        (isLive ? 'PayPal Sandbox Verified Checkout' : 'Simulated Demo Settlement'),
    ],
    ['Payment Date:', receipt.paid_at || 'N/A'],
    ['Service Date:', receipt.service_date || 'N/A'],
    ['PayPal Order ID:', receipt.paypal_order_id || (isLive ? 'Verified via Capture Lookup' : 'N/A (Demo Record)')],
    ['PayPal Capture ID:', receipt.paypal_capture_id || 'N/A (Sample Demo Settlement)'],
    [
      'Refund Status / ID:',
      isRefunded
        ? `REFUNDED ${receipt.amount_refunded_usd} (${receipt.paypal_refund_id || 'Demo Refund'}${receipt.refunded_at ? ` at ${receipt.refunded_at}` : ''})`
        : 'None ($0.00 Refunded)',
    ],
  ];

  let y = 646;
  for (const [label, value] of metaRows) {
    ops.push(`BT /F2 9 Tf 48 ${y} Td (${escapePdfString(label)}) Tj ET`);
    ops.push(`BT /F1 9 Tf 185 ${y} Td (${escapePdfString(value)}) Tj ET`);
    y -= 14;
  }

  // Divider Line
  y -= 6;
  ops.push('0.82 0.86 0.91 RG 1 w');
  ops.push(`36 ${y} m 576 ${y} l S`);

  // Itemized Services Table Header
  y -= 20;
  ops.push('0.95 0.96 0.98 rg');
  ops.push(`36 ${y - 6} 540 20 re f`);
  ops.push('0.06 0.09 0.16 rg');
  ops.push(`BT /F2 9 Tf 44 ${y} Td (SERVICE CODE) Tj ET`);
  ops.push(`BT /F2 9 Tf 140 ${y} Td (ADMINISTRATIVE DESCRIPTION) Tj ET`);
  ops.push(`BT /F2 9 Tf 420 ${y} Td (QTY) Tj ET`);
  ops.push(`BT /F2 9 Tf 460 ${y} Td (UNIT) Tj ET`);
  ops.push(`BT /F2 9 Tf 520 ${y} Td (TOTAL) Tj ET`);

  y -= 20;
  const items =
    Array.isArray(receipt.line_items) && receipt.line_items.length > 0
      ? receipt.line_items
      : [
          {
            service_code: 'ADMIN-SERVICE',
            description: 'Administrative Billing Statement',
            quantity: 1,
            unit_amount_minor: receipt.total_minor,
            unit_amount_usd: receipt.total_usd,
            line_total_minor: receipt.total_minor,
            line_total_usd: receipt.total_usd,
          },
        ];

  for (const item of items) {
    const rawDesc = String(item.description || '').replace(/[^\x20-\x7E]/g, '-');
    let line1 = rawDesc;
    let line2 = '';
    if (rawDesc.length > 54) {
      const splitIdx = rawDesc.lastIndexOf(' ', 54);
      const cut = splitIdx > 24 ? splitIdx : 54;
      line1 = rawDesc.slice(0, cut).trim();
      line2 = rawDesc.slice(cut).trim();
    }
    ops.push(`BT /F3 8.5 Tf 44 ${y} Td (${escapePdfString(item.service_code)}) Tj ET`);
    ops.push(`BT /F1 8.5 Tf 140 ${y} Td (${escapePdfString(line1)}) Tj ET`);
    ops.push(`BT /F1 8.5 Tf 424 ${y} Td (${escapePdfString(String(item.quantity))}) Tj ET`);
    ops.push(`BT /F1 8.5 Tf 460 ${y} Td (${escapePdfString(item.unit_amount_usd)}) Tj ET`);
    ops.push(`BT /F2 8.5 Tf 520 ${y} Td (${escapePdfString(item.line_total_usd)}) Tj ET`);
    if (line2) {
      y -= 12;
      ops.push(`BT /F1 8.5 Tf 140 ${y} Td (${escapePdfString(line2)}) Tj ET`);
    }
    y -= 16;
  }

  // Totals Box
  y -= 10;
  ops.push('0.82 0.86 0.91 RG 1 w');
  ops.push(`36 ${y} m 576 ${y} l S`);
  y -= 18;

  const totals: Array<[string, string]> = [
    ['Statement Original Total:', `${receipt.total_usd} ${receipt.currency}`],
    ['Total Amount Paid:', `${receipt.amount_paid_usd} ${receipt.currency}`],
    ['Total Amount Refunded:', `${receipt.amount_refunded_usd} ${receipt.currency}`],
    ['Remaining Balance Due:', `${receipt.balance_due_usd} ${receipt.currency}`],
  ];

  for (const [tLabel, tVal] of totals) {
    ops.push(`BT /F2 10 Tf 330 ${y} Td (${escapePdfString(tLabel)}) Tj ET`);
    ops.push(`BT /F2 10 Tf 495 ${y} Td (${escapePdfString(tVal)}) Tj ET`);
    y -= 16;
  }

  // Footer
  ops.push('0.40 0.45 0.53 rg');
  ops.push(
    'BT /F1 8 Tf 36 42 Td (Generated by PayPal AI Billing Kit Unified MCP Gateway - Zero PHI Administrative Ledger) Tj ET'
  );

  const streamContent = ops.join('\n');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n',
    `7 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return pdf;
}

export function encodeAsciiToBase64(ascii: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(ascii, 'utf8').toString('base64');
  }
  if (typeof btoa !== 'undefined') {
    return btoa(ascii);
  }
  return '';
}

export function generateReceiptPdfBytes(receipt: StructuredPaymentReceipt): Uint8Array {
  const str = generateReceiptPdfString(receipt);
  return new TextEncoder().encode(str);
}

export function generateReceiptPdfBase64(receipt: StructuredPaymentReceipt): string {
  return encodeAsciiToBase64(generateReceiptPdfString(receipt));
}
