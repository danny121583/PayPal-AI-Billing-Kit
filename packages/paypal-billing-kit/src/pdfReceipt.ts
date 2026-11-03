export interface StructuredPaymentReceiptItem {
  service_code: string;
  description: string;
  quantity: number;
  unit_amount_minor: number;
  unit_amount_usd: string;
  line_total_minor: number;
  line_total_usd: string;
}

export interface MerchantBrandingConfig {
  businessName: string;
  providerName?: string | null;
  hasLogo?: boolean;
  logoMonogram?: string | null;
  businessAddress?: string | null;
  supportEmail?: string | null;
  businessPhone?: string | null;
  businessWebsite?: string | null;
  receiptFooterMessage?: string | null;
  brandAccentRgb?: [number, number, number];
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
  subtotal_minor?: number;
  subtotal_usd?: string;
  tax_minor?: number;
  tax_usd?: string;
  discount_minor?: number;
  discount_usd?: string;
  total_minor: number;
  total_usd: string;
  amount_paid_minor: number;
  amount_paid_usd: string;
  amount_refunded_minor: number;
  amount_refunded_usd: string;
  net_paid_minor?: number;
  net_paid_usd?: string;
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
  card_brand?: string | null;
  card_last_digits?: string | null;
  settlement_verification:
    | 'paypal_sandbox_verified'
    | 'sample_demo_settlement_not_live_paypal';
  is_live_paypal_capture: boolean;
  verification_badge: string;
  document_title?: string;
  receipt_presentation_state?: string;
  paypal_attribution?: string | null;
  sandbox_transaction_label?: string | null;
  receipt_footer_text?: string;
  merchant_branding?: MerchantBrandingConfig;
  line_items: StructuredPaymentReceiptItem[];
  pdf_download_url?: string;
  pdf_base64?: string;
  pdf_byte_length?: number;
}

export const DEFAULT_ELECTRONIC_RECEIPT_FOOTER =
  'This receipt was generated electronically. Please retain it for your records.';

function escapePdfString(input: string): string {
  return String(input || '')
    .replace(/—|–/g, '-')
    .replace(/•/g, '*')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function formatUsdFromMinor(minor: number): string {
  return `$${(Number(minor || 0) / 100).toFixed(2)}`;
}

function formatReadableTimestamp(raw?: string | null): string {
  if (!raw) return 'Not Recorded';
  const trimmed = String(raw).trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  const datePart = parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (trimmed.length <= 10) {
    return `${datePart} (${trimmed})`;
  }
  const timePart = parsed.toISOString().slice(11, 16);
  return `${datePart} ${timePart} UTC`;
}

export function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const cleaned = String(text || '')
    .replace(/—|–/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [''];
  if (cleaned.length <= maxCharsPerLine) return [cleaned];

  const words = cleaned.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      if (word.length > maxCharsPerLine) {
        for (let i = 0; i < word.length; i += maxCharsPerLine) {
          lines.push(word.slice(i, i + maxCharsPerLine));
        }
      } else {
        current = word;
      }
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      if (word.length > maxCharsPerLine) {
        for (let i = 0; i < word.length; i += maxCharsPerLine) {
          const chunk = word.slice(i, i + maxCharsPerLine);
          if (chunk.length === maxCharsPerLine) {
            lines.push(chunk);
          } else {
            current = chunk;
          }
        }
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function stripInternalTerminologyFromDescription(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/—|–/g, '-')
    .replace(/\bADMIN-[A-Z0-9_-]+:\s*/g, '')
    .trim();
  return cleaned || 'Professional Service';
}

export function resolveReceiptPresentationState(receipt: StructuredPaymentReceipt): {
  documentTitle: string;
  presentationLabel: string;
  statusDisplay: string;
  isLive: boolean;
  isFullRefund: boolean;
  isPartialRefund: boolean;
  isAnyRefund: boolean;
  sandboxLabel: string | null;
  paypalAttribution: string | null;
} {
  const statusLower = String(receipt.status || '').toLowerCase();
  const paidMinor = Number(receipt.amount_paid_minor || 0);
  const refundedMinor = Number(receipt.amount_refunded_minor || 0);

  if (
    paidMinor <= 0 &&
    statusLower !== 'paid' &&
    statusLower !== 'refunded' &&
    statusLower !== 'partially_refunded'
  ) {
    throw new Error(
      'RECEIPT_UNAVAILABLE_UNPAID_INVOICE: Paid receipts cannot be generated for unpaid invoices.'
    );
  }

  const isLive = Boolean(receipt.is_live_paypal_capture);
  const isPartialRefund =
    statusLower === 'partially_refunded' ||
    (refundedMinor > 0 && paidMinor > 0 && refundedMinor < paidMinor);
  const isFullRefund =
    !isPartialRefund &&
    (statusLower === 'refunded' || (refundedMinor > 0 && refundedMinor >= paidMinor));
  const isAnyRefund = isPartialRefund || isFullRefund;

  if (!isLive) {
    return {
      documentTitle: isFullRefund
        ? 'Payment & Refund Receipt'
        : 'Sample Demo Receipt',
      presentationLabel: 'Sample Demo Receipt — Not a Real PayPal Payment',
      statusDisplay: isFullRefund
        ? 'Sample Demo (Refunded)'
        : isPartialRefund
          ? 'Sample Demo (Partially Refunded)'
          : 'Sample Demo (Not Live PayPal)',
      isLive: false,
      isFullRefund,
      isPartialRefund,
      isAnyRefund,
      sandboxLabel: 'Sample Demo Receipt — Not a Real PayPal Payment',
      paypalAttribution: null,
    };
  }

  if (isFullRefund) {
    return {
      documentTitle: 'Payment & Refund Receipt',
      presentationLabel: 'Payment & Refund Receipt — Refunded',
      statusDisplay: 'Refunded',
      isLive: true,
      isFullRefund: true,
      isPartialRefund: false,
      isAnyRefund: true,
      sandboxLabel: 'PayPal Sandbox Test Transaction',
      paypalAttribution: 'Payment processed through PayPal',
    };
  }

  if (isPartialRefund) {
    return {
      documentTitle: 'Payment Receipt',
      presentationLabel: 'Payment Receipt — Partially Refunded',
      statusDisplay: 'Partially Refunded',
      isLive: true,
      isFullRefund: false,
      isPartialRefund: true,
      isAnyRefund: true,
      sandboxLabel: 'PayPal Sandbox Test Transaction',
      paypalAttribution: 'Payment processed through PayPal',
    };
  }

  return {
    documentTitle: 'Payment Receipt',
    presentationLabel: 'Payment Receipt — Paid',
    statusDisplay: 'Paid',
    isLive: true,
    isFullRefund: false,
    isPartialRefund: false,
    isAnyRefund: false,
    sandboxLabel: 'PayPal Sandbox Test Transaction',
    paypalAttribution: 'Payment processed through PayPal',
  };
}

export function resolveMerchantBranding(
  receipt: StructuredPaymentReceipt
): MerchantBrandingConfig {
  const custom = receipt.merchant_branding;
  const businessName =
    custom?.businessName?.trim() ||
    receipt.organization_name?.trim() ||
    'Jenkins Wellness & Telehealth Practice';
  const providerName =
    custom?.providerName !== undefined
      ? custom.providerName
      : receipt.provider_name?.trim() || 'Dr. Sarah Jenkins';

  const initials = businessName
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return {
    businessName,
    providerName,
    hasLogo: Boolean(custom?.hasLogo),
    logoMonogram: custom?.logoMonogram || initials || 'JW',
    businessAddress: custom?.businessAddress ?? null,
    supportEmail:
      custom?.supportEmail !== undefined
        ? custom.supportEmail
        : businessName.includes('Jenkins')
          ? 'sarah.jenkins@demo.paypal-billing-kit.local'
          : null,
    businessPhone: custom?.businessPhone ?? null,
    businessWebsite: custom?.businessWebsite ?? null,
    receiptFooterMessage:
      custom?.receiptFooterMessage?.trim() || DEFAULT_ELECTRONIC_RECEIPT_FOOTER,
    brandAccentRgb: custom?.brandAccentRgb || [0.07, 0.23, 0.43],
  };
}

function resolveFriendlyPaymentMethodLabel(receipt: StructuredPaymentReceipt): string {
  if (!receipt.is_live_paypal_capture) {
    return 'Simulated Demo Settlement (Not a Real PayPal Payment)';
  }
  const sourceType = String(receipt.payment_source_type || '').toLowerCase();
  const rawLabel = String(receipt.payment_source_label || '');
  const brand = receipt.card_brand ? String(receipt.card_brand).toUpperCase() : null;
  const last4 = receipt.card_last_digits ? String(receipt.card_last_digits).slice(-4) : null;

  if (sourceType === 'paypal_card' || /card/i.test(rawLabel) || brand || last4) {
    if (brand && last4) {
      return `PayPal Card Checkout (${brand} ending in ${last4})`;
    }
    if (last4) {
      return `PayPal Card Checkout (Card ending in ${last4})`;
    }
    return 'PayPal Card Checkout';
  }
  return 'PayPal Wallet Checkout';
}

/**
 * Generates a clean, merchant-branded, multi-page-capable PDF 1.4 document (US Letter 612x792pt, A4 safe margins)
 * with zero internal MCP/database/PHI terminology.
 */
export function generateReceiptPdfString(receipt: StructuredPaymentReceipt): string {
  const state = resolveReceiptPresentationState(receipt);
  const branding = resolveMerchantBranding(receipt);
  const [accentR, accentG, accentB] = branding.brandAccentRgb || [0.07, 0.23, 0.43];

  const pagesOps: string[][] = [];
  let ops: string[] = [];

  const startNewPage = (isContinuation: boolean) => {
    if (ops.length > 0) {
      pagesOps.push(ops);
    }
    ops = [];

    // Top Accent Bar
    ops.push(`${accentR.toFixed(2)} ${accentG.toFixed(2)} ${accentB.toFixed(2)} rg`);
    ops.push('36 750 540 6 re f');

    let headerLeftX = 36;
    let cursorY = 724;

    if (branding.hasLogo) {
      // Draw Merchant Monogram Logo Badge
      ops.push(`${accentR.toFixed(2)} ${accentG.toFixed(2)} ${accentB.toFixed(2)} rg`);
      ops.push('36 698 38 38 re f');
      ops.push('1 1 1 rg');
      ops.push(
        `BT /F2 13 Tf 44 712 Td (${escapePdfString(
          String(branding.logoMonogram || 'JW').slice(0, 3)
        )}) Tj ET`
      );
      headerLeftX = 84;
    }

    // Merchant Business Name (wrapped cleanly so long names never overlap right side)
    ops.push('0.07 0.10 0.16 rg');
    const merchantLines = wrapTextLines(branding.businessName, branding.hasLogo ? 38 : 42);
    for (const mLine of merchantLines) {
      ops.push(`BT /F2 14 Tf ${headerLeftX} ${cursorY} Td (${escapePdfString(mLine)}) Tj ET`);
      cursorY -= 16;
    }

    if (branding.providerName) {
      ops.push('0.28 0.33 0.41 rg');
      ops.push(
        `BT /F1 9.5 Tf ${headerLeftX} ${cursorY + 2} Td (${escapePdfString(
          `Provider: ${branding.providerName}`
        )}) Tj ET`
      );
      cursorY -= 13;
    }

    const contactParts: string[] = [];
    if (branding.businessAddress) contactParts.push(branding.businessAddress);
    if (branding.businessPhone) contactParts.push(`Tel: ${branding.businessPhone}`);
    if (branding.supportEmail) contactParts.push(branding.supportEmail);
    if (branding.businessWebsite) contactParts.push(branding.businessWebsite);

    if (contactParts.length > 0 && !isContinuation) {
      const contactLines = wrapTextLines(contactParts.join('  |  '), 52);
      ops.push('0.38 0.43 0.50 rg');
      for (const cLine of contactLines.slice(0, 2)) {
        ops.push(`BT /F1 8.5 Tf ${headerLeftX} ${cursorY + 2} Td (${escapePdfString(cLine)}) Tj ET`);
        cursorY -= 11;
      }
    }

    // Right-Aligned Document Title & Receipt Number
    ops.push(`${accentR.toFixed(2)} ${accentG.toFixed(2)} ${accentB.toFixed(2)} rg`);
    const docTitleText = isContinuation
      ? `${state.documentTitle} (Continued)`
      : state.documentTitle;
    ops.push(`BT /F2 13 Tf 360 724 Td (${escapePdfString(docTitleText)}) Tj ET`);

    ops.push('0.20 0.25 0.33 rg');
    ops.push(
      `BT /F2 9 Tf 360 708 Td (${escapePdfString(state.presentationLabel)}) Tj ET`
    );
    ops.push(
      `BT /F1 8.5 Tf 360 694 Td (${escapePdfString(
        `Receipt #: ${receipt.receipt_number}`
      )}) Tj ET`
    );
    ops.push(
      `BT /F1 8.5 Tf 360 681 Td (${escapePdfString(
        `Statement #: ${receipt.invoice_number}`
      )}) Tj ET`
    );

    const headerBottomY = Math.min(cursorY, 672);

    // Status & Sandbox Identification Banner
    const bannerY = headerBottomY - 30;
    if (state.isLive) {
      if (state.isAnyRefund) {
        ops.push('0.94 0.96 1.00 rg');
        ops.push(`36 ${bannerY} 540 24 re f`);
        ops.push('0.12 0.25 0.62 rg');
      } else {
        ops.push('0.93 0.98 0.95 rg');
        ops.push(`36 ${bannerY} 540 24 re f`);
        ops.push('0.04 0.38 0.26 rg');
      }
      ops.push(
        `BT /F2 9 Tf 46 ${bannerY + 8} Td (${escapePdfString(
          `${state.presentationLabel}  |  PayPal Sandbox Test Transaction`
        )}) Tj ET`
      );
    } else {
      ops.push('1.00 0.97 0.91 rg');
      ops.push(`36 ${bannerY} 540 24 re f`);
      ops.push('0.58 0.25 0.05 rg');
      ops.push(
        `BT /F2 9 Tf 46 ${bannerY + 8} Td (${escapePdfString(
          'Sample Demo Receipt - Not a Real PayPal Payment (Simulated Settlement)'
        )}) Tj ET`
      );
    }

    return bannerY - 14;
  };

  let y = startNewPage(false);

  // Transaction Summary Box
  const paidMinor = Number(receipt.amount_paid_minor || 0);
  const refundedMinor = Number(receipt.amount_refunded_minor || 0);
  const netPaidMinor =
    receipt.net_paid_minor !== undefined
      ? Number(receipt.net_paid_minor)
      : Math.max(paidMinor - refundedMinor, 0);
  const netPaidUsd = receipt.net_paid_usd || formatUsdFromMinor(netPaidMinor);

  const summaryBoxHeight = state.isAnyRefund ? 84 : 70;
  const summaryBoxBottom = y - summaryBoxHeight;
  ops.push('0.97 0.98 0.99 rg');
  ops.push(`36 ${summaryBoxBottom} 540 ${summaryBoxHeight} re f`);
  ops.push('0.85 0.88 0.92 RG 0.75 w');
  ops.push(`36 ${summaryBoxBottom} 540 ${summaryBoxHeight} re S`);

  ops.push('0.07 0.10 0.16 rg');
  ops.push(`BT /F2 9.5 Tf 48 ${y - 16} Td (TRANSACTION SUMMARY) Tj ET`);

  const customerLines = wrapTextLines(receipt.customer_name || 'Customer', 26);

  // Left Column of Summary
  let leftY = y - 32;
  const leftSummaryRows: Array<[string, string]> = [
    ['Customer:', customerLines[0]],
    ...(receipt.customer_email_masked
      ? [['Account Email:', String(receipt.customer_email_masked).slice(0, 34)] as [string, string]]
      : []),
    ['Statement Number:', `#${receipt.invoice_number}`],
    ['Service Date:', formatReadableTimestamp(receipt.service_date)],
  ];
  const adjustedSummaryHeight = Math.max(leftSummaryRows.length, state.isAnyRefund ? 4 : 3) * 14 + 26;
  const actualBoxBottom = y - adjustedSummaryHeight;
  // Redraw summary box to fit exact row count cleanly
  ops.push('0.97 0.98 0.99 rg');
  ops.push(`36 ${actualBoxBottom} 540 ${adjustedSummaryHeight} re f`);
  ops.push('0.85 0.88 0.92 RG 0.75 w');
  ops.push(`36 ${actualBoxBottom} 540 ${adjustedSummaryHeight} re S`);
  ops.push('0.07 0.10 0.16 rg');
  ops.push(`BT /F2 9.5 Tf 48 ${y - 16} Td (TRANSACTION SUMMARY) Tj ET`);

  for (const [sLabel, sVal] of leftSummaryRows) {
    ops.push('0.32 0.37 0.45 rg');
    ops.push(`BT /F2 8.5 Tf 48 ${leftY} Td (${escapePdfString(sLabel)}) Tj ET`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F1 8.5 Tf 134 ${leftY} Td (${escapePdfString(sVal)}) Tj ET`);
    leftY -= 14;
  }

  // Right Column of Summary
  let rightY = y - 32;
  const rightSummaryRows: Array<[string, string]> = [
    ['Amount Paid:', `${receipt.amount_paid_usd} ${receipt.currency}`],
    ...(state.isAnyRefund
      ? [
          [
            'Amount Refunded:',
            `${receipt.amount_refunded_usd} (Net: ${netPaidUsd})`,
          ] as [string, string],
        ]
      : []),
    ['Payment Date:', formatReadableTimestamp(receipt.paid_at)],
    ['Payment Status:', state.statusDisplay],
  ];
  for (const [sLabel, sVal] of rightSummaryRows) {
    ops.push('0.32 0.37 0.45 rg');
    ops.push(`BT /F2 8.5 Tf 325 ${rightY} Td (${escapePdfString(sLabel)}) Tj ET`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F2 8.5 Tf 412 ${rightY} Td (${escapePdfString(sVal)}) Tj ET`);
    rightY -= 14;
  }

  y = actualBoxBottom - 18;

  // Itemized Payment Details Table Header
  const drawTableHeader = (headerY: number) => {
    ops.push('0.94 0.96 0.98 rg');
    ops.push(`36 ${headerY - 6} 540 20 re f`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F2 8.5 Tf 46 ${headerY} Td (ITEMIZED SERVICE DESCRIPTION) Tj ET`);
    ops.push(`BT /F2 8.5 Tf 395 ${headerY} Td (QTY) Tj ET`);
    ops.push(`BT /F2 8.5 Tf 445 ${headerY} Td (UNIT PRICE) Tj ET`);
    ops.push(`BT /F2 8.5 Tf 522 ${headerY} Td (AMOUNT) Tj ET`);
    return headerY - 20;
  };

  y = drawTableHeader(y);

  const items =
    Array.isArray(receipt.line_items) && receipt.line_items.length > 0
      ? receipt.line_items
      : [
          {
            service_code: 'SERVICE',
            description: 'Professional Service Statement',
            quantity: 1,
            unit_amount_minor: receipt.total_minor,
            unit_amount_usd: receipt.total_usd,
            line_total_minor: receipt.total_minor,
            line_total_usd: receipt.total_usd,
          },
        ];

  for (const item of items) {
    const cleanDesc = stripInternalTerminologyFromDescription(item.description);
    const wrappedDescLines = wrapTextLines(cleanDesc, 60);
    const requiredRowHeight = Math.max(wrappedDescLines.length * 12 + 6, 18);

    if (y - requiredRowHeight < 210) {
      y = startNewPage(true);
      y = drawTableHeader(y);
    }

    ops.push('0.07 0.10 0.16 rg');
    ops.push(
      `BT /F1 9 Tf 46 ${y} Td (${escapePdfString(wrappedDescLines[0] || 'Service')}) Tj ET`
    );
    ops.push(`BT /F1 9 Tf 400 ${y} Td (${escapePdfString(String(item.quantity || 1))}) Tj ET`);
    ops.push(`BT /F1 9 Tf 450 ${y} Td (${escapePdfString(String(item.unit_amount_usd || ''))}) Tj ET`);
    ops.push(`BT /F2 9 Tf 522 ${y} Td (${escapePdfString(String(item.line_total_usd || ''))}) Tj ET`);

    for (let idx = 1; idx < wrappedDescLines.length; idx++) {
      y -= 12;
      ops.push(
        `BT /F1 9 Tf 46 ${y} Td (${escapePdfString(wrappedDescLines[idx])}) Tj ET`
      );
    }

    y -= 8;
    ops.push('0.91 0.93 0.96 RG 0.5 w');
    ops.push(`36 ${y} m 576 ${y} l S`);
    y -= 14;
  }

  // Ensure space for Totals + Payment Verification Box
  if (y < 235) {
    y = startNewPage(true);
  }

  // Totals Section
  y -= 8;
  const subtotalMinor =
    receipt.subtotal_minor !== undefined ? Number(receipt.subtotal_minor) : receipt.total_minor;
  const subtotalUsd = receipt.subtotal_usd || formatUsdFromMinor(subtotalMinor);
  const discountMinor = Number(receipt.discount_minor || 0);
  const taxMinor = Number(receipt.tax_minor || 0);

  const totalsRows: Array<[string, string, boolean]> = [
    ['Subtotal:', `${subtotalUsd} ${receipt.currency}`, false],
  ];
  if (discountMinor > 0) {
    totalsRows.push([
      'Discounts:',
      `-${receipt.discount_usd || formatUsdFromMinor(discountMinor)} ${receipt.currency}`,
      false,
    ]);
  }
  if (taxMinor > 0) {
    totalsRows.push([
      'Taxes:',
      `${receipt.tax_usd || formatUsdFromMinor(taxMinor)} ${receipt.currency}`,
      false,
    ]);
  }
  totalsRows.push(['Total Charged:', `${receipt.total_usd} ${receipt.currency}`, true]);
  totalsRows.push(['Total Paid:', `${receipt.amount_paid_usd} ${receipt.currency}`, true]);
  if (state.isAnyRefund) {
    totalsRows.push([
      'Total Refunded:',
      `${receipt.amount_refunded_usd} ${receipt.currency}`,
      true,
    ]);
    if (state.isPartialRefund) {
      totalsRows.push([
        'Net Payment Retained:',
        `${netPaidUsd} ${receipt.currency}`,
        true,
      ]);
    }
  }
  totalsRows.push([
    'Remaining Balance:',
    `${receipt.balance_due_usd} ${receipt.currency}`,
    true,
  ]);

  for (const [tLabel, tVal, isBold] of totalsRows) {
    ops.push('0.25 0.30 0.38 rg');
    ops.push(
      `BT /${isBold ? 'F2' : 'F1'} 9.5 Tf 340 ${y} Td (${escapePdfString(tLabel)}) Tj ET`
    );
    ops.push('0.07 0.10 0.16 rg');
    ops.push(
      `BT /${isBold ? 'F2' : 'F1'} 9.5 Tf 490 ${y} Td (${escapePdfString(tVal)}) Tj ET`
    );
    y -= 14;
  }

  // Payment Verification Box
  y -= 10;
  const verificationRows: Array<[string, string]> = [
    ['Payment Method:', resolveFriendlyPaymentMethodLabel(receipt)],
  ];
  if (receipt.card_brand || receipt.card_last_digits) {
    const brand = receipt.card_brand ? String(receipt.card_brand).toUpperCase() : 'Card';
    const last4 = receipt.card_last_digits
      ? `ending in ${String(receipt.card_last_digits).slice(-4)}`
      : '';
    verificationRows.push(['Card Used:', `${brand} ${last4}`.trim()]);
  }
  if (state.isLive) {
    verificationRows.push([
      'PayPal Capture ID:',
      String(receipt.paypal_capture_id || receipt.settlement_reference),
    ]);
    if (receipt.paypal_order_id) {
      verificationRows.push(['PayPal Order ID:', String(receipt.paypal_order_id)]);
    }
  } else {
    verificationRows.push([
      'Demo Reference:',
      `${receipt.settlement_reference} (Sample Demo Receipt - Not a Real PayPal Payment)`,
    ]);
  }
  verificationRows.push(['Payment Date:', formatReadableTimestamp(receipt.paid_at)]);

  if (state.isAnyRefund) {
    const refundIdText = receipt.paypal_refund_id
      ? String(receipt.paypal_refund_id)
      : 'Recorded Refund';
    const refundDateText = receipt.refunded_at
      ? ` (${formatReadableTimestamp(receipt.refunded_at)})`
      : '';
    verificationRows.push([
      'Refund ID & Date:',
      `${refundIdText}${refundDateText} - ${receipt.amount_refunded_usd} ${receipt.currency}`,
    ]);
  }

  verificationRows.push([
    'Transaction Status:',
    state.isLive
      ? `${state.statusDisplay} (PayPal Sandbox Test Transaction)`
      : 'Sample Demo Receipt - Not a Real PayPal Payment',
  ]);

  const verBoxHeight = verificationRows.length * 13 + (state.paypalAttribution ? 36 : 22);
  const verBoxBottom = y - verBoxHeight;

  ops.push('0.97 0.98 0.99 rg');
  ops.push(`36 ${verBoxBottom} 540 ${verBoxHeight} re f`);
  ops.push('0.85 0.88 0.92 RG 0.75 w');
  ops.push(`36 ${verBoxBottom} 540 ${verBoxHeight} re S`);

  ops.push('0.07 0.10 0.16 rg');
  let verY = y - 15;
  ops.push(`BT /F2 9 Tf 48 ${verY} Td (PAYMENT VERIFICATION) Tj ET`);
  if (state.paypalAttribution) {
    ops.push('0.00 0.19 0.53 rg');
    ops.push(
      `BT /F2 8.5 Tf 395 ${verY} Td (${escapePdfString(state.paypalAttribution)}) Tj ET`
    );
  }
  verY -= 15;

  for (const [vLabel, vVal] of verificationRows) {
    ops.push('0.32 0.37 0.45 rg');
    ops.push(`BT /F2 8.5 Tf 48 ${verY} Td (${escapePdfString(vLabel)}) Tj ET`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F1 8.5 Tf 175 ${verY} Td (${escapePdfString(vVal)}) Tj ET`);
    verY -= 13;
  }

  pagesOps.push(ops);

  // Add Footer to every page
  const totalPages = pagesOps.length;
  const footerMessage =
    branding.receiptFooterMessage || DEFAULT_ELECTRONIC_RECEIPT_FOOTER;
  const supportFooterParts: string[] = [];
  if (branding.supportEmail) {
    supportFooterParts.push(`Customer Support: ${branding.supportEmail}`);
  }
  if (branding.businessPhone) {
    supportFooterParts.push(`Tel: ${branding.businessPhone}`);
  }
  const supportLine = supportFooterParts.join('  |  ');

  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    const pOps = pagesOps[pIdx];
    pOps.push('0.85 0.88 0.92 RG 0.5 w');
    pOps.push('36 58 m 576 58 l S');
    pOps.push('0.35 0.40 0.48 rg');
    pOps.push(`BT /F1 8.5 Tf 36 44 Td (${escapePdfString(footerMessage)}) Tj ET`);
    if (supportLine) {
      pOps.push(`BT /F1 8 Tf 36 32 Td (${escapePdfString(supportLine)}) Tj ET`);
    }
    if (totalPages > 1) {
      pOps.push(
        `BT /F1 8 Tf 520 44 Td (${escapePdfString(
          `Page ${pIdx + 1} of ${totalPages}`
        )}) Tj ET`
      );
    }
  }

  // Assemble Multi-Page PDF 1.4 Objects
  // Object 1: Catalog
  // Object 2: Pages
  // Objects 3..5: Fonts (/F1 Helvetica, /F2 Helvetica-Bold, /F3 Courier)
  // Objects 6..: Page + Content Stream pairs
  const fontObjF1 = 3;
  const fontObjF2 = 4;
  const fontObjF3 = 5;
  const firstPageObjNum = 6;
  const pageObjNums: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    pageObjNums.push(firstPageObjNum + i * 2);
  }

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums
      .map((n) => `${n} 0 R`)
      .join(' ')}] /Count ${totalPages} >>\nendobj\n`,
    `${fontObjF1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    `${fontObjF2} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`,
    `${fontObjF3} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`,
  ];

  for (let i = 0; i < totalPages; i++) {
    const pageObjId = firstPageObjNum + i * 2;
    const contentObjId = pageObjId + 1;
    const streamContent = pagesOps[i].join('\n');
    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjF1} 0 R /F2 ${fontObjF2} 0 R /F3 ${fontObjF3} 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`
    );
  }

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
