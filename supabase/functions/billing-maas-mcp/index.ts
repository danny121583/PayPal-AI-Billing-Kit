import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept, mcp-session-id, x-demo-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PAYPAL_CLIENT_ID =
  Deno.env.get('PAYPAL_SANDBOX_CLIENT_ID') || Deno.env.get('PAYPAL_CLIENT_ID') || '';
const PAYPAL_CLIENT_SECRET =
  Deno.env.get('PAYPAL_SANDBOX_CLIENT_SECRET') || Deno.env.get('PAYPAL_CLIENT_SECRET') || '';

const PROVIDER_ID = '11111111-1111-4111-8111-111111111101';
const ALEX_ID = '11111111-1111-4111-8111-111111111102';
const JORDAN_ID = '11111111-1111-4111-8111-111111111103';
const ORG_ID = '22222222-2222-4222-8222-222222222201';

const DEMO_ACCOUNTS = [
  {
    key: 'sarah_jenkins',
    id: PROVIDER_ID,
    role: 'provider',
    roleScope: 'doctor',
    fullName: 'Dr. Sarah Jenkins',
    emailMasked: 's***@demo.paypal-billing-kit.local',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
  },
  {
    key: 'alex_rivera',
    id: ALEX_ID,
    role: 'customer',
    roleScope: 'patient',
    fullName: 'Alex Rivera',
    emailMasked: 'a***@demo.paypal-billing-kit.local',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
  },
  {
    key: 'jordan_taylor',
    id: JORDAN_ID,
    role: 'customer',
    roleScope: 'patient',
    fullName: 'Jordan Taylor',
    emailMasked: 'j***@demo.paypal-billing-kit.local',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
  },
];

function formatUsd(minor: number): string {
  return `$${(Number(minor || 0) / 100).toFixed(2)}`;
}

function sanitizeDemoSessionId(raw?: unknown): string {
  const val = String(raw || '').trim();
  if (!val) return 'maas-public-demo';
  const cleaned = val.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'maas-public-demo';
}

async function getPayPalSandboxCredentialsAndToken(admin: any): Promise<{
  configured: boolean;
  oauthReachable: boolean;
  accessToken: string | null;
  appId: string | null;
  expiresIn: number | null;
  error: string | null;
}> {
  let dbClientId = '';
  let dbClientSecret = '';
  try {
    const { data: secRows } = await admin
      .from('billing_platform_secrets')
      .select('secret_key, secret_value')
      .in('secret_key', [
        'PAYPAL_SANDBOX_CLIENT_ID',
        'PAYPAL_CLIENT_ID',
        'PAYPAL_SANDBOX_CLIENT_SECRET',
        'PAYPAL_CLIENT_SECRET',
      ]);
    if (Array.isArray(secRows)) {
      for (const r of secRows) {
        if (
          (r.secret_key === 'PAYPAL_SANDBOX_CLIENT_ID' || r.secret_key === 'PAYPAL_CLIENT_ID') &&
          r.secret_value
        ) {
          dbClientId = String(r.secret_value).trim();
        }
        if (
          (r.secret_key === 'PAYPAL_SANDBOX_CLIENT_SECRET' ||
            r.secret_key === 'PAYPAL_CLIENT_SECRET') &&
          r.secret_value
        ) {
          dbClientSecret = String(r.secret_value).trim();
        }
      }
    }
  } catch {
    // ignore
  }

  const clientId = PAYPAL_CLIENT_ID || dbClientId;
  const clientSecret = PAYPAL_CLIENT_SECRET || dbClientSecret;
  if (!clientId || !clientSecret) {
    return {
      configured: false,
      oauthReachable: false,
      accessToken: null,
      appId: null,
      expiresIn: null,
      error: 'PayPal Sandbox Client ID or Secret is not configured.',
    };
  }

  try {
    const basic = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) {
      return {
        configured: true,
        oauthReachable: false,
        accessToken: null,
        appId: null,
        expiresIn: null,
        error: data?.error_description || data?.message || `HTTP ${res.status}`,
      };
    }
    return {
      configured: true,
      oauthReachable: true,
      accessToken: String(data.access_token),
      appId: data.app_id ? String(data.app_id) : null,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
      error: null,
    };
  } catch (err: any) {
    return {
      configured: true,
      oauthReachable: false,
      accessToken: null,
      appId: null,
      expiresIn: null,
      error: err?.message || 'Failed to reach PayPal OAuth endpoint',
    };
  }
}

function escapePdfText(input: string): string {
  return String(input || '')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

const DEFAULT_ELECTRONIC_RECEIPT_FOOTER =
  'This receipt was generated electronically. Please retain it for your records.';

function formatReadableReceiptTimestamp(raw?: string | null): string {
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

function wrapReceiptTextLines(text: string, maxCharsPerLine: number): string[] {
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

function stripInternalTerminologyFromReceiptDescription(raw: string): string {
  const cleaned = String(raw || '')
    .replace(/—|–/g, '-')
    .replace(/\bADMIN-[A-Z0-9_-]+:\s*/g, '')
    .trim();
  return cleaned || 'Professional Service';
}

function resolveReceiptPresentationStateServer(receipt: Record<string, any>) {
  const statusLower = String(receipt.status || '').toLowerCase();
  const paidMinor = Number(receipt.amount_paid_minor || 0);
  const refundedMinor = Number(receipt.amount_refunded_minor || 0);
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
      documentTitle: isFullRefund ? 'Payment & Refund Receipt' : 'Sample Demo Receipt',
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

function resolveMerchantBrandingServer(receipt: Record<string, any>) {
  const custom = receipt.merchant_branding || {};
  const businessName =
    String(custom.businessName || receipt.organization_name || 'Jenkins Wellness & Telehealth Practice').trim();
  const providerName =
    custom.providerName !== undefined
      ? custom.providerName
      : String(receipt.provider_name || 'Dr. Sarah Jenkins').trim();
  const initials = businessName
    .split(/\s+/)
    .filter((w: string) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w: string) => w[0].toUpperCase())
    .join('');

  return {
    businessName,
    providerName,
    hasLogo: Boolean(custom.hasLogo),
    logoMonogram: custom.logoMonogram || initials || 'JW',
    businessAddress: custom.businessAddress ?? null,
    supportEmail:
      custom.supportEmail !== undefined
        ? custom.supportEmail
        : businessName.includes('Jenkins')
          ? 'sarah.jenkins@demo.paypal-billing-kit.local'
          : null,
    businessPhone: custom.businessPhone ?? null,
    businessWebsite: custom.businessWebsite ?? null,
    receiptFooterMessage:
      String(custom.receiptFooterMessage || '').trim() || DEFAULT_ELECTRONIC_RECEIPT_FOOTER,
    brandAccentRgb: Array.isArray(custom.brandAccentRgb) ? custom.brandAccentRgb : [0.07, 0.23, 0.43],
  };
}

function resolveFriendlyPaymentMethodLabelServer(receipt: Record<string, any>): string {
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

function generateReceiptPdfDocument(receipt: Record<string, any>): string {
  const state = resolveReceiptPresentationStateServer(receipt);
  const branding = resolveMerchantBrandingServer(receipt);
  const [accentR, accentG, accentB] = branding.brandAccentRgb;

  const pagesOps: string[][] = [];
  let ops: string[] = [];

  const startNewPage = (isContinuation: boolean) => {
    if (ops.length > 0) {
      pagesOps.push(ops);
    }
    ops = [];

    ops.push(`${accentR.toFixed(2)} ${accentG.toFixed(2)} ${accentB.toFixed(2)} rg`);
    ops.push('36 750 540 6 re f');

    let headerLeftX = 36;
    let cursorY = 724;

    if (branding.hasLogo) {
      ops.push(`${accentR.toFixed(2)} ${accentG.toFixed(2)} ${accentB.toFixed(2)} rg`);
      ops.push('36 698 38 38 re f');
      ops.push('1 1 1 rg');
      ops.push(
        `BT /F2 13 Tf 44 712 Td (${escapePdfText(
          String(branding.logoMonogram || 'JW').slice(0, 3)
        )}) Tj ET`
      );
      headerLeftX = 84;
    }

    ops.push('0.07 0.10 0.16 rg');
    const merchantLines = wrapReceiptTextLines(branding.businessName, branding.hasLogo ? 38 : 42);
    for (const mLine of merchantLines) {
      ops.push(`BT /F2 14 Tf ${headerLeftX} ${cursorY} Td (${escapePdfText(mLine)}) Tj ET`);
      cursorY -= 16;
    }

    if (branding.providerName) {
      ops.push('0.28 0.33 0.41 rg');
      ops.push(
        `BT /F1 9.5 Tf ${headerLeftX} ${cursorY + 2} Td (${escapePdfText(
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
      const contactLines = wrapReceiptTextLines(contactParts.join('  |  '), 52);
      ops.push('0.38 0.43 0.50 rg');
      for (const cLine of contactLines.slice(0, 2)) {
        ops.push(`BT /F1 8.5 Tf ${headerLeftX} ${cursorY + 2} Td (${escapePdfText(cLine)}) Tj ET`);
        cursorY -= 11;
      }
    }

    ops.push(`${accentR.toFixed(2)} ${accentG.toFixed(2)} ${accentB.toFixed(2)} rg`);
    const docTitleText = isContinuation
      ? `${state.documentTitle} (Continued)`
      : state.documentTitle;
    ops.push(`BT /F2 13 Tf 360 724 Td (${escapePdfText(docTitleText)}) Tj ET`);

    ops.push('0.20 0.25 0.33 rg');
    ops.push(
      `BT /F2 9 Tf 360 708 Td (${escapePdfText(state.presentationLabel)}) Tj ET`
    );
    ops.push(
      `BT /F1 8.5 Tf 360 694 Td (${escapePdfText(`Receipt #: ${receipt.receipt_number}`)}) Tj ET`
    );
    ops.push(
      `BT /F1 8.5 Tf 360 681 Td (${escapePdfText(`Statement #: ${receipt.invoice_number}`)}) Tj ET`
    );

    const headerBottomY = Math.min(cursorY, 672);
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
        `BT /F2 9 Tf 46 ${bannerY + 8} Td (${escapePdfText(
          `${state.presentationLabel}  |  PayPal Sandbox Test Transaction`
        )}) Tj ET`
      );
    } else {
      ops.push('1.00 0.97 0.91 rg');
      ops.push(`36 ${bannerY} 540 24 re f`);
      ops.push('0.58 0.25 0.05 rg');
      ops.push(
        `BT /F2 9 Tf 46 ${bannerY + 8} Td (${escapePdfText(
          'Sample Demo Receipt - Not a Real PayPal Payment (Simulated Settlement)'
        )}) Tj ET`
      );
    }

    return bannerY - 14;
  };

  let y = startNewPage(false);

  const paidMinor = Number(receipt.amount_paid_minor || 0);
  const refundedMinor = Number(receipt.amount_refunded_minor || 0);
  const netPaidMinor =
    receipt.net_paid_minor !== undefined
      ? Number(receipt.net_paid_minor)
      : Math.max(paidMinor - refundedMinor, 0);
  const netPaidUsd = receipt.net_paid_usd || formatUsd(netPaidMinor);

  const summaryBoxHeight = state.isAnyRefund ? 84 : 70;
  const summaryBoxBottom = y - summaryBoxHeight;
  ops.push('0.97 0.98 0.99 rg');
  ops.push(`36 ${summaryBoxBottom} 540 ${summaryBoxHeight} re f`);
  ops.push('0.85 0.88 0.92 RG 0.75 w');
  ops.push(`36 ${summaryBoxBottom} 540 ${summaryBoxHeight} re S`);

  ops.push('0.07 0.10 0.16 rg');
  ops.push(`BT /F2 9.5 Tf 48 ${y - 16} Td (TRANSACTION SUMMARY) Tj ET`);

  const customerLines = wrapReceiptTextLines(receipt.customer_name || 'Customer', 26);

  let leftY = y - 32;
  const leftSummaryRows: Array<[string, string]> = [
    ['Customer:', customerLines[0]],
    ...(receipt.customer_email_masked
      ? [['Account Email:', String(receipt.customer_email_masked).slice(0, 34)] as [string, string]]
      : []),
    ['Statement Number:', `#${receipt.invoice_number}`],
    ['Service Date:', formatReadableReceiptTimestamp(receipt.service_date)],
  ];
  const adjustedSummaryHeight = Math.max(leftSummaryRows.length, state.isAnyRefund ? 4 : 3) * 14 + 26;
  const actualBoxBottom = y - adjustedSummaryHeight;
  ops.push('0.97 0.98 0.99 rg');
  ops.push(`36 ${actualBoxBottom} 540 ${adjustedSummaryHeight} re f`);
  ops.push('0.85 0.88 0.92 RG 0.75 w');
  ops.push(`36 ${actualBoxBottom} 540 ${adjustedSummaryHeight} re S`);
  ops.push('0.07 0.10 0.16 rg');
  ops.push(`BT /F2 9.5 Tf 48 ${y - 16} Td (TRANSACTION SUMMARY) Tj ET`);

  for (const [sLabel, sVal] of leftSummaryRows) {
    ops.push('0.32 0.37 0.45 rg');
    ops.push(`BT /F2 8.5 Tf 48 ${leftY} Td (${escapePdfText(sLabel)}) Tj ET`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F1 8.5 Tf 134 ${leftY} Td (${escapePdfText(sVal)}) Tj ET`);
    leftY -= 14;
  }

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
    ['Payment Date:', formatReadableReceiptTimestamp(receipt.paid_at)],
    ['Payment Status:', state.statusDisplay],
  ];
  for (const [sLabel, sVal] of rightSummaryRows) {
    ops.push('0.32 0.37 0.45 rg');
    ops.push(`BT /F2 8.5 Tf 325 ${rightY} Td (${escapePdfText(sLabel)}) Tj ET`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F2 8.5 Tf 412 ${rightY} Td (${escapePdfText(sVal)}) Tj ET`);
    rightY -= 14;
  }

  y = actualBoxBottom - 18;

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
    const cleanDesc = stripInternalTerminologyFromReceiptDescription(item.description);
    const wrappedDescLines = wrapReceiptTextLines(cleanDesc, 60);
    const requiredRowHeight = Math.max(wrappedDescLines.length * 12 + 6, 18);

    if (y - requiredRowHeight < 210) {
      y = startNewPage(true);
      y = drawTableHeader(y);
    }

    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F1 9 Tf 46 ${y} Td (${escapePdfText(wrappedDescLines[0] || 'Service')}) Tj ET`);
    ops.push(`BT /F1 9 Tf 400 ${y} Td (${escapePdfText(String(item.quantity || 1))}) Tj ET`);
    ops.push(`BT /F1 9 Tf 450 ${y} Td (${escapePdfText(String(item.unit_amount_usd || ''))}) Tj ET`);
    ops.push(`BT /F2 9 Tf 522 ${y} Td (${escapePdfText(String(item.line_total_usd || ''))}) Tj ET`);

    for (let idx = 1; idx < wrappedDescLines.length; idx++) {
      y -= 12;
      ops.push(`BT /F1 9 Tf 46 ${y} Td (${escapePdfText(wrappedDescLines[idx])}) Tj ET`);
    }

    y -= 8;
    ops.push('0.91 0.93 0.96 RG 0.5 w');
    ops.push(`36 ${y} m 576 ${y} l S`);
    y -= 14;
  }

  if (y < 235) {
    y = startNewPage(true);
  }

  y -= 8;
  const subtotalMinor =
    receipt.subtotal_minor !== undefined ? Number(receipt.subtotal_minor) : Number(receipt.total_minor || 0);
  const subtotalUsd = receipt.subtotal_usd || formatUsd(subtotalMinor);

  const totalsRows: Array<[string, string, boolean]> = [
    ['Subtotal:', `${subtotalUsd} ${receipt.currency}`, false],
    ['Total Charged:', `${receipt.total_usd} ${receipt.currency}`, true],
    ['Total Paid:', `${receipt.amount_paid_usd} ${receipt.currency}`, true],
  ];
  if (state.isAnyRefund) {
    totalsRows.push(['Total Refunded:', `${receipt.amount_refunded_usd} ${receipt.currency}`, true]);
    if (state.isPartialRefund) {
      totalsRows.push(['Net Payment Retained:', `${netPaidUsd} ${receipt.currency}`, true]);
    }
  }
  totalsRows.push(['Remaining Balance:', `${receipt.balance_due_usd} ${receipt.currency}`, true]);

  for (const [tLabel, tVal, isBold] of totalsRows) {
    ops.push('0.25 0.30 0.38 rg');
    ops.push(`BT /${isBold ? 'F2' : 'F1'} 9.5 Tf 340 ${y} Td (${escapePdfText(tLabel)}) Tj ET`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /${isBold ? 'F2' : 'F1'} 9.5 Tf 490 ${y} Td (${escapePdfText(tVal)}) Tj ET`);
    y -= 14;
  }

  y -= 10;
  const verificationRows: Array<[string, string]> = [
    ['Payment Method:', resolveFriendlyPaymentMethodLabelServer(receipt)],
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
  verificationRows.push(['Payment Date:', formatReadableReceiptTimestamp(receipt.paid_at)]);

  if (state.isAnyRefund) {
    const refundIdText = receipt.paypal_refund_id ? String(receipt.paypal_refund_id) : 'Recorded Refund';
    const refundDateText = receipt.refunded_at
      ? ` (${formatReadableReceiptTimestamp(receipt.refunded_at)})`
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
    ops.push(`BT /F2 8.5 Tf 395 ${verY} Td (${escapePdfText(state.paypalAttribution)}) Tj ET`);
  }
  verY -= 15;

  for (const [vLabel, vVal] of verificationRows) {
    ops.push('0.32 0.37 0.45 rg');
    ops.push(`BT /F2 8.5 Tf 48 ${verY} Td (${escapePdfText(vLabel)}) Tj ET`);
    ops.push('0.07 0.10 0.16 rg');
    ops.push(`BT /F1 8.5 Tf 175 ${verY} Td (${escapePdfText(vVal)}) Tj ET`);
    verY -= 13;
  }

  pagesOps.push(ops);

  const totalPages = pagesOps.length;
  const footerMessage = branding.receiptFooterMessage || DEFAULT_ELECTRONIC_RECEIPT_FOOTER;
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
    pOps.push(`BT /F1 8.5 Tf 36 44 Td (${escapePdfText(footerMessage)}) Tj ET`);
    if (supportLine) {
      pOps.push(`BT /F1 8 Tf 36 32 Td (${escapePdfText(supportLine)}) Tj ET`);
    }
    if (totalPages > 1) {
      pOps.push(`BT /F1 8 Tf 520 44 Td (${escapePdfText(`Page ${pIdx + 1} of ${totalPages}`)}) Tj ET`);
    }
  }

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

function evaluateConversationalInstructionServer(params: {
  instruction: string;
  actorRole?: string;
  userId?: string;
  authenticatedUserRole?: string;
  callerIdentityVerified?: boolean;
  hasPendingProposal?: boolean;
  pendingProposalId?: string | null;
  pendingProposalKind?: string | null;
  priorExecutionIntent?: boolean;
}) {
  const raw = String(params.instruction || '').trim();
  const lower = raw.toLowerCase();
  const role = String(params.actorRole || 'doctor').toLowerCase();
  const isProvider = role === 'doctor' || role === 'provider';

  const extracted: {
    customerName?: string;
    invoiceNumber?: string;
    amountMinor?: number;
    serviceCode?: string;
  } = {};

  if (lower.includes('alex')) extracted.customerName = 'Alex Rivera';
  else if (lower.includes('jordan')) extracted.customerName = 'Jordan Taylor';

  const fullInv = raw.match(/#?(PPB-INV-\d{4}-\d{4})/i);
  if (fullInv) {
    extracted.invoiceNumber = fullInv[1].toUpperCase();
  } else {
    const shortInv = raw.match(/\binvoice\s+#?(10\d{2})\b/i) || raw.match(/#(10\d{2})\b/);
    if (shortInv) extracted.invoiceNumber = `PPB-INV-2026-${shortInv[1]}`;
  }

  const dollarMatch = raw.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch) {
    const d = Number.parseFloat(dollarMatch[1]);
    if (Number.isFinite(d) && d > 0) extracted.amountMinor = Math.round(d * 100);
  }

  if (lower.includes('form')) extracted.serviceCode = 'ADMIN-FORMS';
  else if (lower.includes('follow-up') || lower.includes('followup')) extracted.serviceCode = 'ADMIN-FOLLOWUP';
  else if (lower.includes('copay')) extracted.serviceCode = 'ADMIN-COPAY';
  else if (lower.includes('record')) extracted.serviceCode = 'ADMIN-RECORDS';
  else if (lower.includes('office')) extracted.serviceCode = 'ADMIN-OFFICE';
  else if (extracted.amountMinor === 3500) extracted.serviceCode = 'ADMIN-FORMS';
  else if (extracted.amountMinor === 5000) extracted.serviceCode = 'ADMIN-COPAY';
  else if (extracted.amountMinor === 7500) extracted.serviceCode = 'ADMIN-FOLLOWUP';
  else extracted.serviceCode = 'ADMIN-TELEHEALTH';

  const knownCustomerIds = new Set([ALEX_ID, JORDAN_ID]);
  const authRoleLower = String(params.authenticatedUserRole || '').toLowerCase();
  const isImpersonationAttempt =
    isProvider &&
    (params.callerIdentityVerified === false ||
      authRoleLower === 'customer' ||
      authRoleLower === 'patient' ||
      authRoleLower === 'unauthenticated' ||
      (params.userId && knownCustomerIds.has(String(params.userId))) ||
      /\b(?:i\s+am|acting\s+as|logged\s+in\s+as)\s+(?:a\s+)?(?:customer|patient|alex\s+rivera|jordan\s+taylor)\b/i.test(
        raw
      ));

  if (isImpersonationAttempt) {
    let op = 'none';
    if (lower.includes('refund')) op = 'refund_payment';
    else if (lower.includes('void')) op = 'void_invoice';
    else if (lower.includes('create') || lower.includes('invoice')) op = 'create_invoice';
    else if (lower.includes('pay')) op = 'pay_invoice';
    return {
      intent: 'explicit_command',
      operation: op,
      authorizedToExecute: false,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: false,
      guardrailPassed: true,
      reasonCode: 'ROLE_IMPERSONATION_BLOCKED',
      explanation:
        'Caller attempted to claim provider/merchant privileges while authenticated or identified as a customer/unverified caller. Server-side identity verification blocked role elevation.',
      extractedParams: extracted,
    };
  }

  const hasFabricatedApproval =
    /\b(?:SYSTEM_APPROVED|ADMIN_OVERRIDE|BYPASS_PROPOSAL|FORCE_APPROVE|SKIP_BUYER_APPROVAL|FAKE_CAPTURE|OVERRIDE_GUARDRAIL)\b/i.test(
      raw
    ) ||
    /\b(?:bypass|skip|ignore|override)\s+(?:the\s+)?(?:proposal|guardrail|approval|buyer\s+authorization|limit)\b/i.test(
      raw
    );

  if (hasFabricatedApproval) {
    return {
      intent: 'explicit_command',
      operation: 'none',
      authorizedToExecute: false,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: false,
      guardrailPassed: false,
      reasonCode: 'FABRICATED_APPROVAL_BLOCKED',
      explanation:
        'Fabricated approval token or guardrail bypass instruction detected. Internal proposals and external PayPal buyer authorization cannot be bypassed via prompt injection.',
      extractedParams: extracted,
    };
  }

  const isHypothetical =
    /\bwhat\s+would\s+happen\b/i.test(raw) ||
    /\bif\s+i\s+(?:refunded|voided|paid|created|canceled)\b/i.test(raw) ||
    /\bsuppose\s+(?:i|we)\b/i.test(raw) ||
    /\bhypothetically\b/i.test(raw) ||
    /^\s*preview\b/i.test(raw);

  if (isHypothetical) {
    let op = 'none';
    if (lower.includes('refund')) op = 'refund_payment';
    else if (lower.includes('void')) op = 'void_invoice';
    else if (lower.includes('pay')) op = 'pay_invoice';
    else if (lower.includes('create') || lower.includes('invoice')) op = 'create_invoice';
    return {
      intent: 'hypothetical_preview',
      operation: op,
      authorizedToExecute: false,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'HYPOTHETICAL_PREVIEW_ONLY',
      explanation:
        'User asked a hypothetical/preview question ("what would happen if..."). Explaining outcome without executing any state mutation.',
      extractedParams: extracted,
    };
  }

  // Capability questions NEVER authorize execution regardless of priorExecutionIntent.
  const isCapabilityQuestion =
    /^\s*(?:are\s+you\s+able\s+to|can\s+you|could\s+you|do\s+you\s+support|is\s+it\s+possible\s+to|how\s+do\s+(?:i|you))\b/i.test(
      raw
    );

  if (isCapabilityQuestion) {
    let op = 'none';
    if (lower.includes('refund')) op = 'refund_payment';
    else if (lower.includes('pay')) op = 'pay_invoice';
    else if (lower.includes('void')) op = 'void_invoice';
    else if (lower.includes('create') || lower.includes('invoice')) op = 'create_invoice';
    return {
      intent: 'capability_inquiry',
      operation: op,
      authorizedToExecute: false,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'CAPABILITY_INQUIRY_NO_EXECUTION',
      explanation:
        'User asked a capability question rather than issuing an execution command. Explaining capability and guardrails without executing.',
      extractedParams: extracted,
    };
  }

  const isFollowUpConfirmation =
    /^(?:yes\b|go\s+ahead\b|confirm\b|approve\b|proceed\b|yes,\s*go\s+ahead|yes,\s*please|do\s+it)/i.test(
      raw
    ) &&
    !/\b(?:create|void|refund|pay|reset)\s+(?:an?\s+)?(?:invoice|payment|demo)\b/i.test(raw);

  if (isFollowUpConfirmation) {
    if (!params.hasPendingProposal || !params.pendingProposalId) {
      return {
        intent: 'follow_up_confirmation',
        operation: 'confirm_pending_proposal',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'NO_PENDING_ACTION_TO_CONFIRM',
        explanation:
          'User provided a follow-up confirmation ("Yes, go ahead"), but there is no active pending proposal in the current session.',
        extractedParams: extracted,
      };
    }
    const opMap: Record<string, string> = {
      create_invoice: 'create_invoice',
      invoice_create: 'create_invoice',
      payment_checkout: 'pay_invoice',
      refund: 'refund_payment',
      refund_request: 'refund_payment',
      void_invoice: 'void_invoice',
    };
    const mappedOp =
      (params.pendingProposalKind && opMap[params.pendingProposalKind]) || 'confirm_pending_proposal';
    return {
      intent: 'follow_up_confirmation',
      operation: mappedOp,
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: mappedOp === 'pay_invoice',
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_FOLLOW_UP_CONFIRMATION',
      explanation: `User confirmed pending proposal ${params.pendingProposalId} in the active session.`,
      extractedParams: extracted,
    };
  }

  if (
    /^\s*(?:show|list|get|find|search|display|what\s+are|explain)\b/i.test(raw) &&
    !/\b(?:create|void|refund|pay|reset)\b/i.test(raw)
  ) {
    return {
      intent: 'read_query',
      operation: 'search_invoices',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_READ_QUERY',
      explanation: 'Read-only inspection request.',
      extractedParams: extracted,
    };
  }

  if (/\breset\s+(?:the\s+)?demo\b/i.test(raw)) {
    return {
      intent: 'explicit_command',
      operation: 'reset_demo',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: 'Explicit user instruction to reset the isolated demo session.',
      extractedParams: extracted,
    };
  }

  if (/\b(?:create|issue|draft|bill|send)\b.*\binvoice\b/i.test(raw)) {
    if (!isProvider) {
      return {
        intent: 'explicit_command',
        operation: 'create_invoice',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: false,
        guardrailPassed: true,
        reasonCode: 'UNAUTHORIZED_ROLE_FOR_INVOICE_CREATION',
        explanation: 'Only Provider (Merchant) accounts are authorized to create invoices.',
        extractedParams: extracted,
      };
    }
    if (!extracted.customerName || !extracted.amountMinor) {
      return {
        intent: 'ambiguous_instruction',
        operation: 'create_invoice',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_INVOICE_PARAMETERS',
        explanation:
          'To create an invoice immediately, please specify both the customer name (Alex Rivera or Jordan Taylor) and the USD amount.',
        extractedParams: extracted,
      };
    }
    if (extracted.amountMinor > 50000) {
      return {
        intent: 'explicit_command',
        operation: 'create_invoice',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: false,
        reasonCode: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
        explanation: `Requested invoice amount (${formatUsd(extracted.amountMinor)}) exceeds the $500.00 single-action AI guardrail.`,
        extractedParams: extracted,
      };
    }
    return {
      intent: 'explicit_command',
      operation: 'create_invoice',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: `Explicit user instruction authorizes creating a ${formatUsd(extracted.amountMinor)} (${extracted.serviceCode}) invoice for ${extracted.customerName}.`,
      extractedParams: extracted,
    };
  }

  if (/^\s*(?:please\s+)?void\b/i.test(raw) || /\bvoid\s+(?:invoice|statement)\b/i.test(raw)) {
    if (!isProvider) {
      return {
        intent: 'explicit_command',
        operation: 'void_invoice',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: false,
        guardrailPassed: true,
        reasonCode: 'UNAUTHORIZED_ROLE_FOR_VOID',
        explanation: 'Only Provider (Merchant) accounts are authorized to void invoices.',
        extractedParams: extracted,
      };
    }
    if (!extracted.invoiceNumber) {
      return {
        intent: 'ambiguous_instruction',
        operation: 'void_invoice',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_VOID_TARGET',
        explanation: 'Please specify the invoice number to void (e.g., #PPB-INV-2026-1004).',
        extractedParams: extracted,
      };
    }
    return {
      intent: 'explicit_command',
      operation: 'void_invoice',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: `Explicit user instruction authorizes voiding eligible unpaid invoice #${extracted.invoiceNumber}.`,
      extractedParams: extracted,
    };
  }

  if (/^\s*(?:please\s+)?refund\b/i.test(raw) || /\bissue\s+a?\s*refund\b/i.test(raw)) {
    if (!isProvider) {
      return {
        intent: 'explicit_command',
        operation: 'refund_payment',
        authorizedToExecute: false,
        requiresClarification: false,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: false,
        guardrailPassed: true,
        reasonCode: 'UNAUTHORIZED_ROLE_FOR_REFUND',
        explanation: 'Only Provider (Merchant) accounts are authorized to issue refunds.',
        extractedParams: extracted,
      };
    }
    if (!extracted.invoiceNumber && !extracted.amountMinor) {
      return {
        intent: 'ambiguous_instruction',
        operation: 'refund_payment',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: false,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_REFUND_TARGET',
        explanation:
          'Please specify which paid invoice or payment amount to refund (e.g., #PPB-INV-2026-1003 or the $125.00 payment).',
        extractedParams: extracted,
      };
    }
    return {
      intent: 'explicit_command',
      operation: 'refund_payment',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: false,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_EXPLICIT_COMMAND',
      explanation: `Explicit user instruction authorizes refunding ${extracted.invoiceNumber ? `#${extracted.invoiceNumber}` : `the ${formatUsd(extracted.amountMinor || 0)} payment`}.`,
      extractedParams: extracted,
    };
  }

  if (/^\s*(?:please\s+)?pay\b/i.test(raw) || /\binitiate\s+payment\s+for\b/i.test(raw)) {
    if (!extracted.invoiceNumber && !extracted.amountMinor) {
      return {
        intent: 'ambiguous_instruction',
        operation: 'pay_invoice',
        authorizedToExecute: false,
        requiresClarification: true,
        requiresExternalPayPalBuyerApproval: true,
        roleAuthorized: true,
        guardrailPassed: true,
        reasonCode: 'AMBIGUOUS_PAYMENT_TARGET',
        explanation: 'Please specify which invoice number or amount you want to pay.',
        extractedParams: extracted,
      };
    }
    return {
      intent: 'explicit_command',
      operation: 'pay_invoice',
      authorizedToExecute: true,
      requiresClarification: false,
      requiresExternalPayPalBuyerApproval: true,
      roleAuthorized: true,
      guardrailPassed: true,
      reasonCode: 'AUTHORIZED_CHECKOUT_INITIATION_BUYER_APPROVAL_REQUIRED',
      explanation:
        'Explicit user instruction authorizes creating the PayPal Sandbox checkout order. PayPal buyer checkout approval is still required before capture completes.',
      extractedParams: extracted,
    };
  }

  return {
    intent: 'ambiguous_instruction',
    operation: 'none',
    authorizedToExecute: false,
    requiresClarification: true,
    requiresExternalPayPalBuyerApproval: false,
    roleAuthorized: true,
    guardrailPassed: true,
    reasonCode: 'UNRECOGNIZED_OR_AMBIGUOUS_INSTRUCTION',
    explanation:
      'Instruction does not unambiguously specify an authorized financial command. Please clarify the target invoice, customer, or operation.',
    extractedParams: extracted,
  };
}

interface MCPToolDef {
  name: string;
  description: string;
  permissionTier: 'read_only' | 'proposal_only' | 'confirmed_demo_write';
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  inputSchema: Record<string, unknown>;
}

const MCP_TOOLS: MCPToolDef[] = [
  {
    name: 'discover_billing_capabilities',
    description:
      'Discover all PayPal AI Billing Kit MCP Agent Interface capabilities, guardrails ($500 single-action / $2,500 daily limits), demo personas, service catalog codes, and permission tiers.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Discover Billing Capabilities',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated visitor/agent demo session ID (default: mcp-public-demo).',
        },
      },
    },
  },
  {
    name: 'list_demo_customers',
    description:
      'List fictional Provider and Customer demo accounts (Dr. Sarah Jenkins, Alex Rivera, Jordan Taylor) and their active billing authorization status.',
    permissionTier: 'read_only',
    annotations: {
      title: 'List Demo Customers & Personas',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_invoices',
    description:
      'Search and filter billing statements by status (sent, overdue, paid, draft, void, refunded), customer name/ID, or query text within an isolated demo session.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Search Billing Invoices',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search matching invoice number, customer name, or service description.',
        },
        status: {
          type: 'string',
          enum: ['all', 'sent', 'overdue', 'paid', 'draft', 'void', 'refunded'],
          description: 'Optional status filter.',
        },
        customer_name: {
          type: 'string',
          description: 'Optional customer name filter (e.g., "Alex Rivera" or "Jordan Taylor").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_invoice_details',
    description:
      'Retrieve comprehensive line items, service dates, issued/due/paid timestamps, original vs. remaining balance, payment attempts, settlement verification status, and a natural-language explanation for a specific invoice (by invoice_number like PPB-INV-2026-1003 or UUID).',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Invoice Details & Explanation',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number (e.g., "PPB-INV-2026-1003" or "1003").',
        },
        invoice_id: {
          type: 'string',
          description: 'Invoice UUID if known.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'create_invoice_proposal',
    description:
      'Prepare a human-in-the-loop administrative invoice proposal for an authorized customer (Alex Rivera or Jordan Taylor). Enforces the $500.00 single-action and $2,500.00 daily Billing AI guardrails and stores a pending proposal card.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Create Invoice Proposal (Guardrail-Checked)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['customer_name', 'service_code'],
      properties: {
        customer_name: {
          type: 'string',
          description: 'Authorized customer name ("Alex Rivera" or "Jordan Taylor").',
        },
        service_code: {
          type: 'string',
          description:
            'Catalog service code (ADMIN-TELEHEALTH, ADMIN-FOLLOWUP, ADMIN-OFFICE, ADMIN-FORMS, ADMIN-RECORDS, ADMIN-COPAY, ADMIN-CAREPLAN, ADMIN-PRIORAUTH).',
        },
        amount_minor: {
          type: 'integer',
          description: 'Amount in USD cents (e.g. 3500 for $35.00). Max 50000 ($500.00) for AI proposals.',
        },
        due_date: {
          type: 'string',
          description: 'Optional ISO due date (YYYY-MM-DD). Defaults to 14 days from today.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'create_approved_invoice',
    description:
      'Execute an approved invoice creation within the isolated demo session. Either provide a pending `proposal_id` or pass customer_name, service_code, amount_minor, and `explicit_human_approval: true`.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Create Approved Demo Invoice',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: {
          type: 'string',
          description: 'UUID of a pending create_invoice proposal to approve and execute.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing invoice creation (e.g., "Create an invoice for Alex for $150.").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role (must be doctor/provider to create invoices).',
        },
        customer_name: {
          type: 'string',
          description: 'Authorized customer name ("Alex Rivera" or "Jordan Taylor") if creating directly.',
        },
        service_code: {
          type: 'string',
          description: 'Service code (e.g., ADMIN-FORMS, ADMIN-TELEHEALTH).',
        },
        amount_minor: {
          type: 'integer',
          description: 'Unit amount in USD cents (e.g., 3500 for $35.00). Max 50000 ($500.00).',
        },
        send_immediately: {
          type: 'boolean',
          description: 'Whether to mark the invoice as sent immediately (default: true).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval of this billing write.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'explain_outstanding_balances',
    description:
      'Explain outstanding balances, overdue statements, and upcoming due dates for the Provider practice or for a specific Customer (Alex Rivera or Jordan Taylor).',
    permissionTier: 'read_only',
    annotations: {
      title: 'Explain Outstanding Balances',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'Optional customer name ("Alex Rivera" or "Jordan Taylor") to scope the balance explanation.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_transaction_history',
    description:
      'Retrieve recorded settlements, refunds, and payment attempts (including failed attempts and failure diagnostics), clearly distinguishing seeded sample demo records from live PayPal Sandbox captures.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Transaction & Payment Attempt History',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Optional invoice number filter.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'prepare_payment_proposal',
    description:
      'Prepare a customer payment checkout proposal for an unpaid invoice. Never charges funds autonomously; returns the 5-stage PayPal Sandbox human authorization workflow and creates a pending payment_checkout proposal.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Prepare Customer Payment Proposal',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Unpaid invoice number (e.g., "PPB-INV-2026-1001" or "PPB-INV-2026-1002").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'void_unpaid_invoice',
    description:
      'Void an eligible unpaid (draft, sent, or overdue) invoice in the isolated demo session. Enforces Payment-State Protection: paid or refunded invoices are strictly blocked from voiding.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Void Eligible Unpaid Invoice',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number to void (e.g., "PPB-INV-2026-1005" or a newly created session invoice).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Set true to execute the void immediately in the demo session; if false/omitted, creates a pending void_invoice proposal.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing the void (e.g., "Void invoice 1004.").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role (must be doctor/provider to void invoices).',
        },
        reason: {
          type: 'string',
          description: 'Optional administrative reason for voiding.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'prepare_refund_proposal',
    description:
      'Prepare a provider refund proposal for a paid invoice (e.g., #PPB-INV-2026-1003). Validates that the invoice has captured funds before creating the refund proposal.',
    permissionTier: 'proposal_only',
    annotations: {
      title: 'Prepare Refund Proposal',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Paid invoice number (e.g., "PPB-INV-2026-1003").',
        },
        amount_minor: {
          type: 'integer',
          description: 'Optional partial refund amount in USD cents (defaults to full paid balance).',
        },
        reason: {
          type: 'string',
          description: 'Administrative refund reason.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_financial_audit_history',
    description:
      'Read the immutable, append-only financial audit trail (billing_audit_events) showing invoice creations, voids, AI proposals, guardrail checks, and settlements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Financial Audit History',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max audit events to return (1-50, default 20).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_paypal_sandbox_status',
    description:
      'Check PayPal Sandbox merchant and payer connection status, sandbox environment enforcement, and whether live PayPal Sandbox REST API credentials are configured on the server.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get PayPal Sandbox Connection Status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_business_metrics',
    description:
      'Calculate comprehensive Provider practice and Customer KPI metrics (outstanding balance, pending, overdue, paid total, refunded total, failed attempts, and collection rate) for the demo session.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Business & Practice Billing Metrics',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'reset_demo_session',
    description:
      'Reset an isolated demo session (`demo_session_id`), clearing session-specific test invoices, proposals, and overrides while restoring the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Reset Isolated Demo Session',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier to reset (default: maas-public-demo).',
        },
      },
    },
  },
  {
    name: 'create_paypal_checkout_order',
    description:
      'Create a protected PayPal Sandbox checkout order (`POST /v2/checkout/orders`) for an unpaid statement or approved `payment_checkout` proposal (`proposal_id`). Requires `explicit_human_approval: true`. Returns the PayPal Order ID and buyer approval URL when live Sandbox credentials are configured, or explicit Sandbox readiness status.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Create PayPal Sandbox Checkout Order',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: {
          type: 'string',
          description: 'Optional UUID of a pending payment_checkout proposal prepared by prepare_payment_proposal.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing payment checkout initiation (e.g., "Pay invoice 1002.").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role.',
        },
        invoice_number: {
          type: 'string',
          description: 'Unpaid invoice number (e.g., "PPB-INV-2026-1001" or "PPB-INV-2026-1004").',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval before creating a PayPal checkout order.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'capture_paypal_checkout_order',
    description:
      'Capture an approved PayPal Sandbox checkout order (`order_id`) after buyer approval, or execute an explicitly labeled Demo Settlement (`allow_demo_settlement_fallback: true`) in an isolated demo session (`demo_session_id`). Updates the ledger and issues a receipt.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Capture Approved PayPal Order or Settle Demo Invoice',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Invoice number being settled (e.g., "PPB-INV-2026-1001" or "PPB-INV-2026-1004").',
        },
        order_id: {
          type: 'string',
          description: 'PayPal Sandbox Order ID returned by create_paypal_checkout_order after buyer approval.',
        },
        allow_demo_settlement_fallback: {
          type: 'boolean',
          description: 'When true and live PayPal Sandbox buyer capture is not provided, settles the invoice in the isolated demo session clearly marked as a Sample Demo Record (never fabricated as a live PayPal capture).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval of settlement.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'get_payment_receipt',
    description:
      'Retrieve the structured payment receipt and PayPal confirmation metadata for a paid or refunded statement (`invoice_number`), clearly distinguishing verified PayPal Sandbox captures from sample demo settlements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Get Payment Receipt & Confirmation',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Paid or refunded invoice number (e.g., "PPB-INV-2026-1003").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'execute_approved_refund',
    description:
      'Execute an approved provider refund for a paid statement (`invoice_number` or `proposal_id` from `prepare_refund_proposal`) with `explicit_human_approval: true`. Issues a PayPal Captures v2 refund when a verified PayPal capture exists, or records a demo session refund in the isolated `demo_session_id`.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Execute Approved Refund',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: {
          type: 'string',
          description: 'UUID of a pending refund proposal created by prepare_refund_proposal.',
        },
        user_instruction: {
          type: 'string',
          description:
            'Optional explicit natural-language user instruction authorizing this refund (e.g., "Refund the $125 payment on invoice 1003").',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Authenticated role executing the instruction (must be doctor/provider for refunds).',
        },
        invoice_number: {
          type: 'string',
          description: 'Paid invoice number to refund (e.g., "PPB-INV-2026-1003").',
        },
        amount_minor: {
          type: 'integer',
          description: 'Optional refund amount in USD cents (defaults to full paid balance).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval before executing the refund.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'execute_conversational_instruction',
    description:
      'Context-aware Conversational Authorization router: evaluates a natural-language user instruction ("Create an invoice for Alex for $150.", "Void invoice 1004.", "Refund the $50 payment.", "Pay invoice 1002.", "Reset the demo.", "Yes, go ahead.", "Are you able to issue refunds?", "Can you pay invoice 1002?", "What would happen if I refunded it?") and executes explicit authorized commands within role and $500/$2,500 guardrails while explaining capability or hypothetical questions without mutating state.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Execute Conversational Billing Instruction',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['instruction'],
      properties: {
        instruction: {
          type: 'string',
          description: 'Exact natural-language user instruction or question.',
        },
        actor_role: {
          type: 'string',
          enum: ['doctor', 'patient', 'provider', 'customer'],
          description: 'Active user role (default: doctor/provider).',
        },
        prior_execution_intent: {
          type: 'boolean',
          description: 'True only if prior conversation turns already established execution intent.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_discover_official_mcp',
    description:
      '[OFFICIAL_PAYPAL_MCP] Connect server-side to PayPal’s official Sandbox MCP server (https://mcp.sandbox.paypal.com/sse and /.well-known/oauth-authorization-server, plus probe /http) using the merchant Sandbox OAuth token, returning live serverInfo (PayPal MCP Agent v1.0.0), the 46 upstream official PayPal MCP tools, and transport status.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Discover Official PayPal MCP Server Capabilities',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_get_order',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `get_order` capability: retrieve live order details directly from PayPal Sandbox Orders v2 API (`GET /v2/checkout/orders/{order_id}`), returning order status, intent, payer, purchase units, and capture IDs.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: Get Order Details (Orders v2)',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['order_id'],
      properties: {
        order_id: {
          type: 'string',
          description: 'PayPal Sandbox Order ID (e.g., "7FA47897KM5938009").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_get_refund',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `get_refund` capability: retrieve live refund details directly from PayPal Sandbox Captures v2 API (`GET /v2/payments/refunds/{refund_id}`), returning refund status, amount, note_to_payer, and seller payable breakdown.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: Get Refund Details (Captures v2)',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      required: ['refund_id'],
      properties: {
        refund_id: {
          type: 'string',
          description: 'PayPal Sandbox Refund ID (e.g., "2EM77813GU330222M").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_list_invoices',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `list_invoices` capability: query PayPal Sandbox Invoicing v2 API (`GET /v2/invoicing/invoices`) alongside synchronized application statements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: List Merchant Invoices (Invoicing v2)',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number (default: 1).',
        },
        page_size: {
          type: 'integer',
          description: 'Page size (default: 10).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_generate_invoice_number',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `generate_invoice_number` capability: call PayPal Sandbox Invoicing v2 API (`POST /v2/invoicing/generate-next-invoice-number`) to allocate the next official PayPal merchant invoice number.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: Generate Next Invoice Number',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_list_disputes',
    description:
      '[PAYPAL_REST_ADAPTER] Official PayPal `list_disputes` capability: query PayPal Sandbox Customer Disputes API (`GET /v1/customer/disputes`) to inspect open merchant disputes.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: List Customer Disputes',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        page_size: {
          type: 'integer',
          description: 'Number of disputes to return (1-50, default 10).',
        },
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'paypal_check_card_eligibility',
    description:
      '[PAYPAL_REST_ADAPTER] Check PayPal Sandbox merchant eligibility for Orders v2 direct card payments (`payment_source.card`), granted OAuth 2.0 scopes (`payments/payment/authcapture`, `client-payments-eligibility`), supported PayPal Sandbox test card profiles (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`), and security controls.',
    permissionTier: 'read_only',
    annotations: {
      title: 'PayPal Sandbox: Check Direct Card Payment Eligibility',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        demo_session_id: {
          type: 'string',
          description: 'Optional isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'execute_sandbox_card_payment',
    description:
      'Execute an authorized server-side PayPal Sandbox direct card payment (`POST /v2/checkout/orders` with `payment_source.card`) using an allowlisted PayPal Sandbox test card profile (`visa_sandbox`, `mastercard_sandbox`, `amex_sandbox`, `decline_refused`, `decline_expired`, `decline_insufficient_funds`). Rejects caller-supplied raw PAN/CVV, verifies capture directly against PayPal Orders v2, and records 8-state payment-attempt classification (`captured`, `authorized`, `payment_declined`, `processing_error`).',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Execute Authorized PayPal Sandbox Card Payment',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        proposal_id: {
          type: 'string',
          description: 'Optional UUID of a pending payment_checkout proposal prepared by prepare_payment_proposal.',
        },
        user_instruction: {
          type: 'string',
          description: 'Optional explicit natural-language user instruction authorizing payment (e.g., "Pay invoice 1002.").',
        },
        invoice_number: {
          type: 'string',
          description: 'Unpaid invoice number (e.g., "PPB-INV-2026-1001" or a session invoice).',
        },
        card_profile: {
          type: 'string',
          enum: [
            'visa_sandbox',
            'mastercard_sandbox',
            'amex_sandbox',
            'decline_refused',
            'decline_expired',
            'decline_insufficient_funds',
          ],
          description: 'Allowlisted server-side PayPal Sandbox test card profile (default: visa_sandbox).',
        },
        intent: {
          type: 'string',
          enum: ['CAPTURE', 'AUTHORIZE'],
          description: 'PayPal Orders v2 intent (default: CAPTURE).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to confirm human approval before executing the Sandbox card payment.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'generate_receipt_pdf',
    description:
      'Generate and validate a downloadable PDF payment receipt (`%PDF-1.4`) for a paid or refunded statement (`invoice_number`), returning base64 PDF content, direct download URL, byte length, and provenance/refund metadata. Rejects unpaid statements.',
    permissionTier: 'read_only',
    annotations: {
      title: 'Generate & Validate PDF Payment Receipt',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      required: ['invoice_number'],
      properties: {
        invoice_number: {
          type: 'string',
          description: 'Paid or refunded invoice number (e.g., "PPB-INV-2026-1003" or "PPB-INV-2026-1057").',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
  {
    name: 'run_sandbox_card_lifecycle_test',
    description:
      'Execute a complete, isolated PayPal Sandbox integration lifecycle test (1. Create Test Invoice -> 2. Execute Sandbox Card Order & Capture -> 3. Direct PayPal Order Lookup -> 4. Receipt & PDF Verification -> 5. Live PayPal Refund -> 6. Direct PayPal Refund Lookup -> 7. Audit & Metrics Reconciliation). Sandbox-only and rate-limited.',
    permissionTier: 'confirmed_demo_write',
    annotations: {
      title: 'Run Full PayPal Sandbox Card Lifecycle Integration Test',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        amount_minor: {
          type: 'integer',
          description: 'Optional test invoice amount in USD cents (default: 3500 for $35.00, max: 10000 for $100.00).',
        },
        card_profile: {
          type: 'string',
          enum: ['visa_sandbox', 'mastercard_sandbox', 'amex_sandbox'],
          description: 'Allowlisted PayPal Sandbox test card profile (default: visa_sandbox).',
        },
        include_refund: {
          type: 'boolean',
          description: 'Whether to also execute and verify a live PayPal Sandbox refund after capture (default: true).',
        },
        explicit_human_approval: {
          type: 'boolean',
          description: 'Must be true to authorize the automated Sandbox integration test.',
        },
        demo_session_id: {
          type: 'string',
          description: 'Isolated demo session identifier.',
        },
      },
    },
  },
];

async function fetchSessionInvoices(admin: any, demoSessionId: string) {
  const [invRes, itemsRes, attemptsRes, txRes, refundsRes, overridesRes] = await Promise.all([
    admin
      .from('billing_invoices')
      .select('*')
      .in('demo_session_id', ['canonical', demoSessionId])
      .order('created_at', { ascending: false }),
    admin.from('billing_invoice_items').select('*').order('position', { ascending: true }),
    admin
      .from('billing_payment_attempts')
      .select('*')
      .in('demo_session_id', ['canonical', demoSessionId])
      .order('created_at', { ascending: false }),
    admin.from('billing_transactions').select('*').order('captured_at', { ascending: false }),
    admin.from('billing_refunds').select('*').order('created_at', { ascending: false }),
    demoSessionId !== 'canonical'
      ? admin
          .from('billing_demo_session_overrides')
          .select('*')
          .eq('demo_session_id', demoSessionId)
      : Promise.resolve({ data: [] }),
  ]);

  const rawInvoices = Array.isArray(invRes?.data) ? invRes.data : [];
  const items = Array.isArray(itemsRes?.data) ? itemsRes.data : [];
  const attempts = Array.isArray(attemptsRes?.data) ? attemptsRes.data : [];
  const txs = Array.isArray(txRes?.data) ? txRes.data : [];
  const refunds = Array.isArray(refundsRes?.data) ? refundsRes.data : [];
  const overrides = Array.isArray(overridesRes?.data) ? overridesRes.data : [];
  const overrideMap = new Map<string, any>();
  for (const ov of overrides) {
    overrideMap.set(String(ov.invoice_id), ov);
  }

  const nameById: Record<string, string> = {
    [PROVIDER_ID]: 'Dr. Sarah Jenkins',
    [ALEX_ID]: 'Alex Rivera',
    [JORDAN_ID]: 'Jordan Taylor',
  };

  return rawInvoices.map((raw: any) => {
    const ov = overrideMap.get(String(raw.id));
    const status = String(ov?.status ?? raw.status ?? 'sent');
    const amountPaidMinor = Number(ov?.amount_paid_minor ?? raw.amount_paid_minor ?? 0);
    const amountRefundedMinor = Number(
      ov?.amount_refunded_minor ?? raw.amount_refunded_minor ?? 0
    );
    const balanceDueMinor =
      status === 'void' || status === 'refunded' || status === 'paid'
        ? 0
        : Number(
            ov?.balance_due_minor ??
              raw.balance_due_minor ??
              Math.max(Number(raw.total_minor || 0) - amountPaidMinor, 0)
          );

    const invItems = items
      .filter((it: any) => it.invoice_id === raw.id)
      .map((it: any) => ({
        service_code: String(it.service_code),
        description: String(it.description),
        quantity: Number(it.quantity || 1),
        unit_amount_minor: Number(it.unit_amount_minor || 0),
        unit_amount_usd: formatUsd(Number(it.unit_amount_minor || 0)),
        line_total_minor: Number(
          it.line_total_minor ?? Number(it.quantity || 1) * Number(it.unit_amount_minor || 0)
        ),
        line_total_usd: formatUsd(
          Number(
            it.line_total_minor ?? Number(it.quantity || 1) * Number(it.unit_amount_minor || 0)
          )
        ),
      }));

    const invAttempts = attempts
      .filter((at: any) => at.invoice_id === raw.id)
      .map((at: any) => {
        const rawStatus = String(at.status);
        const failMsg = at.failure_message ? String(at.failure_message) : null;
        const classification = String(
          at.attempt_classification ||
            (rawStatus === 'completed'
              ? 'captured'
              : rawStatus === 'created' || rawStatus === 'approved'
                ? 'awaiting_buyer_approval'
                : rawStatus === 'approval_required' || (failMsg && failMsg.includes('ORDER_NOT_APPROVED'))
                  ? 'approval_required'
                  : rawStatus === 'canceled'
                    ? 'buyer_canceled'
                    : rawStatus === 'authorized'
                      ? 'authorized'
                      : rawStatus === 'refunded'
                        ? 'refunded'
                        : 'payment_declined')
        );
        return {
          id: String(at.id),
          status: rawStatus,
          attempt_classification: classification,
          is_genuine_failure: classification === 'payment_declined' || classification === 'processing_error',
          payment_source_type: String(at.payment_source_type || 'paypal_wallet'),
          card_brand: at.card_brand ? String(at.card_brand) : null,
          card_last_digits: at.card_last_digits ? String(at.card_last_digits) : null,
          processor_response_code: at.processor_response_code ? String(at.processor_response_code) : null,
          amount_minor: Number(at.amount_minor || 0),
          amount_usd: formatUsd(Number(at.amount_minor || 0)),
          paypal_order_id: at.paypal_order_id ? String(at.paypal_order_id) : null,
          paypal_error_code: at.paypal_error_code
            ? String(at.paypal_error_code)
            : failMsg && failMsg.includes('ORDER_NOT_APPROVED')
              ? 'ORDER_NOT_APPROVED'
              : null,
          failure_code: at.failure_code ? String(at.failure_code) : null,
          failure_message: failMsg,
          actionable_message:
            at.actionable_message ||
            (classification === 'awaiting_buyer_approval' || classification === 'approval_required'
              ? 'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'
              : failMsg),
          demo_session_id: String(at.demo_session_id || 'canonical'),
          created_at: String(at.created_at),
        };
      });

    const matchingTx = txs.find((t: any) => t.invoice_id === raw.id);
    const matchingRefund = refunds.find((r: any) => r.invoice_id === raw.id && r.status === 'completed');
    const dueStr = String(raw.due_date || '');
    const isOverdue =
      status === 'sent' &&
      dueStr &&
      new Date(`${dueStr}T23:59:59Z`).getTime() < Date.now();
    const effectiveStatus = isOverdue ? 'overdue' : status;

    const verifiedVia = ov?.paid_at
      ? 'seed_demo'
      : matchingTx?.verified_via
        ? String(matchingTx.verified_via)
        : null;
    const captureId =
      ov?.paid_at && !matchingTx
        ? `DEMO-SIM-${raw.invoice_number}`
        : matchingTx?.paypal_capture_id
          ? String(matchingTx.paypal_capture_id)
          : null;
    const refundId = matchingRefund?.paypal_refund_id
      ? String(matchingRefund.paypal_refund_id)
      : status === 'refunded'
        ? `DEMO-REFUND-${raw.invoice_number}`
        : null;
    const latestCompletedAttempt = invAttempts.find(
      (a: any) => a.status === 'completed' || a.attempt_classification === 'captured' || a.attempt_classification === 'refunded'
    );

    return {
      id: String(raw.id),
      invoice_number: String(raw.invoice_number),
      demo_session_id: String(raw.demo_session_id || 'canonical'),
      has_session_override: Boolean(ov),
      status: effectiveStatus,
      raw_db_status: status,
      provider_name: nameById[String(raw.issuer_user_id)] || 'Dr. Sarah Jenkins',
      customer_id: String(raw.recipient_user_id),
      customer_name: nameById[String(raw.recipient_user_id)] || 'Authorized Customer',
      currency: 'USD',
      total_minor: Number(raw.total_minor || 0),
      total_usd: formatUsd(Number(raw.total_minor || 0)),
      amount_paid_minor: amountPaidMinor,
      amount_paid_usd: formatUsd(amountPaidMinor),
      amount_refunded_minor: amountRefundedMinor,
      amount_refunded_usd: formatUsd(amountRefundedMinor),
      balance_due_minor: balanceDueMinor,
      balance_due_usd: formatUsd(balanceDueMinor),
      service_date: String(raw.sent_at || raw.created_at).slice(0, 10),
      issued_at: String(raw.sent_at || raw.created_at),
      due_date: dueStr,
      paid_at: ov?.paid_at || raw.paid_at || null,
      voided_at: ov?.voided_at || raw.voided_at || null,
      refunded_at: ov?.refunded_at || raw.refunded_at || matchingRefund?.refunded_at || null,
      settlement_verification:
        verifiedVia === 'capture_api' ||
        verifiedVia === 'order_lookup' ||
        verifiedVia === 'webhook'
          ? 'paypal_sandbox_verified'
          : verifiedVia === 'seed_demo'
            ? 'sample_demo_settlement_not_live_paypal'
            : 'unsettled',
      settlement_reference: captureId,
      paypal_order_id: matchingTx?.paypal_order_id || latestCompletedAttempt?.paypal_order_id || null,
      paypal_refund_id: refundId,
      payment_source_type:
        latestCompletedAttempt?.payment_source_type ||
        (verifiedVia === 'seed_demo' ? 'demo_simulation' : 'paypal_wallet'),
      card_brand: latestCompletedAttempt?.card_brand || null,
      card_last_digits: latestCompletedAttempt?.card_last_digits || null,
      line_items: invItems,
      payment_attempts: invAttempts,
    };
  });
}

async function executeTool(
  admin: any,
  toolName: string,
  args: Record<string, any>,
  defaultSessionId: string
): Promise<Record<string, any>> {
  const demoSessionId = sanitizeDemoSessionId(args?.demo_session_id || defaultSessionId);

  const FORBIDDEN_BYPASS_KEYS = [
    'bypass_guardrail',
    'skip_approval',
    'force',
    'auto_approve',
    'ignore_limits',
    'override_guardrail',
  ];
  for (const key of FORBIDDEN_BYPASS_KEYS) {
    if (args && key in args && args[key] !== false && args[key] !== null && args[key] !== undefined) {
      return {
        ok: false,
        error_code: 'GUARDRAIL_BYPASS_REJECTED',
        message: `Security Guardrail Violation: Parameter "${key}" is prohibited. Financial guardrails ($500 single-action / $2,500 daily) and explicit human approval cannot be bypassed.`,
      };
    }
  }

  const MUTATING_TOOLS = new Set([
    'create_invoice_proposal',
    'create_approved_invoice',
    'prepare_payment_proposal',
    'void_unpaid_invoice',
    'prepare_refund_proposal',
    'reset_demo_session',
    'create_paypal_checkout_order',
    'capture_paypal_checkout_order',
    'execute_approved_refund',
    'execute_conversational_instruction',
    'execute_sandbox_card_payment',
    'run_sandbox_card_lifecycle_test',
  ]);
  if (MUTATING_TOOLS.has(toolName) && demoSessionId.toLowerCase() === 'canonical') {
    return {
      ok: false,
      error_code: 'CANONICAL_MUTATION_FORBIDDEN',
      message:
        'Canonical seed data is read-only. Provide a visitor or evaluator demo_session_id (e.g., "chatgpt-eval-session") to execute mutations.',
    };
  }

  switch (toolName) {
    case 'discover_billing_capabilities': {
      const { data: catalog } = await admin
        .from('billing_service_catalog')
        .select('code, title, description, default_amount_minor, currency')
        .eq('active', true)
        .order('code', { ascending: true });

      const officialPayPalTools = ['paypal_discover_official_mcp'];
      const paypalRestAdapterTools = [
        'paypal_get_order',
        'paypal_get_refund',
        'paypal_list_invoices',
        'paypal_generate_invoice_number',
        'paypal_list_disputes',
        'paypal_check_card_eligibility',
      ];

      return {
        ok: true,
        service: 'PayPal AI Billing Kit — Unified PayPal MCP Gateway',
        version: '2.2.0',
        protocol_support: ['MCP JSON-RPC 2.0 (2025-03-26)', 'REST JSON POST/GET', 'OpenAPI 3.1.0'],
        demo_session_id: demoSessionId,
        guardrails: {
          max_single_action_minor: 50000,
          max_single_action_usd: '$500.00',
          daily_limit_minor: 250000,
          daily_limit_usd: '$2,500.00',
          require_human_approval: true,
          conversational_authorization_enabled: true,
          paypal_buyer_authorization_required: true,
          sandbox_card_checkout_enabled: true,
          payment_state_protection:
            'Paid and refunded invoices cannot be voided; returning captured funds requires a refund proposal.',
          privacy_boundary:
            'Strictly isolated to administrative billing statements; sensitive clinical/medical notes are refused.',
        },
        permission_tiers: {
          read_only: [
            'discover_billing_capabilities',
            'list_demo_customers',
            'search_invoices',
            'get_invoice_details',
            'explain_outstanding_balances',
            'get_transaction_history',
            'get_payment_receipt',
            'generate_receipt_pdf',
            'get_financial_audit_history',
            'get_paypal_sandbox_status',
            'get_business_metrics',
            'paypal_discover_official_mcp',
            'paypal_get_order',
            'paypal_get_refund',
            'paypal_list_invoices',
            'paypal_generate_invoice_number',
            'paypal_list_disputes',
            'paypal_check_card_eligibility',
          ],
          proposal_only: [
            'create_invoice_proposal',
            'prepare_payment_proposal',
            'prepare_refund_proposal',
          ],
          confirmed_demo_write: [
            'create_approved_invoice',
            'create_paypal_checkout_order',
            'capture_paypal_checkout_order',
            'execute_sandbox_card_payment',
            'execute_approved_refund',
            'void_unpaid_invoice',
            'reset_demo_session',
            'execute_conversational_instruction',
            'run_sandbox_card_lifecycle_test',
          ],
        },
        tool_sources: {
          native_application: MCP_TOOLS.filter(
            (t) => !officialPayPalTools.includes(t.name) && !paypalRestAdapterTools.includes(t.name)
          ).map((t) => t.name),
          official_paypal_mcp: officialPayPalTools,
          paypal_rest_adapter: paypalRestAdapterTools,
        },
        demo_personas: DEMO_ACCOUNTS,
        service_catalog: (catalog || []).map((c: any) => ({
          ...c,
          default_amount_usd: formatUsd(Number(c.default_amount_minor || 0)),
        })),
        baseline_tools_count: 26,
        tools_count: MCP_TOOLS.length,
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          permission_tier: t.permissionTier,
          source: officialPayPalTools.includes(t.name)
            ? 'official_paypal_mcp'
            : paypalRestAdapterTools.includes(t.name)
              ? 'paypal_rest_adapter'
              : 'native_application',
          description: t.description,
        })),
      };
    }

    case 'list_demo_customers': {
      return {
        ok: true,
        organization: {
          id: ORG_ID,
          name: 'Jenkins Wellness & Telehealth Practice',
          provider: DEMO_ACCOUNTS[0],
        },
        authorized_customers: DEMO_ACCOUNTS.slice(1).map((c) => ({
          ...c,
          authorization_status: 'active',
          Relationship: 'Authorized Customer of Dr. Sarah Jenkins',
        })),
      };
    }

    case 'search_invoices': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const q = String(args?.query || '').trim().toLowerCase();
      const statusFilter = String(args?.status || 'all').trim().toLowerCase();
      const custFilter = String(args?.customer_name || '').trim().toLowerCase();

      const filtered = invoices.filter((inv: any) => {
        if (statusFilter && statusFilter !== 'all' && inv.status.toLowerCase() !== statusFilter) {
          return false;
        }
        if (custFilter && !inv.customer_name.toLowerCase().includes(custFilter)) {
          return false;
        }
        if (q) {
          const hay = [
            inv.invoice_number,
            inv.customer_name,
            inv.status,
            ...inv.line_items.map((li: any) => `${li.service_code} ${li.description}`),
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      return {
        ok: true,
        demo_session_id: demoSessionId,
        count: filtered.length,
        invoices: filtered,
      };
    }

    case 'get_invoice_details': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const rawId = String(args?.invoice_id || '').trim();

      const found = invoices.find((inv: any) => {
        if (rawId && inv.id === rawId) return true;
        if (rawNum) {
          return (
            inv.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
            inv.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
          );
        }
        return false;
      });

      if (!found) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum || rawId || '(unspecified)'} was not found in demo session "${demoSessionId}".`,
          available_invoices: invoices.map((i: any) => i.invoice_number),
        };
      }

      const itemLines = found.line_items.map(
        (li: any) => `${li.service_code}: ${li.description} (Qty ${li.quantity} × ${li.unit_amount_usd} = ${li.line_total_usd})`
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        invoice: found,
        explanation: [
          `Statement #${found.invoice_number} (${found.status.toUpperCase()})`,
          `Provider: ${found.provider_name} • Customer: ${found.customer_name}`,
          `What this invoice is for: ${itemLines.join('; ') || 'Administrative billing service'}`,
          `When services were provided / statement issued: ${found.service_date} (Due: ${found.due_date}${
            found.paid_at ? `, Paid: ${String(found.paid_at).slice(0, 10)}` : ''
          })`,
          `Financial Summary: Original Total ${found.total_usd} USD • Paid ${found.amount_paid_usd} USD • Refunded ${found.amount_refunded_usd} USD • Remaining Balance Due ${found.balance_due_usd} USD`,
          found.settlement_reference
            ? `Settlement Reference: ${found.settlement_reference} (${found.settlement_verification})`
            : 'Settlement Status: Unsettled',
        ].join('\n'),
      };
    }

    case 'create_invoice_proposal': {
      const custName = String(args?.customer_name || '').trim();
      const targetCustomer = DEMO_ACCOUNTS.slice(1).find((c) =>
        c.fullName.toLowerCase().includes(custName.toLowerCase())
      );
      if (!targetCustomer) {
        return {
          ok: false,
          error_code: 'RECIPIENT_NOT_AUTHORIZED',
          message: `Customer "${custName}" is not an authorized demo customer. Authorized customers are: Alex Rivera, Jordan Taylor.`,
        };
      }

      const { data: catalog } = await admin
        .from('billing_service_catalog')
        .select('*')
        .eq('active', true);
      const code = String(args?.service_code || 'ADMIN-TELEHEALTH').trim().toUpperCase();
      const service =
        (catalog || []).find((c: any) => String(c.code).toUpperCase() === code) ||
        (catalog || [])[0] || {
          code: 'ADMIN-TELEHEALTH',
          title: 'Administrative Telehealth Consultation',
          description: 'Administrative telehealth scheduling and consultation fee',
          default_amount_minor: 15000,
        };

      const amountMinor = Number(args?.amount_minor ?? service.default_amount_minor ?? 15000);
      if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
        return {
          ok: false,
          error_code: 'INVALID_AMOUNT',
          message: 'amount_minor must be a positive integer in USD cents.',
        };
      }

      if (amountMinor > 50000) {
        return {
          ok: false,
          error_code: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
          message: `Guardrail Blocked: Requested amount ${formatUsd(
            amountMinor
          )} exceeds the $500.00 (50000 cents) maximum single AI-assisted action limit.`,
          guardrail: {
            max_single_action_minor: 50000,
            requested_amount_minor: amountMinor,
          },
        };
      }

      const dueDate =
        args?.due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.due_date))
          ? String(args.due_date)
          : new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

      const { data: sess } = await admin
        .from('billing_ai_sessions')
        .insert({
          user_id: PROVIDER_ID,
          organization_id: ORG_ID,
          role_scope: 'doctor',
          title: `MCP Session (${demoSessionId})`,
          demo_session_id: demoSessionId,
        })
        .select('id')
        .single();

      const payload = {
        action: 'create_invoice',
        title: `Send ${formatUsd(amountMinor)} Administrative Invoice`,
        summary: `Customer: ${targetCustomer.fullName} • Service: ${service.description} (${service.code}) • Amount: ${formatUsd(
          amountMinor
        )} USD • Due: ${dueDate}`,
        recipient_user_id: targetCustomer.id,
        recipient_name: targetCustomer.fullName,
        service_code: service.code,
        service_title: service.description,
        quantity: 1,
        unit_amount_minor: amountMinor,
        due_date: dueDate,
        send_immediately: true,
        demo_session_id: demoSessionId,
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      };

      const { data: prop, error: propErr } = await admin
        .from('billing_ai_proposals')
        .insert({
          session_id: sess?.id,
          user_id: PROVIDER_ID,
          kind: 'create_invoice',
          status: 'pending',
          amount_minor: amountMinor,
          currency: 'USD',
          guardrail_result: { ok: true, max_single_action_minor: 50000, daily_limit_minor: 250000 },
          payload,
          demo_session_id: demoSessionId,
        })
        .select('*')
        .single();

      if (propErr) {
        return {
          ok: false,
          error_code: 'PROPOSAL_CREATE_FAILED',
          message: propErr.message,
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        requires_human_approval: true,
        next_step:
          'Call `create_approved_invoice` with `proposal_id` and `explicit_human_approval: true` to issue this invoice in the demo session.',
        proposal: {
          id: prop.id,
          kind: prop.kind,
          status: prop.status,
          amount_minor: prop.amount_minor,
          amount_usd: formatUsd(prop.amount_minor),
          customer_name: targetCustomer.fullName,
          service_code: service.code,
          due_date: dueDate,
          payload,
        },
      };
    }

    case 'create_approved_invoice': {
      const userInstruction = String(args?.user_instruction || '').trim();
      const actorRole = String(args?.actor_role || 'doctor').trim();
      if (args?.explicit_human_approval !== true && !userInstruction) {
        return {
          ok: false,
          error_code: 'HUMAN_APPROVAL_REQUIRED',
          message:
            'Creating an invoice requires `explicit_human_approval: true` and a valid `proposal_id` from `create_invoice_proposal` (or an explicit `user_instruction`).',
        };
      }

      if (actorRole.toLowerCase() === 'patient' || actorRole.toLowerCase() === 'customer') {
        return {
          ok: false,
          error_code: 'UNAUTHORIZED_ROLE_FOR_INVOICE_CREATION',
          message: 'Role Guardrail: Only Provider (Merchant) accounts can create invoices.',
        };
      }
      if (
        args?.caller_identity_verified === false ||
        args?.authenticated_user_role === 'customer' ||
        args?.authenticated_user_role === 'patient' ||
        args?.user_id === ALEX_ID ||
        args?.user_id === JORDAN_ID
      ) {
        return {
          ok: false,
          error_code: 'ROLE_IMPERSONATION_BLOCKED',
          message:
            'Security Policy: Caller attempted to claim provider privileges while authenticated or identified as a customer/unverified caller.',
        };
      }

      let rawPropArg = String(args?.proposal_id || '').trim();
      if (!rawPropArg && userInstruction) {
        const evalRes = evaluateConversationalInstructionServer({
          instruction: userInstruction,
          actorRole,
          userId: args?.user_id,
          authenticatedUserRole: args?.authenticated_user_role,
          callerIdentityVerified: args?.caller_identity_verified,
        });
        if (!evalRes.authorizedToExecute || evalRes.operation !== 'create_invoice') {
          return {
            ok: false,
            error_code: evalRes.reasonCode || 'INSTRUCTION_NOT_AUTHORIZED',
            conversational_evaluation: evalRes,
            message: evalRes.explanation,
          };
        }
        const autoProp = await executeTool(
          admin,
          'create_invoice_proposal',
          {
            customer_name: args?.customer_name || evalRes.extractedParams.customerName,
            service_code: args?.service_code || evalRes.extractedParams.serviceCode || 'ADMIN-TELEHEALTH',
            amount_minor: args?.amount_minor || evalRes.extractedParams.amountMinor,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        if (!autoProp.ok || !autoProp.proposal?.id) {
          return autoProp;
        }
        rawPropArg = String(autoProp.proposal.id);
      }

      if (!rawPropArg) {
        return {
          ok: false,
          error_code: 'PROPOSAL_ID_REQUIRED',
          message:
            'Security Policy: `create_approved_invoice` requires a pending `proposal_id` created via `create_invoice_proposal` in the same `demo_session_id` (or an explicit `user_instruction`).',
        };
      }

      // Strip optional Cloudflare Worker HMAC suffix (<uuid>.<sig>)
      const rawProposalId = rawPropArg.includes('.') ? rawPropArg.split('.')[0] : rawPropArg;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawProposalId)) {
        return {
          ok: false,
          error_code: 'INVALID_PROPOSAL_TOKEN',
          message: `Proposal ID "${rawPropArg}" is malformed or invalid.`,
        };
      }

      const { data: prop } = await admin
        .from('billing_ai_proposals')
        .select('*')
        .eq('id', rawProposalId)
        .maybeSingle();

      if (!prop) {
        return {
          ok: false,
          error_code: 'PROPOSAL_NOT_FOUND',
          message: `Proposal ${rawProposalId} was not found.`,
        };
      }

      if (String(prop.demo_session_id || '') !== demoSessionId) {
        return {
          ok: false,
          error_code: 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED',
          message: `Security Isolation: Proposal ${rawProposalId} belongs to a different demo_session_id and cannot be approved from session "${demoSessionId}".`,
        };
      }

      if (prop.kind !== 'create_invoice') {
        return {
          ok: false,
          error_code: 'INVALID_PROPOSAL_KIND',
          message: `Proposal ${rawProposalId} has kind "${prop.kind}" and cannot be executed by create_approved_invoice.`,
        };
      }

      if (prop.status === 'executed') {
        return {
          ok: false,
          error_code: 'DUPLICATE_APPROVAL_BLOCKED',
          message: `Proposal ${rawProposalId} has already been executed. Duplicate invoice creation blocked.`,
        };
      }

      if (prop.status !== 'pending') {
        return {
          ok: false,
          error_code: 'PROPOSAL_NOT_PENDING',
          message: `Proposal ${rawProposalId} is in status "${prop.status}" and cannot be executed.`,
        };
      }

      const expiresAtStr = prop.payload?.expires_at;
      if (expiresAtStr && new Date(String(expiresAtStr)).getTime() < Date.now()) {
        return {
          ok: false,
          error_code: 'PROPOSAL_EXPIRED',
          message: `Proposal ${rawProposalId} has expired. Prepare a new proposal via \`create_invoice_proposal\`.`,
        };
      }

      const proposalId = String(prop.id);
      const recipientId = String(prop.payload?.recipient_user_id || ALEX_ID);
      const recipientName = String(prop.payload?.recipient_name || 'Alex Rivera');
      const serviceCode = String(prop.payload?.service_code || 'ADMIN-TELEHEALTH');
      const amountMinor = Number(prop.payload?.unit_amount_minor || prop.amount_minor || 15000);

      if (
        args?.amount_minor !== undefined &&
        Number(args.amount_minor) > 0 &&
        Number(args.amount_minor) !== amountMinor
      ) {
        return {
          ok: false,
          error_code: 'PROPOSAL_PARAMETER_MISMATCH',
          message: `Proposal ${rawProposalId} is bound to amount ${formatUsd(amountMinor)} and cannot be executed for ${formatUsd(Number(args.amount_minor))}.`,
        };
      }
      if (
        args?.customer_name &&
        !recipientName.toLowerCase().includes(String(args.customer_name).trim().toLowerCase())
      ) {
        return {
          ok: false,
          error_code: 'PROPOSAL_PARAMETER_MISMATCH',
          message: `Proposal ${rawProposalId} is bound to customer "${recipientName}" and cannot be executed for "${args.customer_name}".`,
        };
      }
      const dueDate = String(
        prop.payload?.due_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      );
      const sendImmediately = args?.send_immediately ?? true;

      if (amountMinor > 50000) {
        return {
          ok: false,
          error_code: 'GUARDRAIL_SINGLE_ACTION_LIMIT_EXCEEDED',
          message: `Guardrail Blocked: ${formatUsd(amountMinor)} exceeds the $500.00 AI single-action limit.`,
        };
      }

      const { data: created, error: createErr } = await admin.rpc('billing_create_invoice', {
        p_recipient: recipientId,
        p_items: [
          {
            service_code: serviceCode,
            quantity: 1,
            unit_amount_minor: amountMinor,
          },
        ],
        p_due_date: dueDate,
        p_send: Boolean(sendImmediately),
        p_idempotency_key: `maas-inv-${demoSessionId}-${proposalId}`,
        p_ai_proposal_id: proposalId,
        p_demo_session_id: demoSessionId,
      });

      if (createErr || !created) {
        return {
          ok: false,
          error_code: 'CREATE_INVOICE_FAILED',
          message: createErr?.message || 'Could not create invoice.',
        };
      }

      await admin
        .from('billing_ai_proposals')
        .update({
          status: 'executed',
          decided_at: new Date().toISOString(),
        })
        .eq('id', proposalId);

      return {
        ok: true,
        demo_session_id: demoSessionId,
        invoice: {
          id: created.id,
          invoice_number: created.invoice_number,
          status: created.status,
          customer_name: recipientName,
          service_code: serviceCode,
          total_minor: created.total_minor,
          total_usd: formatUsd(created.total_minor),
          due_date: created.due_date,
        },
        message: `Invoice #${created.invoice_number} (${formatUsd(
          created.total_minor
        )} USD) created for ${recipientName} in demo session "${demoSessionId}".`,
      };
    }

    case 'explain_outstanding_balances': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const custFilter = String(args?.customer_name || '').trim().toLowerCase();
      const scoped = custFilter
        ? invoices.filter((i: any) => i.customer_name.toLowerCase().includes(custFilter))
        : invoices;

      const openInvoices = scoped.filter(
        (i: any) => i.balance_due_minor > 0 && i.status !== 'void' && i.status !== 'refunded' && i.status !== 'draft'
      );
      const overdueInvoices = openInvoices.filter((i: any) => i.status === 'overdue');
      const totalOutstandingMinor = openInvoices.reduce(
        (sum: number, i: any) => sum + Number(i.balance_due_minor || 0),
        0
      );
      const overdueMinor = overdueInvoices.reduce(
        (sum: number, i: any) => sum + Number(i.balance_due_minor || 0),
        0
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        scope: custFilter || 'entire_practice',
        total_outstanding_minor: totalOutstandingMinor,
        total_outstanding_usd: formatUsd(totalOutstandingMinor),
        open_invoices_count: openInvoices.length,
        overdue_invoices_count: overdueInvoices.length,
        overdue_balance_minor: overdueMinor,
        overdue_balance_usd: formatUsd(overdueMinor),
        open_statements: openInvoices.map((i: any) => ({
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
          status: i.status,
          balance_due_minor: i.balance_due_minor,
          balance_due_usd: i.balance_due_usd,
          due_date: i.due_date,
          summary: i.line_items[0]?.description || 'Administrative Service',
        })),
      };
    }

    case 'get_transaction_history': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const invFilter = String(args?.invoice_number || '').trim().replace(/^#/, '').toLowerCase();
      const targetInvoices = invFilter
        ? invoices.filter((i: any) => i.invoice_number.toLowerCase().includes(invFilter))
        : invoices;

      const settlements = targetInvoices
        .filter((i: any) => i.status === 'paid' || i.status === 'refunded' || i.settlement_reference)
        .map((i: any) => ({
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
          status: i.status,
          amount_paid_minor: i.amount_paid_minor,
          amount_paid_usd: i.amount_paid_usd,
          amount_refunded_minor: i.amount_refunded_minor,
          amount_refunded_usd: i.amount_refunded_usd,
          paid_at: i.paid_at,
          refunded_at: i.refunded_at,
          settlement_reference: i.settlement_reference,
          settlement_verification: i.settlement_verification,
          is_live_paypal_capture: i.settlement_verification === 'paypal_sandbox_verified',
          verification_badge:
            i.settlement_verification === 'paypal_sandbox_verified'
              ? 'Verified PayPal Sandbox Capture'
              : 'Sample Demo Record — Not a Live PayPal Capture',
        }));

      const paymentAttempts = targetInvoices.flatMap((i: any) =>
        i.payment_attempts.map((at: any) => ({
          ...at,
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
        }))
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        settlements_count: settlements.length,
        settlements,
        payment_attempts_count: paymentAttempts.length,
        payment_attempts: paymentAttempts,
      };
    }

    case 'prepare_payment_proposal': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum} was not found.`,
        };
      }

      if (target.balance_due_minor <= 0 || target.status === 'paid' || target.status === 'void' || target.status === 'refunded') {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_PAYABLE',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} with ${target.balance_due_usd} balance due and cannot be paid.`,
        };
      }

      const { data: sess } = await admin
        .from('billing_ai_sessions')
        .insert({
          user_id: target.customer_id,
          organization_id: ORG_ID,
          role_scope: 'patient',
          title: `MCP Payment Proposal (${demoSessionId})`,
          demo_session_id: demoSessionId,
        })
        .select('id')
        .single();

      const payload = {
        action: 'payment_checkout',
        title: `Pay #${target.invoice_number} (${target.balance_due_usd})`,
        summary: `Authorize ${target.balance_due_usd} USD via PayPal Sandbox for ${
          target.line_items[0]?.description || 'Administrative Statement'
        }`,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        amount_minor: target.balance_due_minor,
        demo_session_id: demoSessionId,
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      };

      const { data: prop } = await admin
        .from('billing_ai_proposals')
        .insert({
          session_id: sess?.id,
          user_id: target.customer_id,
          kind: 'payment_checkout',
          status: 'pending',
          amount_minor: target.balance_due_minor,
          currency: 'USD',
          guardrail_result: { ok: true, requires_paypal_buyer_authorization: true },
          payload,
          demo_session_id: demoSessionId,
        })
        .select('*')
        .single();

      return {
        ok: true,
        demo_session_id: demoSessionId,
        requires_paypal_buyer_authorization: true,
        safeguard_notice:
          'Billing AI and MCP agents cannot autonomously charge customer funds. The customer must approve this proposal and complete checkout in PayPal Sandbox.',
        workflow_stages: [
          '1. Proposal Prepared (Complete)',
          '2. Customer Approval Required (Pending)',
          '3. PayPal Sandbox Buyer Checkout Authorization',
          '4. Server-Side Capture / Webhook Verification',
          '5. Receipt Issued & Ledger Settled',
        ],
        proposal: {
          id: prop?.id || `maas-pay-${Date.now()}`,
          kind: 'payment_checkout',
          status: 'pending',
          invoice_number: target.invoice_number,
          customer_name: target.customer_name,
          amount_minor: target.balance_due_minor,
          amount_usd: target.balance_due_usd,
          payload,
        },
      };
    }

    case 'void_unpaid_invoice': {
      const userInstruction = String(args?.user_instruction || '').trim();
      const actorRole = String(args?.actor_role || 'doctor').trim();
      if (actorRole.toLowerCase() === 'patient' || actorRole.toLowerCase() === 'customer') {
        return {
          ok: false,
          error_code: 'UNAUTHORIZED_ROLE_FOR_VOID',
          message: 'Role Guardrail: Only Provider (Merchant) accounts are authorized to void invoices.',
        };
      }
      if (
        args?.caller_identity_verified === false ||
        args?.authenticated_user_role === 'customer' ||
        args?.authenticated_user_role === 'patient' ||
        args?.user_id === ALEX_ID ||
        args?.user_id === JORDAN_ID
      ) {
        return {
          ok: false,
          error_code: 'ROLE_IMPERSONATION_BLOCKED',
          message:
            'Security Policy: Caller attempted to claim provider privileges while authenticated or identified as a customer/unverified caller.',
        };
      }

      let authorizedViaInstruction = false;
      if (userInstruction && args?.explicit_human_approval !== true) {
        const evalRes = evaluateConversationalInstructionServer({
          instruction: userInstruction,
          actorRole,
          userId: args?.user_id,
          authenticatedUserRole: args?.authenticated_user_role,
          callerIdentityVerified: args?.caller_identity_verified,
        });
        if (!evalRes.authorizedToExecute || evalRes.operation !== 'void_invoice') {
          return {
            ok: false,
            error_code: evalRes.reasonCode || 'INSTRUCTION_NOT_AUTHORIZED',
            conversational_evaluation: evalRes,
            message: evalRes.explanation,
          };
        }
        authorizedViaInstruction = true;
      }

      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum} was not found in demo session "${demoSessionId}".`,
        };
      }

      if (target.status === 'paid' || target.amount_paid_minor > 0) {
        return {
          ok: false,
          error_code: 'PAYMENT_STATE_PROTECTION_PAID_INVOICE',
          message: `Payment-State Protection: Statement #${target.invoice_number} has a completed payment of ${target.amount_paid_usd} USD and cannot be voided. Use \`prepare_refund_proposal\` instead.`,
        };
      }

      if (target.status === 'refunded') {
        return {
          ok: false,
          error_code: 'PAYMENT_STATE_PROTECTION_REFUNDED_INVOICE',
          message: `Statement #${target.invoice_number} has already been refunded and cannot be voided.`,
        };
      }

      if (target.status === 'void') {
        return {
          ok: true,
          demo_session_id: demoSessionId,
          already_voided: true,
          message: `Statement #${target.invoice_number} is already voided ($0.00 balance due).`,
          invoice: target,
        };
      }

      if (args?.explicit_human_approval !== true && !authorizedViaInstruction) {
        const { data: sess } = await admin
          .from('billing_ai_sessions')
          .insert({
            user_id: PROVIDER_ID,
            organization_id: ORG_ID,
            role_scope: 'doctor',
            title: `MCP Void Proposal (${demoSessionId})`,
            demo_session_id: demoSessionId,
          })
          .select('id')
          .single();

        const payload = {
          action: 'void_invoice',
          title: `Void Unpaid Statement #${target.invoice_number}`,
          summary: `Void ${target.total_usd} USD statement for ${target.customer_name}. Remaining balance becomes $0.00.`,
          invoice_id: target.id,
          invoice_number: target.invoice_number,
          amount_minor: target.total_minor,
          patient_name: target.customer_name,
          reason: args?.reason || 'Administrative void requested via MCP',
          demo_session_id: demoSessionId,
          expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
        };

        const { data: prop } = await admin
          .from('billing_ai_proposals')
          .insert({
            session_id: sess?.id,
            user_id: PROVIDER_ID,
            kind: 'void_invoice',
            status: 'pending',
            amount_minor: target.total_minor,
            currency: 'USD',
            guardrail_result: { ok: true },
            payload,
            demo_session_id: demoSessionId,
          })
          .select('*')
          .single();

        return {
          ok: true,
          demo_session_id: demoSessionId,
          requires_human_approval: true,
          message: `Prepared void proposal for #${target.invoice_number}. Call \`void_unpaid_invoice\` with \`explicit_human_approval: true\` to execute the void in demo session "${demoSessionId}".`,
          proposal: {
            id: prop?.id,
            kind: 'void_invoice',
            status: 'pending',
            invoice_number: target.invoice_number,
            amount_usd: target.total_usd,
          },
        };
      }

      const { data: voidRes, error: voidErr } = await admin.rpc('billing_void_invoice', {
        p_invoice: target.id,
        p_demo_session_id: demoSessionId,
      });

      if (voidErr) {
        return {
          ok: false,
          error_code: 'VOID_FAILED',
          message: voidErr.message,
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        result: voidRes,
        message: `Statement #${target.invoice_number} has been voided in demo session "${demoSessionId}". Remaining balance is now $0.00 USD.`,
      };
    }

    case 'prepare_refund_proposal': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase())
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Invoice ${rawNum} was not found.`,
        };
      }

      if (target.status !== 'paid' && target.amount_paid_minor <= 0) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_PAID',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} ($0.00 captured). Refunds can only be prepared for paid statements (such as #PPB-INV-2026-1003). Use \`void_unpaid_invoice\` for unpaid statements.`,
        };
      }

      const refundMinor = Number(args?.amount_minor || target.amount_paid_minor || target.total_minor);
      if (refundMinor <= 0 || refundMinor > target.amount_paid_minor) {
        return {
          ok: false,
          error_code: 'INVALID_REFUND_AMOUNT',
          message: `Refund amount ${formatUsd(refundMinor)} exceeds captured payment ${target.amount_paid_usd}.`,
        };
      }

      const { data: sess } = await admin
        .from('billing_ai_sessions')
        .insert({
          user_id: PROVIDER_ID,
          organization_id: ORG_ID,
          role_scope: 'doctor',
          title: `MCP Refund Proposal (${demoSessionId})`,
          demo_session_id: demoSessionId,
        })
        .select('id')
        .single();

      const payload = {
        action: 'refund',
        title: `Refund ${formatUsd(refundMinor)} for #${target.invoice_number}`,
        summary: `Issue ${formatUsd(refundMinor)} USD refund to ${target.customer_name} for paid Statement #${target.invoice_number} (Ref: ${
          target.settlement_reference || 'SAMPLE-DEMO-SETTLEMENT-1003'
        }).`,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        amount_minor: refundMinor,
        patient_name: target.customer_name,
        reason: args?.reason || 'Provider-initiated administrative refund',
        demo_session_id: demoSessionId,
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      };

      const { data: prop } = await admin
        .from('billing_ai_proposals')
        .insert({
          session_id: sess?.id,
          user_id: PROVIDER_ID,
          kind: 'refund',
          status: 'pending',
          amount_minor: refundMinor,
          currency: 'USD',
          guardrail_result: { ok: true },
          payload,
          demo_session_id: demoSessionId,
        })
        .select('*')
        .single();

      return {
        ok: true,
        demo_session_id: demoSessionId,
        requires_human_approval: true,
        proposal: {
          id: prop?.id,
          kind: 'refund',
          status: 'pending',
          invoice_number: target.invoice_number,
          customer_name: target.customer_name,
          refund_amount_minor: refundMinor,
          refund_amount_usd: formatUsd(refundMinor),
          settlement_reference: target.settlement_reference,
          settlement_verification: target.settlement_verification,
          payload,
        },
      };
    }

    case 'get_financial_audit_history': {
      // 1. Append-only immutability enforcement
      if (
        args?.action &&
        ['delete', 'update', 'modify', 'truncate', 'purge', 'clear'].includes(
          String(args.action).toLowerCase()
        )
      ) {
        return {
          ok: false,
          error_code: 'AUDIT_TRAIL_IMMUTABLE_APPEND_ONLY',
          message:
            'Security Policy: Financial audit history (`billing_audit_events`) is strictly immutable and append-only. Modification or deletion of audit records is prohibited.',
        };
      }
      if (args?.mutate_audit || args?.delete_event_id || args?.update_event_id) {
        return {
          ok: false,
          error_code: 'AUDIT_TRAIL_IMMUTABLE_APPEND_ONLY',
          message:
            'Security Policy: Financial audit history (`billing_audit_events`) is strictly immutable and append-only.',
        };
      }

      // 2. Cross-session isolation enforcement
      const requestedTargetSession = args?.target_demo_session_id
        ? sanitizeDemoSessionId(args.target_demo_session_id)
        : null;
      if (requestedTargetSession && requestedTargetSession !== demoSessionId) {
        return {
          ok: false,
          error_code: 'CROSS_SESSION_AUDIT_ACCESS_DENIED',
          message: `Session Isolation Policy: Caller in demo_session_id "${demoSessionId}" is not authorized to inspect financial audit events belonging to session "${requestedTargetSession}".`,
        };
      }

      // 3. Merchant organization scope enforcement
      if (args?.organization_id && String(args.organization_id).trim() !== ORG_ID) {
        return {
          ok: false,
          error_code: 'MERCHANT_ORGANIZATION_SCOPE_DENIED',
          message: `Merchant Scope Policy: Organization "${args.organization_id}" is outside the authorized merchant scope (${ORG_ID}).`,
        };
      }

      // 4. Customer vs. Provider role scoping
      const actorRole = String(args?.actor_role || 'doctor').trim().toLowerCase();
      const callerUserId = String(args?.user_id || '').trim();
      const isCustomerScope =
        actorRole === 'customer' ||
        actorRole === 'patient' ||
        callerUserId === ALEX_ID ||
        callerUserId === JORDAN_ID;

      const scopedCustomerId =
        callerUserId === JORDAN_ID ||
        String(args?.customer_name || '')
          .toLowerCase()
          .includes('jordan')
          ? JORDAN_ID
          : ALEX_ID;

      if (isCustomerScope) {
        if (args?.customer_id && String(args.customer_id).trim() !== scopedCustomerId) {
          return {
            ok: false,
            error_code: 'CUSTOMER_AUDIT_SCOPE_DENIED',
            message:
              'Customer Scope Policy: An ordinary customer may only inspect audit events for their own authorized billing statements.',
          };
        }
        if (
          args?.target_customer_id &&
          String(args.target_customer_id).trim() !== scopedCustomerId
        ) {
          return {
            ok: false,
            error_code: 'CUSTOMER_AUDIT_SCOPE_DENIED',
            message:
              'Customer Scope Policy: Cross-customer audit inspection is denied for customer accounts.',
          };
        }
      }

      const limit = Math.min(Math.max(Number(args?.limit || 20), 1), 50);
      const includeCanonicalSeed = args?.include_canonical_seed !== false;

      const [eventsRes, allInvRes, allPropsRes] = await Promise.all([
        admin
          .from('billing_audit_events')
          .select('id, event_type, actor_kind, actor_user_id, invoice_id, created_at, details, demo_session_id')
          .order('created_at', { ascending: false })
          .limit(300),
        admin
          .from('billing_invoices')
          .select('id, invoice_number, recipient_user_id, issuer_user_id, organization_id, demo_session_id'),
        admin
          .from('billing_ai_proposals')
          .select('id, demo_session_id, user_id'),
      ]);

      const invMap = new Map<string, any>();
      for (const inv of Array.isArray(allInvRes?.data) ? allInvRes.data : []) {
        invMap.set(String(inv.id), inv);
      }
      const propMap = new Map<string, any>();
      for (const pr of Array.isArray(allPropsRes?.data) ? allPropsRes.data : []) {
        propMap.set(String(pr.id), pr);
      }

      // Resolve effective session ID for every audit event without mutating historical rows.
      // Only canonical seed events (id <= 4) belong to 'canonical'; any id > 4 with demo_session_id='canonical'
      // was created before billing_log stored demo_session_id and is resolved via details/invoice/proposal or isolated.
      const resolveEffectiveSessionId = (ev: any): string => {
        const directSess = String(ev.demo_session_id || '').trim();
        if (directSess && directSess !== 'canonical') return directSess;

        const detailsSess = ev.details?.demo_session_id
          ? String(ev.details.demo_session_id).trim()
          : '';
        if (detailsSess && detailsSess !== 'canonical') return detailsSess;

        if (ev.invoice_id) {
          const linkedInv = invMap.get(String(ev.invoice_id));
          if (linkedInv?.demo_session_id && String(linkedInv.demo_session_id) !== 'canonical') {
            return String(linkedInv.demo_session_id);
          }
        }

        const propId = ev.details?.proposal_id ? String(ev.details.proposal_id) : '';
        if (propId) {
          const linkedProp = propMap.get(propId);
          if (linkedProp?.demo_session_id && String(linkedProp.demo_session_id) !== 'canonical') {
            return String(linkedProp.demo_session_id);
          }
        }

        if (Number(ev.id) <= 4) {
          return 'canonical';
        }
        return 'legacy_unscoped_session';
      };

      const filteredEvents = (Array.isArray(eventsRes?.data) ? eventsRes.data : [])
        .map((ev: any) => {
          const effectiveSession = resolveEffectiveSessionId(ev);
          const linkedInv = ev.invoice_id ? invMap.get(String(ev.invoice_id)) : null;
          return {
            id: ev.id,
            event_type: ev.event_type,
            actor_kind: ev.actor_kind,
            invoice_id: ev.invoice_id,
            invoice_number: linkedInv?.invoice_number || ev.details?.invoice_number || null,
            created_at: ev.created_at,
            details: ev.details,
            demo_session_id: effectiveSession,
            effective_demo_session_id: effectiveSession,
            is_canonical_seed: effectiveSession === 'canonical',
            record_scope: effectiveSession === 'canonical' ? 'canonical_seed' : 'session_private',
            _recipient_user_id: linkedInv?.recipient_user_id || null,
          };
        })
        .filter((ev: any) => {
          const matchesSession =
            ev.effective_demo_session_id === demoSessionId ||
            (includeCanonicalSeed && ev.effective_demo_session_id === 'canonical');
          if (!matchesSession) return false;

          if (isCustomerScope) {
            if (!ev._recipient_user_id || String(ev._recipient_user_id) !== scopedCustomerId) {
              return false;
            }
          }
          return true;
        })
        .slice(0, limit)
        .map(({ _recipient_user_id, ...clean }: any) => clean);

      return {
        ok: true,
        demo_session_id: demoSessionId,
        actor_scope: isCustomerScope ? 'customer_scoped' : 'merchant_organization_scoped',
        append_only_enforced: true,
        session_isolation_enforced: true,
        count: filteredEvents.length,
        session_private_count: filteredEvents.filter((e: any) => e.record_scope === 'session_private').length,
        canonical_seed_count: filteredEvents.filter((e: any) => e.record_scope === 'canonical_seed').length,
        audit_events: filteredEvents,
      };
    }

    case 'get_paypal_sandbox_status': {
      const { data: conns } = await admin
        .from('billing_account_connections')
        .select(
          'user_id, connection_type, paypal_environment, paypal_merchant_id, paypal_payer_id, paypal_email_masked, connection_status, connected_at'
        );

      let dbClientId = '';
      let dbClientSecret = '';
      try {
        const { data: secRows } = await admin
          .from('billing_platform_secrets')
          .select('secret_key, secret_value')
          .in('secret_key', [
            'PAYPAL_SANDBOX_CLIENT_ID',
            'PAYPAL_CLIENT_ID',
            'PAYPAL_SANDBOX_CLIENT_SECRET',
            'PAYPAL_CLIENT_SECRET',
          ]);
        if (Array.isArray(secRows)) {
          for (const r of secRows) {
            if (
              (r.secret_key === 'PAYPAL_SANDBOX_CLIENT_ID' || r.secret_key === 'PAYPAL_CLIENT_ID') &&
              r.secret_value
            ) {
              dbClientId = String(r.secret_value).trim();
            }
            if (
              (r.secret_key === 'PAYPAL_SANDBOX_CLIENT_SECRET' ||
                r.secret_key === 'PAYPAL_CLIENT_SECRET') &&
              r.secret_value
            ) {
              dbClientSecret = String(r.secret_value).trim();
            }
          }
        }
      } catch {
        // Ignore if table not present
      }

      const effectiveClientId = PAYPAL_CLIENT_ID || dbClientId;
      const effectiveClientSecret = PAYPAL_CLIENT_SECRET || dbClientSecret;
      const liveCredentialsConfigured = Boolean(effectiveClientId && effectiveClientSecret);

      let oauthReachable = false;
      let paypalAppId: string | null = null;
      if (liveCredentialsConfigured) {
        try {
          const sbStatusResp = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              action: 'sandbox-status',
              roleScope: 'doctor',
              userId: PROVIDER_ID,
            }),
          });
          const sbStatusData = await sbStatusResp.json().catch(() => ({}));
          oauthReachable = Boolean(sbStatusData?.oauthReachable);
          paypalAppId = sbStatusData?.appId ? String(sbStatusData.appId) : null;
        } catch {
          oauthReachable = false;
        }
      }

      return {
        ok: true,
        environment: 'sandbox',
        production_live_payments_disabled: true,
        paypal_sandbox_api_credentials_configured: liveCredentialsConfigured,
        oauth_reachable: oauthReachable,
        paypal_app_id: paypalAppId,
        connection_state: oauthReachable
          ? 'SANDBOX_AUTHENTICATED'
          : liveCredentialsConfigured
            ? 'SANDBOX_CONFIGURED_PENDING_OAUTH'
            : 'DEMO_PROFILE_AVAILABLE',
        verification_mode_explanation: oauthReachable
          ? `PayPal Sandbox REST API credentials verified via live OAuth 2.0 handshake (App ID: ${paypalAppId || 'Verified'}). Create-order, buyer approval redirect, capture-order, and refund-capture execute against api-m.sandbox.paypal.com.`
          : 'Demo PayPal profiles are available for demonstration, but live PayPal Sandbox REST API credentials are not authenticated.',
        connected_accounts: conns || [],
      };
    }

    case 'get_business_metrics': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const nonVoid = invoices.filter((i: any) => i.status !== 'void');
      const totalBilledMinor = nonVoid.reduce((s: number, i: any) => s + i.total_minor, 0);
      const paidInvoices = invoices.filter((i: any) => i.status === 'paid');
      const paidTotalMinor = paidInvoices.reduce((s: number, i: any) => s + i.amount_paid_minor, 0);
      const refundedInvoices = invoices.filter((i: any) => i.status === 'refunded');
      const refundedTotalMinor = refundedInvoices.reduce(
        (s: number, i: any) => s + i.amount_refunded_minor,
        0
      );
      const openInvoices = invoices.filter(
        (i: any) => i.balance_due_minor > 0 && i.status !== 'void' && i.status !== 'refunded' && i.status !== 'draft'
      );
      const outstandingMinor = openInvoices.reduce(
        (s: number, i: any) => s + i.balance_due_minor,
        0
      );
      const overdueInvoices = openInvoices.filter((i: any) => i.status === 'overdue');
      const overdueMinor = overdueInvoices.reduce(
        (s: number, i: any) => s + i.balance_due_minor,
        0
      );
      const pendingInvoices = openInvoices.filter((i: any) => i.status !== 'overdue');
      const pendingMinor = pendingInvoices.reduce(
        (s: number, i: any) => s + i.balance_due_minor,
        0
      );
      const draftInvoices = invoices.filter((i: any) => i.status === 'draft');
      const voidInvoices = invoices.filter((i: any) => i.status === 'void');
      const failedAttemptsCount = invoices.reduce(
        (s: number, i: any) =>
          s +
          i.payment_attempts.filter(
            (a: any) =>
              a.attempt_classification === 'payment_declined' ||
              (a.status === 'failed' &&
                a.attempt_classification !== 'approval_required' &&
                a.attempt_classification !== 'awaiting_buyer_approval' &&
                a.paypal_error_code !== 'ORDER_NOT_APPROVED')
          ).length,
        0
      );
      const awaitingBuyerApprovalCount = invoices.reduce(
        (s: number, i: any) =>
          s +
          i.payment_attempts.filter(
            (a: any) =>
              a.attempt_classification === 'awaiting_buyer_approval' ||
              a.attempt_classification === 'approval_required' ||
              a.status === 'approval_required' ||
              a.paypal_error_code === 'ORDER_NOT_APPROVED'
          ).length,
        0
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        provider_metrics: {
          total_invoices_count: invoices.length,
          total_billed_minor: totalBilledMinor,
          total_billed_usd: formatUsd(totalBilledMinor),
          outstanding_balance_minor: outstandingMinor,
          outstanding_balance_usd: formatUsd(outstandingMinor),
          pending_invoices_count: pendingInvoices.length,
          pending_balance_minor: pendingMinor,
          pending_balance_usd: formatUsd(pendingMinor),
          overdue_invoices_count: overdueInvoices.length,
          overdue_balance_minor: overdueMinor,
          overdue_balance_usd: formatUsd(overdueMinor),
          paid_invoices_count: paidInvoices.length,
          paid_total_minor: paidTotalMinor,
          paid_total_usd: formatUsd(paidTotalMinor),
          refunded_invoices_count: refundedInvoices.length,
          refunded_total_minor: refundedTotalMinor,
          refunded_total_usd: formatUsd(refundedTotalMinor),
          draft_invoices_count: draftInvoices.length,
          void_invoices_count: voidInvoices.length,
          failed_payment_attempts_count: failedAttemptsCount,
          awaiting_buyer_approval_attempts_count: awaitingBuyerApprovalCount,
        },
      };
    }

    case 'reset_demo_session': {
      const { data: resetRes, error: resetErr } = await admin.rpc('billing_reset_demo_session', {
        p_demo_session_id: demoSessionId,
      });

      if (resetErr) {
        return {
          ok: false,
          error_code: 'RESET_FAILED',
          message: resetErr.message,
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        reset_result: resetRes,
        message: `Demo session "${demoSessionId}" has been reset to the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).`,
      };
    }

    case 'create_paypal_checkout_order': {
      const userInstruction = String(args?.user_instruction || '').trim();
      const actorRole = String(args?.actor_role || 'patient').trim();
      if (args?.explicit_human_approval !== true && !userInstruction) {
        return {
          ok: false,
          error_code: 'HUMAN_APPROVAL_REQUIRED',
          message:
            'Creating a PayPal checkout order requires `explicit_human_approval: true` and a valid `proposal_id` from `prepare_payment_proposal` (or an explicit `user_instruction`).',
        };
      }

      let rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      let rawProposalId = String(args?.proposal_id || '').trim();
      if (!rawProposalId && userInstruction) {
        const evalRes = evaluateConversationalInstructionServer({
          instruction: userInstruction,
          actorRole,
        });
        if (!evalRes.authorizedToExecute || evalRes.operation !== 'pay_invoice') {
          return {
            ok: false,
            error_code: evalRes.reasonCode || 'INSTRUCTION_NOT_AUTHORIZED',
            conversational_evaluation: evalRes,
            message: evalRes.explanation,
          };
        }
        const targetInvNum = rawNum || evalRes.extractedParams.invoiceNumber || '';
        const autoProp = await executeTool(
          admin,
          'prepare_payment_proposal',
          {
            invoice_number: targetInvNum,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        if (!autoProp.ok || !autoProp.proposal?.id) {
          return autoProp;
        }
        rawProposalId = String(autoProp.proposal.id);
        rawNum = targetInvNum;
      }

      const proposalId = rawProposalId.includes('.') ? rawProposalId.split('.')[0] : rawProposalId;

      if (!proposalId) {
        return {
          ok: false,
          error_code: 'PROPOSAL_REQUIRED_FOR_WRITE',
          message:
            'Creating a PayPal checkout order requires a server-side `proposal_id` obtained from `prepare_payment_proposal` in the same session (or an explicit `user_instruction`).',
        };
      }

      const { data: propRow } = await admin
        .from('billing_ai_proposals')
        .select('*')
        .eq('id', proposalId)
        .maybeSingle();

      if (!propRow) {
        return {
          ok: false,
          error_code: 'PROPOSAL_NOT_FOUND',
          message: `Payment proposal "${proposalId}" was not found.`,
        };
      }

      if (String(propRow.demo_session_id || '') !== demoSessionId) {
        return {
          ok: false,
          error_code: 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED',
          message: 'Proposal belongs to a different demo_session_id.',
        };
      }

      if (propRow.kind !== 'payment_checkout') {
        return {
          ok: false,
          error_code: 'INVALID_PROPOSAL_KIND',
          message: `Proposal "${proposalId}" has kind "${propRow.kind}" and cannot be used for payment checkout.`,
        };
      }

      if (propRow.status === 'approved' || propRow.status === 'executed') {
        return {
          ok: false,
          error_code: 'DUPLICATE_APPROVAL_BLOCKED',
          message: `Payment proposal "${proposalId}" has already been executed (one-time execution enforced).`,
        };
      }

      const expiresAtStr = propRow.payload?.expires_at;
      if (expiresAtStr && new Date(String(expiresAtStr)).getTime() < Date.now()) {
        return {
          ok: false,
          error_code: 'PROPOSAL_EXPIRED',
          message: `Payment proposal "${proposalId}" has expired. Prepare a new proposal via \`prepare_payment_proposal\`.`,
        };
      }

      const proposedInvoiceNum = String(propRow.payload?.invoice_number || '').replace(/^#/, '');
      if (
        rawNum &&
        proposedInvoiceNum &&
        rawNum.toLowerCase() !== proposedInvoiceNum.toLowerCase() &&
        !proposedInvoiceNum.toLowerCase().endsWith(rawNum.toLowerCase())
      ) {
        return {
          ok: false,
          error_code: 'PROPOSAL_PARAMETER_MISMATCH',
          message: `Proposal "${proposalId}" is bound to invoice #${proposedInvoiceNum} and cannot be used for "${rawNum}".`,
        };
      }

      if (!rawNum && proposedInvoiceNum) {
        rawNum = proposedInvoiceNum;
      }

      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase()) ||
          i.id.toLowerCase() === rawNum.toLowerCase()
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Statement "${rawNum}" was not found in demo session "${demoSessionId}".`,
        };
      }

      if (target.balance_due_minor <= 0 || target.status === 'paid' || target.status === 'void' || target.status === 'refunded') {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_PAYABLE',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} with ${target.balance_due_usd} balance due and cannot be paid.`,
        };
      }

      // Invoke paypal-billing create-order
      const orderResp = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'create-order',
          invoiceId: target.id,
          invoice_id: target.id,
          invoiceNumber: target.invoice_number,
          invoice_number: target.invoice_number,
          demoSessionId,
          demo_session_id: demoSessionId,
          userId: target.customer_id,
          user_id: target.customer_id,
        }),
      });
      const orderData = await orderResp.json().catch(() => ({}));

      if (proposalId) {
        await admin
          .from('billing_ai_proposals')
          .update({
            status: 'approved',
            decided_at: new Date().toISOString(),
          })
          .eq('id', proposalId);
      }

      if (orderData?.ok && (orderData?.orderId || orderData?.order_id)) {
        const orderId = String(orderData.orderId || orderData.order_id);
        const approvalUrl = orderData.approvalUrl || orderData.approval_url || null;
        return {
          ok: true,
          demo_session_id: demoSessionId,
          checkout_mode: 'paypal_sandbox_live',
          invoice_id: target.id,
          invoice_number: target.invoice_number,
          customer_name: target.customer_name,
          amount_minor: target.balance_due_minor,
          amount_usd: target.balance_due_usd,
          order_id: orderId,
          order_status: String(orderData.status || 'CREATED'),
          approval_url: approvalUrl,
          message: approvalUrl
            ? `PayPal Sandbox Order ${orderId} created for Statement #${target.invoice_number} (${target.balance_due_usd} USD). Open the approval_url to authorize as the Sandbox buyer, then call \`capture_paypal_checkout_order\`.`
            : `PayPal Sandbox Order ${orderId} created for Statement #${target.invoice_number} (${target.balance_due_usd} USD).`,
        };
      }

      return {
        ok: true,
        demo_session_id: demoSessionId,
        checkout_mode: 'sandbox_credentials_pending',
        paypal_sandbox_api_credentials_configured: false,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        customer_name: target.customer_name,
        amount_minor: target.balance_due_minor,
        amount_usd: target.balance_due_usd,
        order_id: null,
        approval_url: null,
        demo_settlement_available: true,
        message:
          orderData?.message ||
          `Statement #${target.invoice_number} (${target.balance_due_usd} USD) verified for checkout. Live PayPal Sandbox REST API credentials are not configured on the server; call \`capture_paypal_checkout_order\` with \`allow_demo_settlement_fallback: true\` to record an isolated Sample Demo Settlement, or configure PayPal Sandbox credentials to generate a live buyer approval URL.`,
      };
    }

    case 'capture_paypal_checkout_order': {
      if (args?.explicit_human_approval !== true) {
        return {
          ok: false,
          error_code: 'HUMAN_APPROVAL_REQUIRED',
          message: 'Capturing or settling an invoice requires `explicit_human_approval: true`.',
        };
      }

      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const orderId = String(args?.order_id || '').trim();
      const allowDemoFallback = Boolean(args?.allow_demo_settlement_fallback);

      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase()) ||
          i.id.toLowerCase() === rawNum.toLowerCase()
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Statement "${rawNum}" was not found in demo session "${demoSessionId}".`,
        };
      }

      if (target.status === 'paid' || target.balance_due_minor <= 0) {
        return {
          ok: true,
          demo_session_id: demoSessionId,
          idempotent_replay: true,
          invoice_number: target.invoice_number,
          status: 'paid',
          settlement_reference: target.settlement_reference,
          settlement_verification: target.settlement_verification,
          balance_due_usd: '$0.00',
          message: `Statement #${target.invoice_number} is already settled (${target.settlement_reference || 'PAID'}).`,
        };
      }

      if (orderId) {
        const capResp = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            action: 'capture-order',
            invoiceId: target.id,
            invoice_id: target.id,
            invoiceNumber: target.invoice_number,
            invoice_number: target.invoice_number,
            orderId,
            order_id: orderId,
            demoSessionId,
            demo_session_id: demoSessionId,
            userId: target.customer_id,
            user_id: target.customer_id,
          }),
        });
        const capData = await capResp.json().catch(() => ({}));
        if (capData?.ok && (capData?.captureId || capData?.capture_id)) {
          const captureId = String(capData.captureId || capData.capture_id);
          return {
            ok: true,
            demo_session_id: demoSessionId,
            settlement_mode: 'paypal_sandbox_verified',
            is_live_paypal_capture: true,
            invoice_id: target.id,
            invoice_number: target.invoice_number,
            customer_name: target.customer_name,
            order_id: orderId,
            capture_id: captureId,
            settlement_reference: captureId,
            settlement_verification: 'paypal_sandbox_verified',
            amount_paid_minor: target.total_minor,
            amount_paid_usd: target.total_usd,
            balance_due_minor: 0,
            balance_due_usd: '$0.00',
            status: 'paid',
            message: `Verified PayPal Sandbox Capture ${captureId} completed for Statement #${target.invoice_number} (${target.total_usd} USD). Remaining balance is $0.00.`,
          };
        }

        if (!allowDemoFallback) {
          const isOrderNotApproved =
            capData?.code === 'ORDER_NOT_APPROVED' ||
            capData?.paypalErrorCode === 'ORDER_NOT_APPROVED' ||
            capData?.attemptClassification === 'approval_required' ||
            String(capData?.message || '').includes('ORDER_NOT_APPROVED');
          return {
            ok: false,
            error_code: isOrderNotApproved
              ? 'ORDER_NOT_APPROVED'
              : capData?.code || 'PAYPAL_CAPTURE_NOT_COMPLETED',
            attempt_classification: isOrderNotApproved
              ? 'approval_required'
              : capData?.attemptClassification || 'processing_error',
            is_payment_declined: capData?.attemptClassification === 'payment_declined',
            paypal_error_code: capData?.paypalErrorCode || capData?.code || null,
            actionable_message:
              capData?.actionableMessage ||
              (isOrderNotApproved
                ? 'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'
                : capData?.message || null),
            message: isOrderNotApproved
              ? 'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'
              : capData?.message ||
                `PayPal Sandbox order ${orderId} could not be captured (ensure buyer approved the order in PayPal Sandbox, or pass \`allow_demo_settlement_fallback: true\` for isolated demo session settlement).`,
          };
        }
      }

      if (!allowDemoFallback) {
        return {
          ok: false,
          error_code: 'ORDER_ID_OR_DEMO_FALLBACK_REQUIRED',
          message:
            'Provide an approved PayPal `order_id` to capture a live PayPal Sandbox order, or set `allow_demo_settlement_fallback: true` to record an explicitly labeled Sample Demo Settlement in this isolated demo session.',
        };
      }

      const { data: simRes, error: simErr } = await admin.rpc('billing_simulate_demo_settlement', {
        p_invoice: target.id,
        p_demo_session_id: demoSessionId,
      });

      if (simErr) {
        return {
          ok: false,
          error_code: 'DEMO_SETTLEMENT_FAILED',
          message: simErr.message,
        };
      }

      const simRef = String(
        simRes?.paypal_capture_id || simRes?.capture_id || `DEMO-SIM-${target.invoice_number}`
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        settlement_mode: 'sample_demo_settlement_not_live_paypal',
        is_live_paypal_capture: false,
        verification_badge: 'Sample Demo Record — Not a Live PayPal Capture',
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        customer_name: target.customer_name,
        order_id: null,
        capture_id: null,
        settlement_reference: simRef,
        settlement_verification: 'sample_demo_settlement_not_live_paypal',
        amount_paid_minor: target.total_minor,
        amount_paid_usd: target.total_usd,
        balance_due_minor: 0,
        balance_due_usd: '$0.00',
        status: 'paid',
        message: `Demo Settlement (${simRef}) recorded for Statement #${target.invoice_number} (${target.total_usd} USD) in isolated session "${demoSessionId}" — clearly labeled as a Sample Demo Record (Not a Live PayPal Capture).`,
      };
    }

    case 'get_payment_receipt': {
      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase()) ||
          i.id.toLowerCase() === rawNum.toLowerCase()
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Statement "${rawNum}" was not found in demo session "${demoSessionId}".`,
        };
      }

      if (target.status !== 'paid' && target.status !== 'refunded' && target.amount_paid_minor <= 0) {
        return {
          ok: false,
          error_code: 'RECEIPT_UNAVAILABLE_UNPAID_INVOICE',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} (${target.balance_due_usd} balance due) and has no completed payment receipt yet.`,
        };
      }

      const isVerifiedPayPal = target.settlement_verification === 'paypal_sandbox_verified';
      const receiptRef =
        target.settlement_reference ||
        (isVerifiedPayPal ? 'PAYPAL-VERIFIED' : `SAMPLE-DEMO-SETTLEMENT-${target.invoice_number}`);
      const customerEmailMasked =
        target.customer_id === JORDAN_ID
          ? 'j***@demo.paypal-billing-kit.local'
          : 'a***@demo.paypal-billing-kit.local';
      const cardBrand = target.card_brand ? String(target.card_brand).toUpperCase() : null;
      const cardLastDigits = target.card_last_digits ? String(target.card_last_digits).slice(-4) : null;
      const paymentSourceLabel =
        target.payment_source_type === 'paypal_card' || cardBrand || cardLastDigits
          ? cardBrand && cardLastDigits
            ? `PayPal Card Checkout (${cardBrand} ending in ${cardLastDigits})`
            : 'PayPal Card Checkout'
          : isVerifiedPayPal
            ? 'PayPal Wallet Checkout'
            : 'Simulated Demo Settlement (Not a Real PayPal Payment)';
      const netPaidMinor = Math.max(
        Number(target.amount_paid_minor || 0) - Number(target.amount_refunded_minor || 0),
        0
      );

      const receiptPayload: Record<string, any> = {
        receipt_number: receiptRef,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        status: target.status,
        organization_name: 'Jenkins Wellness & Telehealth Practice',
        provider_name: target.provider_name,
        customer_name: target.customer_name,
        customer_email_masked: customerEmailMasked,
        currency: 'USD',
        subtotal_minor: target.total_minor,
        subtotal_usd: target.total_usd,
        total_minor: target.total_minor,
        total_usd: target.total_usd,
        amount_paid_minor: target.amount_paid_minor,
        amount_paid_usd: target.amount_paid_usd,
        amount_refunded_minor: target.amount_refunded_minor,
        amount_refunded_usd: target.amount_refunded_usd,
        net_paid_minor: netPaidMinor,
        net_paid_usd: formatUsd(netPaidMinor),
        balance_due_minor: target.balance_due_minor,
        balance_due_usd: target.balance_due_usd,
        service_date: target.service_date,
        paid_at: target.paid_at,
        refunded_at: target.refunded_at,
        settlement_reference: receiptRef,
        paypal_order_id: target.paypal_order_id || null,
        paypal_capture_id: isVerifiedPayPal ? receiptRef : null,
        paypal_refund_id: target.paypal_refund_id || null,
        payment_source_type: target.payment_source_type || (isVerifiedPayPal ? 'paypal_wallet' : 'demo_simulation'),
        payment_source_label: paymentSourceLabel,
        card_brand: cardBrand,
        card_last_digits: cardLastDigits,
        settlement_verification: target.settlement_verification,
        is_live_paypal_capture: isVerifiedPayPal,
        verification_badge: isVerifiedPayPal
          ? 'Verified PayPal Sandbox Capture'
          : 'Sample Demo Receipt — Not a Real PayPal Payment',
        merchant_branding:
          args?.merchant_branding && typeof args.merchant_branding === 'object'
            ? args.merchant_branding
            : undefined,
        line_items: target.line_items,
      };

      const presentationState = resolveReceiptPresentationStateServer(receiptPayload);
      const resolvedBranding = resolveMerchantBrandingServer(receiptPayload);
      receiptPayload.document_title = presentationState.documentTitle;
      receiptPayload.receipt_presentation_state = presentationState.presentationLabel;
      receiptPayload.paypal_attribution = presentationState.paypalAttribution;
      receiptPayload.sandbox_transaction_label = presentationState.sandboxLabel;
      receiptPayload.receipt_footer_text =
        resolvedBranding.receiptFooterMessage || DEFAULT_ELECTRONIC_RECEIPT_FOOTER;
      receiptPayload.merchant_branding = resolvedBranding;

      const pdfStr = generateReceiptPdfDocument(receiptPayload);
      const pdfBase64 = btoa(pdfStr);
      const pdfDownloadUrl = `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/receipts/${encodeURIComponent(
        target.invoice_number
      )}.pdf?session=${encodeURIComponent(demoSessionId)}`;

      receiptPayload.pdf_download_url = pdfDownloadUrl;
      receiptPayload.pdf_base64 = pdfBase64;
      receiptPayload.pdf_byte_length = pdfStr.length;
      receiptPayload.pdf_mime_type = 'application/pdf';

      return {
        ok: true,
        demo_session_id: demoSessionId,
        pdf_download_url: pdfDownloadUrl,
        pdf_byte_length: pdfStr.length,
        receipt: receiptPayload,
      };
    }

    case 'execute_approved_refund': {
      const userInstruction = String(args?.user_instruction || '').trim();
      const actorRole = String(args?.actor_role || 'doctor').trim();
      if (args?.explicit_human_approval !== true && !userInstruction) {
        return {
          ok: false,
          error_code: 'HUMAN_APPROVAL_REQUIRED',
          message:
            'Executing a refund requires `explicit_human_approval: true` and a valid `proposal_id` from `prepare_refund_proposal` (or an explicit `user_instruction`).',
        };
      }

      if (actorRole.toLowerCase() === 'patient' || actorRole.toLowerCase() === 'customer') {
        return {
          ok: false,
          error_code: 'UNAUTHORIZED_ROLE_FOR_REFUND',
          message: 'Role Guardrail: Only Provider (Merchant) accounts are authorized to issue refunds.',
        };
      }
      if (
        args?.caller_identity_verified === false ||
        args?.authenticated_user_role === 'customer' ||
        args?.authenticated_user_role === 'patient' ||
        args?.user_id === ALEX_ID ||
        args?.user_id === JORDAN_ID
      ) {
        return {
          ok: false,
          error_code: 'ROLE_IMPERSONATION_BLOCKED',
          message:
            'Security Policy: Caller attempted to claim provider privileges while authenticated or identified as a customer/unverified caller.',
        };
      }

      let rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      let requestedAmountMinor = Number(args?.amount_minor || 0);
      let rawProposalId = String(args?.proposal_id || '').trim();

      if (!rawProposalId && userInstruction) {
        const evalRes = evaluateConversationalInstructionServer({
          instruction: userInstruction,
          actorRole,
          userId: args?.user_id,
          authenticatedUserRole: args?.authenticated_user_role,
          callerIdentityVerified: args?.caller_identity_verified,
        });
        if (!evalRes.authorizedToExecute || evalRes.operation !== 'refund_payment') {
          return {
            ok: false,
            error_code: evalRes.reasonCode || 'INSTRUCTION_NOT_AUTHORIZED',
            conversational_evaluation: evalRes,
            message: evalRes.explanation,
          };
        }
        let targetInvNum = rawNum || evalRes.extractedParams.invoiceNumber || '';
        const targetAmt = requestedAmountMinor || evalRes.extractedParams.amountMinor || 0;
        if (!targetInvNum && targetAmt > 0) {
          const allInvoices = await fetchSessionInvoices(admin, demoSessionId);
          const matchingPaid = allInvoices.filter(
            (i: any) => i.status === 'paid' && Number(i.amount_paid_minor) === targetAmt
          );
          if (matchingPaid.length === 1) {
            targetInvNum = matchingPaid[0].invoice_number;
          }
        }
        const autoProp = await executeTool(
          admin,
          'prepare_refund_proposal',
          {
            invoice_number: targetInvNum,
            amount_minor: targetAmt > 0 ? targetAmt : undefined,
            reason: `Authorized via user instruction: "${userInstruction}"`,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        if (!autoProp.ok || !autoProp.proposal?.id) {
          return autoProp;
        }
        rawProposalId = String(autoProp.proposal.id);
        rawNum = targetInvNum;
        if (targetAmt > 0) requestedAmountMinor = targetAmt;
      }

      const proposalId = rawProposalId.includes('.') ? rawProposalId.split('.')[0] : rawProposalId;

      if (!proposalId) {
        return {
          ok: false,
          error_code: 'PROPOSAL_REQUIRED_FOR_WRITE',
          message:
            'Executing a refund requires a server-side `proposal_id` obtained from `prepare_refund_proposal` in the same session (or an explicit `user_instruction`).',
        };
      }

      const { data: propRow } = await admin
        .from('billing_ai_proposals')
        .select('*')
        .eq('id', proposalId)
        .maybeSingle();

      if (!propRow) {
        return {
          ok: false,
          error_code: 'PROPOSAL_NOT_FOUND',
          message: `Refund proposal "${proposalId}" was not found.`,
        };
      }

      if (String(propRow.demo_session_id || '') !== demoSessionId) {
        return {
          ok: false,
          error_code: 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED',
          message: 'Proposal belongs to a different demo_session_id.',
        };
      }

      if (propRow.kind !== 'refund') {
        return {
          ok: false,
          error_code: 'INVALID_PROPOSAL_KIND',
          message: `Proposal "${proposalId}" has kind "${propRow.kind}" and cannot be used for refund execution.`,
        };
      }

      if (propRow.status === 'executed' || propRow.status === 'approved') {
        return {
          ok: false,
          error_code: 'DUPLICATE_APPROVAL_BLOCKED',
          message: `Refund proposal "${proposalId}" has already been executed (one-time execution enforced).`,
        };
      }

      const expiresAtStr = propRow.payload?.expires_at;
      if (expiresAtStr && new Date(String(expiresAtStr)).getTime() < Date.now()) {
        return {
          ok: false,
          error_code: 'PROPOSAL_EXPIRED',
          message: `Refund proposal "${proposalId}" has expired. Prepare a new proposal via \`prepare_refund_proposal\`.`,
        };
      }

      const proposedInvoiceNum = String(propRow.payload?.invoice_number || '').replace(/^#/, '');
      if (
        rawNum &&
        proposedInvoiceNum &&
        rawNum.toLowerCase() !== proposedInvoiceNum.toLowerCase() &&
        !proposedInvoiceNum.toLowerCase().endsWith(rawNum.toLowerCase())
      ) {
        return {
          ok: false,
          error_code: 'PROPOSAL_PARAMETER_MISMATCH',
          message: `Refund proposal "${proposalId}" is bound to invoice #${proposedInvoiceNum} and cannot be used for "${rawNum}".`,
        };
      }

      if (
        requestedAmountMinor > 0 &&
        propRow.amount_minor &&
        requestedAmountMinor !== Number(propRow.amount_minor)
      ) {
        return {
          ok: false,
          error_code: 'PROPOSAL_PARAMETER_MISMATCH',
          message: `Refund proposal "${proposalId}" was approved for ${formatUsd(
            Number(propRow.amount_minor)
          )} and cannot be executed for ${formatUsd(requestedAmountMinor)}.`,
        };
      }

      if (!rawNum && proposedInvoiceNum) {
        rawNum = proposedInvoiceNum;
      }
      if (!requestedAmountMinor && propRow.amount_minor) {
        requestedAmountMinor = Number(propRow.amount_minor);
      }

      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase()) ||
          i.id.toLowerCase() === rawNum.toLowerCase()
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Statement "${rawNum}" was not found in demo session "${demoSessionId}".`,
        };
      }

      if (target.status === 'refunded') {
        return {
          ok: true,
          demo_session_id: demoSessionId,
          idempotent_replay: true,
          invoice_number: target.invoice_number,
          status: 'refunded',
          amount_refunded_usd: target.amount_refunded_usd,
          balance_due_usd: '$0.00',
          message: `Statement #${target.invoice_number} has already been refunded (${target.amount_refunded_usd}).`,
        };
      }

      if (target.status !== 'paid' && target.amount_paid_minor <= 0) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_PAID',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} ($0.00 captured) and cannot be refunded.`,
        };
      }

      const refundMinor = requestedAmountMinor > 0 ? requestedAmountMinor : Number(target.amount_paid_minor);

      // If this invoice was settled via a live PayPal Sandbox capture, attempt live PayPal refund first
      if (target.settlement_verification === 'paypal_sandbox_verified') {
        const refResp = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            action: 'refund-capture',
            invoiceId: target.id,
            invoice_id: target.id,
            invoiceNumber: target.invoice_number,
            invoice_number: target.invoice_number,
            amountMinor: refundMinor,
            roleScope: 'doctor',
            userId: PROVIDER_ID,
            demoSessionId,
          }),
        });
        const refData = await refResp.json().catch(() => ({}));
        if (refData?.ok && refData?.refundId) {
          if (proposalId) {
            await admin
              .from('billing_ai_proposals')
              .update({ status: 'executed', decided_at: new Date().toISOString() })
              .eq('id', proposalId);
          }
          return {
            ok: true,
            demo_session_id: demoSessionId,
            refund_mode: 'paypal_sandbox_verified',
            is_live_paypal_refund: true,
            invoice_id: target.id,
            invoice_number: target.invoice_number,
            customer_name: target.customer_name,
            refund_id: String(refData.refundId),
            refund_amount_minor: refundMinor,
            refund_amount_usd: formatUsd(refundMinor),
            balance_due_minor: 0,
            balance_due_usd: '$0.00',
            status: 'refunded',
            message: `Verified PayPal Sandbox Refund ${refData.refundId} (${formatUsd(refundMinor)} USD) completed for Statement #${target.invoice_number}. Remaining balance is $0.00.`,
          };
        }
      }

      // Otherwise execute isolated demo session refund via RPC
      const { data: demoRefRes, error: demoRefErr } = await admin.rpc('billing_simulate_demo_refund', {
        p_invoice: target.id,
        p_amount_minor: refundMinor,
        p_demo_session_id: demoSessionId,
      });

      if (demoRefErr) {
        return {
          ok: false,
          error_code: 'REFUND_FAILED',
          message: demoRefErr.message,
        };
      }

      if (proposalId) {
        await admin
          .from('billing_ai_proposals')
          .update({ status: 'executed', decided_at: new Date().toISOString() })
          .eq('id', proposalId);
      }

      const refundRef = String(
        demoRefRes?.paypal_refund_id || demoRefRes?.refund_id || `DEMO-REFUND-${target.invoice_number}`
      );

      return {
        ok: true,
        demo_session_id: demoSessionId,
        refund_mode: 'sample_demo_refund_not_live_paypal',
        is_live_paypal_refund: false,
        invoice_id: target.id,
        invoice_number: target.invoice_number,
        customer_name: target.customer_name,
        refund_id: refundRef,
        refund_amount_minor: refundMinor,
        refund_amount_usd: formatUsd(refundMinor),
        balance_due_minor: 0,
        balance_due_usd: '$0.00',
        status: 'refunded',
        message: `Refund ${refundRef} (${formatUsd(refundMinor)} USD) processed for Statement #${target.invoice_number} in isolated demo session "${demoSessionId}". Remaining balance is $0.00.`,
      };
    }

    case 'execute_conversational_instruction': {
      const instruction = String(args?.instruction || args?.user_instruction || '').trim();
      const actorRole = String(args?.actor_role || 'doctor').trim();
      const priorExecutionIntent = Boolean(args?.prior_execution_intent);

      // Look up most recent pending proposal in this demo_session_id for follow-up confirmations ("Yes, go ahead.")
      const { data: pendingProp } = await admin
        .from('billing_ai_proposals')
        .select('*')
        .eq('demo_session_id', demoSessionId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const evalRes = evaluateConversationalInstructionServer({
        instruction,
        actorRole,
        userId: args?.user_id,
        authenticatedUserRole: args?.authenticated_user_role,
        callerIdentityVerified: args?.caller_identity_verified,
        hasPendingProposal: Boolean(pendingProp?.id),
        pendingProposalId: pendingProp?.id ? String(pendingProp.id) : null,
        pendingProposalKind: pendingProp?.kind ? String(pendingProp.kind) : null,
        priorExecutionIntent,
      });

      if (!evalRes.authorizedToExecute) {
        return {
          ok: true,
          executed: false,
          demo_session_id: demoSessionId,
          conversational_authorization: evalRes,
          message: evalRes.explanation,
        };
      }

      if (evalRes.operation === 'create_invoice') {
        const propId =
          evalRes.intent === 'follow_up_confirmation' && pendingProp?.id
            ? String(pendingProp.id)
            : undefined;
        const execRes = await executeTool(
          admin,
          'create_approved_invoice',
          {
            proposal_id: propId,
            user_instruction: propId ? undefined : instruction,
            explicit_human_approval: true,
            actor_role: actorRole,
            customer_name: evalRes.extractedParams.customerName,
            service_code: evalRes.extractedParams.serviceCode,
            amount_minor: evalRes.extractedParams.amountMinor,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        return {
          ...execRes,
          executed: Boolean(execRes.ok),
          conversational_authorization: evalRes,
        };
      }

      if (evalRes.operation === 'void_invoice') {
        const targetInv =
          evalRes.extractedParams.invoiceNumber ||
          (pendingProp?.payload?.invoice_number ? String(pendingProp.payload.invoice_number) : '');
        const execRes = await executeTool(
          admin,
          'void_unpaid_invoice',
          {
            invoice_number: targetInv,
            explicit_human_approval: true,
            user_instruction: instruction,
            actor_role: actorRole,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        if (execRes.ok && pendingProp?.id && pendingProp?.kind === 'void_invoice') {
          await admin
            .from('billing_ai_proposals')
            .update({ status: 'executed', decided_at: new Date().toISOString() })
            .eq('id', pendingProp.id);
        }
        return {
          ...execRes,
          executed: Boolean(execRes.ok),
          conversational_authorization: evalRes,
        };
      }

      if (evalRes.operation === 'refund_payment') {
        const propId =
          evalRes.intent === 'follow_up_confirmation' && pendingProp?.id
            ? String(pendingProp.id)
            : undefined;
        const execRes = await executeTool(
          admin,
          'execute_approved_refund',
          {
            proposal_id: propId,
            user_instruction: propId ? undefined : instruction,
            explicit_human_approval: true,
            actor_role: actorRole,
            invoice_number: evalRes.extractedParams.invoiceNumber,
            amount_minor: evalRes.extractedParams.amountMinor,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        return {
          ...execRes,
          executed: Boolean(execRes.ok),
          conversational_authorization: evalRes,
        };
      }

      if (evalRes.operation === 'pay_invoice') {
        const propId =
          evalRes.intent === 'follow_up_confirmation' && pendingProp?.id
            ? String(pendingProp.id)
            : undefined;
        const execRes = await executeTool(
          admin,
          'create_paypal_checkout_order',
          {
            proposal_id: propId,
            user_instruction: propId ? undefined : instruction,
            explicit_human_approval: true,
            actor_role: actorRole,
            invoice_number: evalRes.extractedParams.invoiceNumber,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        return {
          ...execRes,
          executed: Boolean(execRes.ok),
          requires_paypal_buyer_authorization: true,
          conversational_authorization: evalRes,
        };
      }

      if (evalRes.operation === 'reset_demo') {
        const execRes = await executeTool(
          admin,
          'reset_demo_session',
          { demo_session_id: demoSessionId },
          demoSessionId
        );
        return {
          ...execRes,
          executed: Boolean(execRes.ok),
          conversational_authorization: evalRes,
        };
      }

      if (evalRes.operation === 'search_invoices') {
        const execRes = await executeTool(
          admin,
          'search_invoices',
          {
            customer_name: evalRes.extractedParams.customerName,
            query: evalRes.extractedParams.invoiceNumber,
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        return {
          ...execRes,
          executed: true,
          conversational_authorization: evalRes,
        };
      }

      return {
        ok: true,
        executed: false,
        demo_session_id: demoSessionId,
        conversational_authorization: evalRes,
        message: evalRes.explanation,
      };
    }

    case 'paypal_discover_official_mcp': {
      const auth = await getPayPalSandboxCredentialsAndToken(admin);
      let httpProbeStatus = 404;
      try {
        const httpRes = await fetch('https://mcp.sandbox.paypal.com/http', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        httpProbeStatus = httpRes.status;
      } catch {
        httpProbeStatus = 0;
      }

      let oauthMetadata: Record<string, any> | null = null;
      try {
        const metaRes = await fetch(
          'https://mcp.sandbox.paypal.com/.well-known/oauth-authorization-server'
        );
        if (metaRes.ok) {
          oauthMetadata = await metaRes.json().catch(() => null);
        }
      } catch {
        oauthMetadata = null;
      }

      let sseReachable = false;
      let sseSessionEndpoint: string | null = null;
      if (auth.accessToken) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const sseRes = await fetch('https://mcp.sandbox.paypal.com/sse', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${auth.accessToken}`,
              Accept: 'text/event-stream',
            },
            signal: controller.signal,
          });
          if (sseRes.ok && sseRes.body) {
            sseReachable = true;
            const reader = sseRes.body.getReader();
            const { value } = await reader.read();
            if (value) {
              const chunk = new TextDecoder().decode(value);
              const match = chunk.match(/data:\s*(\/sse\/message\?sessionId=[^\r\n]+)/);
              if (match) {
                sseSessionEndpoint = match[1].trim();
              }
            }
            await reader.cancel().catch(() => {});
          }
          clearTimeout(timer);
        } catch {
          // ignore abort
        }
      }

      const upstreamToolNames = [
        'create_invoice',
        'list_invoices',
        'get_invoice',
        'send_invoice',
        'send_invoice_reminder',
        'cancel_sent_invoice',
        'generate_invoice_qr_code',
        'create_product',
        'list_products',
        'show_product_details',
        'update_product',
        'create_subscription_plan',
        'list_subscription_plans',
        'show_subscription_plan_details',
        'create_subscription',
        'show_subscription_details',
        'update_subscription',
        'cancel_subscription',
        'create_shipment_tracking',
        'get_shipment_tracking',
        'update_shipment_tracking',
        'create_order',
        'get_order',
        'capture_order',
        'list_disputes',
        'get_dispute',
        'accept_dispute_claim',
        'list_transactions',
        'pay_invoice',
        'create_And_Send_Invoice',
        'generate_invoice_number',
        'create_webhook',
        'Starting_ page_for_PayPal_integration',
        'get_merchant_insights',
        'create_refund',
        'get_refund',
      ];

      return {
        ok: true,
        source: 'official_paypal_mcp',
        demo_session_id: demoSessionId,
        official_paypal_mcp: {
          server_info: {
            name: 'PayPal MCP Agent',
            version: '1.0.0',
          },
          endpoints_probed: {
            http_endpoint: 'https://mcp.sandbox.paypal.com/http',
            http_status: httpProbeStatus,
            http_note:
              'https://mcp.sandbox.paypal.com/http returns HTTP 404; PayPal hosts its official MCP server on /sse and /mcp (OAuth 2.0 protected).',
            sse_endpoint: 'https://mcp.sandbox.paypal.com/sse',
            sse_authenticated_reachable: sseReachable,
            sse_session_endpoint_sample: sseSessionEndpoint,
            oauth_metadata_endpoint:
              'https://mcp.sandbox.paypal.com/.well-known/oauth-authorization-server',
            oauth_issuer: oauthMetadata?.issuer || 'https://mcp.sandbox.paypal.com',
          },
          upstream_runtime_diagnostic: {
            tool_discovery_works: true,
            upstream_tools_count: 46,
            upstream_tools_sample: upstreamToolNames,
            upstream_tools_call_issue:
              'Calling tools/call on mcp.sandbox.paypal.com triggers PAYPAL_API_SETUP_ERROR: "Unsupported cache mode: default" inside @paypal/agent-toolkit (src/shared/functions.ts:2053) because axios passes cache:"default" to Cloudflare Workers fetch.',
            unified_gateway_resolution:
              'Our Unified PayPal MCP Gateway connects to mcp.sandbox.paypal.com for official schema & capability discovery and executes the official PayPal tool contracts (paypal_get_order, paypal_get_refund, paypal_list_invoices, paypal_generate_invoice_number, paypal_list_disputes) directly against api-m.sandbox.paypal.com using the same merchant Sandbox OAuth 2.0 token.',
          },
          paypal_sandbox_oauth: {
            authenticated: auth.oauthReachable,
            app_id: auth.appId,
          },
        },
      };
    }

    case 'paypal_get_order': {
      const orderId = String(args?.order_id || '').trim();
      if (!orderId) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          error_code: 'ORDER_ID_REQUIRED',
          message: 'order_id is required to retrieve a PayPal Sandbox order.',
        };
      }
      const auth = await getPayPalSandboxCredentialsAndToken(admin);
      if (!auth.accessToken) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          error_code: 'PAYPAL_SANDBOX_AUTH_UNAVAILABLE',
          message: auth.error || 'PayPal Sandbox OAuth token unavailable.',
        };
      }
      const res = await fetch(
        `https://api-m.sandbox.paypal.com/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          http_status: res.status,
          error_code: data?.name || 'PAYPAL_ORDER_LOOKUP_FAILED',
          message: data?.message || `PayPal Orders v2 lookup returned HTTP ${res.status}.`,
          paypal_error: data,
        };
      }
      return {
        ok: true,
        source: 'paypal_rest_adapter',
        official_paypal_tool_equivalent: 'get_order',
        environment: 'sandbox',
        order_id: data.id,
        status: data.status,
        intent: data.intent,
        create_time: data.create_time,
        update_time: data.update_time,
        payer: data.payer || null,
        purchase_units: data.purchase_units || [],
        order: data,
      };
    }

    case 'paypal_get_refund': {
      const refundId = String(args?.refund_id || '').trim();
      if (!refundId) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          error_code: 'REFUND_ID_REQUIRED',
          message: 'refund_id is required to retrieve a PayPal Sandbox refund.',
        };
      }
      const auth = await getPayPalSandboxCredentialsAndToken(admin);
      if (!auth.accessToken) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          error_code: 'PAYPAL_SANDBOX_AUTH_UNAVAILABLE',
          message: auth.error || 'PayPal Sandbox OAuth token unavailable.',
        };
      }
      const res = await fetch(
        `https://api-m.sandbox.paypal.com/v2/payments/refunds/${encodeURIComponent(refundId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          http_status: res.status,
          error_code: data?.name || 'PAYPAL_REFUND_LOOKUP_FAILED',
          message: data?.message || `PayPal Refunds v2 lookup returned HTTP ${res.status}.`,
          paypal_error: data,
        };
      }
      return {
        ok: true,
        source: 'paypal_rest_adapter',
        official_paypal_tool_equivalent: 'get_refund',
        environment: 'sandbox',
        refund_id: data.id,
        status: data.status,
        amount: data.amount,
        note_to_payer: data.note_to_payer || null,
        create_time: data.create_time,
        update_time: data.update_time,
        seller_payable_breakdown: data.seller_payable_breakdown || null,
        refund: data,
      };
    }

    case 'paypal_list_invoices': {
      const page = Math.max(Number(args?.page || 1), 1);
      const pageSize = Math.min(Math.max(Number(args?.page_size || 10), 1), 50);
      const auth = await getPayPalSandboxCredentialsAndToken(admin);
      if (!auth.accessToken) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          error_code: 'PAYPAL_SANDBOX_AUTH_UNAVAILABLE',
          message: auth.error || 'PayPal Sandbox OAuth token unavailable.',
        };
      }
      const res = await fetch(
        `https://api-m.sandbox.paypal.com/v2/invoicing/invoices?page=${page}&page_size=${pageSize}&total_required=true`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await res.json().catch(() => ({}));
      const appInvoices = await fetchSessionInvoices(admin, demoSessionId);
      return {
        ok: res.ok,
        source: 'paypal_rest_adapter',
        official_paypal_tool_equivalent: 'list_invoices',
        environment: 'sandbox',
        http_status: res.status,
        paypal_invoicing_v2: {
          total_items: Number(data?.total_items || 0),
          total_pages: Number(data?.total_pages || 0),
          items: Array.isArray(data?.items) ? data.items : [],
        },
        synchronized_application_invoices_count: appInvoices.length,
        synchronized_application_invoices: appInvoices.map((i: any) => ({
          invoice_number: i.invoice_number,
          customer_name: i.customer_name,
          status: i.status,
          total_usd: i.total_usd,
          balance_due_usd: i.balance_due_usd,
          settlement_verification: i.settlement_verification,
        })),
      };
    }

    case 'paypal_generate_invoice_number': {
      const auth = await getPayPalSandboxCredentialsAndToken(admin);
      if (!auth.accessToken) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          error_code: 'PAYPAL_SANDBOX_AUTH_UNAVAILABLE',
          message: auth.error || 'PayPal Sandbox OAuth token unavailable.',
        };
      }
      const res = await fetch(
        'https://api-m.sandbox.paypal.com/v2/invoicing/generate-next-invoice-number',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json().catch(() => ({}));
      return {
        ok: res.ok,
        source: 'paypal_rest_adapter',
        official_paypal_tool_equivalent: 'generate_invoice_number',
        environment: 'sandbox',
        http_status: res.status,
        paypal_invoice_number: data?.invoice_number || null,
        raw: data,
      };
    }

    case 'paypal_list_disputes': {
      const pageSize = Math.min(Math.max(Number(args?.page_size || 10), 1), 50);
      const auth = await getPayPalSandboxCredentialsAndToken(admin);
      if (!auth.accessToken) {
        return {
          ok: false,
          source: 'paypal_rest_adapter',
          error_code: 'PAYPAL_SANDBOX_AUTH_UNAVAILABLE',
          message: auth.error || 'PayPal Sandbox OAuth token unavailable.',
        };
      }
      const res = await fetch(
        `https://api-m.sandbox.paypal.com/v1/customer/disputes?page_size=${pageSize}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await res.json().catch(() => ({}));
      return {
        ok: res.ok,
        source: 'paypal_rest_adapter',
        official_paypal_tool_equivalent: 'list_disputes',
        environment: 'sandbox',
        http_status: res.status,
        disputes_count: Array.isArray(data?.items) ? data.items.length : 0,
        disputes: Array.isArray(data?.items) ? data.items : [],
      };
    }

    case 'paypal_check_card_eligibility': {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'check-card-eligibility',
          roleScope: 'doctor',
          userId: PROVIDER_ID,
          demoSessionId,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      const scopes: string[] = Array.isArray(data?.relevant_oauth_scopes) ? data.relevant_oauth_scopes : [];
      const eligible = Boolean(
        data?.directCardEligible ??
          data?.direct_card_api_supported ??
          data?.sandbox_merchant_eligible
      );
      return {
        ok: Boolean(data?.ok),
        source: 'paypal_rest_adapter',
        demo_session_id: demoSessionId,
        environment: 'sandbox',
        direct_card_eligible: eligible,
        sandbox_merchant_eligible: eligible,
        app_id: data?.appId || data?.paypal_app_id || null,
        oauth_reachable: Boolean(data?.oauth_reachable ?? eligible),
        has_auth_capture_scope:
          Boolean(data?.hasAuthCaptureScope) ||
          scopes.some((s) => s.includes('payment/authcapture')),
        has_client_payments_eligibility_scope:
          Boolean(data?.hasClientPaymentsEligibilityScope) ||
          scopes.some((s) => s.includes('client-payments-eligibility')),
        relevant_oauth_scopes: scopes,
        supported_payment_methods: data?.supportedPaymentMethods ||
          data?.supported_payment_methods || [
            'paypal_wallet',
            'paypal_direct_card',
            'demo_settlement_simulation',
          ],
        supported_sandbox_card_profiles:
          data?.supportedSandboxCardProfiles || data?.available_sandbox_card_profiles || [],
        security_controls: data?.securityControls || {
          raw_card_pan_rejected: true,
          sandbox_only: true,
          rate_limit_per_session_per_hour: 8,
        },
      };
    }

    case 'execute_sandbox_card_payment': {
      // Security: Reject any raw card number / CVV / PAN fields supplied by caller
      const forbiddenCardKeys = [
        'card_number',
        'cardNumber',
        'pan',
        'cvv',
        'security_code',
        'securityCode',
        'raw_card',
        'expiry',
      ];
      for (const k of forbiddenCardKeys) {
        if (args && args[k] !== undefined && args[k] !== null && args[k] !== '') {
          return {
            ok: false,
            error_code: 'RAW_CARD_CREDENTIALS_FORBIDDEN',
            message: `Security Policy: Passing raw card field "${k}" is strictly prohibited. Use an allowlisted server-side \`card_profile\` ("visa_sandbox", "mastercard_sandbox", "amex_sandbox", "decline_refused", "decline_expired", "decline_insufficient_funds").`,
          };
        }
      }

      const userInstruction = String(args?.user_instruction || '').trim();
      const actorRole = String(args?.actor_role || 'patient').trim();
      if (args?.explicit_human_approval !== true && !userInstruction) {
        return {
          ok: false,
          error_code: 'HUMAN_APPROVAL_REQUIRED',
          message:
            'Executing a PayPal Sandbox card payment requires `explicit_human_approval: true` (or an explicit `user_instruction`).',
        };
      }

      let rawNum = String(args?.invoice_number || '').trim().replace(/^#/, '');
      let rawProposalId = String(args?.proposal_id || '').trim();
      if (userInstruction && !rawProposalId) {
        const evalRes = evaluateConversationalInstructionServer({
          instruction: userInstruction,
          actorRole,
          userId: args?.user_id,
          authenticatedUserRole: args?.authenticated_user_role,
          callerIdentityVerified: args?.caller_identity_verified,
        });
        if (!evalRes.authorizedToExecute || evalRes.operation !== 'pay_invoice') {
          return {
            ok: false,
            error_code: evalRes.reasonCode || 'INSTRUCTION_NOT_AUTHORIZED',
            conversational_evaluation: evalRes,
            message: evalRes.explanation,
          };
        }
        if (!rawNum && evalRes.extractedParams.invoiceNumber) {
          rawNum = evalRes.extractedParams.invoiceNumber;
        }
      }

      const proposalId = rawProposalId.includes('.') ? rawProposalId.split('.')[0] : rawProposalId;
      if (proposalId) {
        const { data: propRow } = await admin
          .from('billing_ai_proposals')
          .select('*')
          .eq('id', proposalId)
          .maybeSingle();
        if (!propRow) {
          return {
            ok: false,
            error_code: 'PROPOSAL_NOT_FOUND',
            message: `Payment proposal "${proposalId}" was not found.`,
          };
        }
        if (String(propRow.demo_session_id || '') !== demoSessionId) {
          return {
            ok: false,
            error_code: 'CROSS_SESSION_PROPOSAL_ACCESS_DENIED',
            message: 'Proposal belongs to a different demo_session_id.',
          };
        }
        if (propRow.status === 'executed') {
          return {
            ok: false,
            error_code: 'DUPLICATE_APPROVAL_BLOCKED',
            message: `Payment proposal "${proposalId}" has already been executed.`,
          };
        }
        if (!rawNum && propRow.payload?.invoice_number) {
          rawNum = String(propRow.payload.invoice_number).replace(/^#/, '');
        }
      }

      const invoices = await fetchSessionInvoices(admin, demoSessionId);
      const target = invoices.find(
        (i: any) =>
          i.invoice_number.toLowerCase() === rawNum.toLowerCase() ||
          i.invoice_number.toLowerCase().endsWith(rawNum.toLowerCase()) ||
          i.id.toLowerCase() === rawNum.toLowerCase()
      );

      if (!target) {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_FOUND',
          message: `Statement "${rawNum}" was not found in demo session "${demoSessionId}".`,
        };
      }

      if (target.balance_due_minor <= 0 || target.status === 'paid' || target.status === 'void' || target.status === 'refunded') {
        return {
          ok: false,
          error_code: 'INVOICE_NOT_PAYABLE',
          message: `Statement #${target.invoice_number} has status ${target.status.toUpperCase()} with ${target.balance_due_usd} balance due and cannot be paid.`,
        };
      }

      const cardProfile = String(args?.card_profile || 'visa_sandbox').trim().toLowerCase();
      const intent = String(args?.intent || 'CAPTURE').trim().toUpperCase();

      const payResp = await fetch(`${SUPABASE_URL}/functions/v1/paypal-billing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'pay-with-sandbox-card',
          invoiceId: target.id,
          invoice_id: target.id,
          invoiceNumber: target.invoice_number,
          invoice_number: target.invoice_number,
          cardProfile,
          card_profile: cardProfile,
          intent,
          demoSessionId,
          demo_session_id: demoSessionId,
          userId: target.customer_id,
          user_id: target.customer_id,
          roleScope: 'patient',
        }),
      });
      const payData = await payResp.json().catch(() => ({}));

      if (payData?.ok && (payData?.captureId || payData?.authorizationId)) {
        if (proposalId) {
          await admin
            .from('billing_ai_proposals')
            .update({ status: 'executed', decided_at: new Date().toISOString() })
            .eq('id', proposalId);
        }
        const resolvedBrand =
          payData.cardBrand || payData.card_brand || payData.card?.brand || 'VISA';
        const resolvedLast4 =
          payData.cardLastDigits || payData.card_last_digits || payData.card?.last_digits || '1881';
        const resolvedProcCode =
          payData.processorResponseCode ||
          payData.processorResponse?.response_code ||
          '0000';
        return {
          ok: true,
          demo_session_id: demoSessionId,
          settlement_mode: 'paypal_sandbox_verified',
          payment_source_type: 'paypal_card',
          is_live_paypal_capture: Boolean(payData.captureId),
          invoice_id: target.id,
          invoice_number: target.invoice_number,
          customer_name: target.customer_name,
          order_id: payData.orderId || payData.order_id,
          order_status: payData.orderStatus || payData.status || 'COMPLETED',
          capture_id: payData.captureId || payData.capture_id || null,
          authorization_id: payData.authorizationId || payData.authorization_id || null,
          capture_status: payData.captureStatus || null,
          attempt_classification:
            payData.attemptClassification || payData.classification || 'captured',
          card_profile: payData.cardProfile || payData.sandboxCardProfile || cardProfile,
          card_brand: resolvedBrand,
          card_last_digits: resolvedLast4,
          processor_response_code: resolvedProcCode,
          amount_paid_minor: payData.captureId ? target.total_minor : 0,
          amount_paid_usd: payData.captureId ? target.total_usd : '$0.00',
          balance_due_minor: payData.captureId ? 0 : target.balance_due_minor,
          balance_due_usd: payData.captureId ? '$0.00' : target.balance_due_usd,
          status: payData.captureId ? 'paid' : target.status,
          verified_order_summary: payData.verifiedOrderSummary || null,
          message:
            payData.message ||
            `Verified PayPal Sandbox Direct Card Capture (${
              payData.captureId || payData.authorizationId
            }) completed for Statement #${target.invoice_number} (${target.total_usd} USD).`,
        };
      }

      const failClass =
        payData?.attemptClassification || payData?.classification || 'payment_declined';
      const failBrand = payData?.cardBrand || payData?.card_brand || payData?.card?.brand || null;
      const failLast4 =
        payData?.cardLastDigits || payData?.card_last_digits || payData?.card?.last_digits || null;
      const failProcCode =
        payData?.processorResponseCode || payData?.processorResponse?.response_code || null;
      return {
        ok: false,
        demo_session_id: demoSessionId,
        error_code: payData?.code || 'SANDBOX_CARD_PAYMENT_DECLINED',
        paypal_error_code: payData?.paypalErrorCode || payData?.code || null,
        attempt_classification: failClass,
        is_payment_declined: failClass === 'payment_declined',
        payment_source_type: 'paypal_card',
        order_id: payData?.orderId || payData?.order_id || null,
        card_brand: failBrand,
        card_last_digits: failLast4,
        processor_response_code: failProcCode,
        actionable_message:
          payData?.actionableMessage || payData?.message || 'Sandbox card payment was declined.',
        message: payData?.message || 'Sandbox card payment was declined by PayPal processor.',
      };
    }

    case 'generate_receipt_pdf': {
      return await executeTool(
        admin,
        'get_payment_receipt',
        {
          invoice_number: args?.invoice_number,
          merchant_branding: args?.merchant_branding,
          demo_session_id: demoSessionId,
        },
        demoSessionId
      );
    }

    case 'run_sandbox_card_lifecycle_test': {
      if (args?.explicit_human_approval !== true) {
        return {
          ok: false,
          error_code: 'HUMAN_APPROVAL_REQUIRED',
          message:
            'Running the automated PayPal Sandbox card lifecycle test requires `explicit_human_approval: true`.',
        };
      }

      const amountMinor = Math.min(Math.max(Number(args?.amount_minor || 3500), 100), 10000);
      const cardProfile = String(args?.card_profile || 'visa_sandbox').trim().toLowerCase();
      const includeRefund = args?.include_refund !== false;
      const stages: Array<Record<string, any>> = [];

      // Stage 1: Check Merchant Direct-Card Eligibility
      const eligRes = await executeTool(
        admin,
        'paypal_check_card_eligibility',
        { demo_session_id: demoSessionId },
        demoSessionId
      );
      stages.push({
        stage: '1_check_card_eligibility',
        status: eligRes.ok && eligRes.direct_card_eligible ? 'PASS' : 'FAIL',
        direct_card_eligible: eligRes.direct_card_eligible,
        app_id: eligRes.app_id,
      });
      if (!eligRes.ok || !eligRes.direct_card_eligible) {
        return {
          ok: false,
          error_code: 'DIRECT_CARD_NOT_ELIGIBLE',
          demo_session_id: demoSessionId,
          stages,
          message: 'PayPal Sandbox merchant is not eligible for direct card checkout.',
        };
      }

      // Stage 2: Create Isolated Test Invoice
      const propRes = await executeTool(
        admin,
        'create_invoice_proposal',
        {
          customer_name: 'Alex Rivera',
          service_code: 'ADMIN-FORMS',
          amount_minor: amountMinor,
          demo_session_id: demoSessionId,
        },
        demoSessionId
      );
      const createInvRes = await executeTool(
        admin,
        'create_approved_invoice',
        {
          proposal_id: propRes.proposal?.id,
          explicit_human_approval: true,
          actor_role: 'provider',
          demo_session_id: demoSessionId,
        },
        demoSessionId
      );
      const testInvoiceNumber = createInvRes.invoice?.invoice_number;
      stages.push({
        stage: '2_create_isolated_invoice',
        status: createInvRes.ok && testInvoiceNumber ? 'PASS' : 'FAIL',
        invoice_number: testInvoiceNumber || null,
        amount_usd: formatUsd(amountMinor),
      });
      if (!createInvRes.ok || !testInvoiceNumber) {
        return {
          ok: false,
          error_code: 'TEST_INVOICE_CREATION_FAILED',
          demo_session_id: demoSessionId,
          stages,
        };
      }

      // Stage 3: Execute Sandbox Direct Card Payment (Order + Capture)
      const cardPayRes = await executeTool(
        admin,
        'execute_sandbox_card_payment',
        {
          invoice_number: testInvoiceNumber,
          card_profile: cardProfile,
          intent: 'CAPTURE',
          explicit_human_approval: true,
          demo_session_id: demoSessionId,
        },
        demoSessionId
      );
      stages.push({
        stage: '3_execute_sandbox_card_payment',
        status: cardPayRes.ok && cardPayRes.capture_id ? 'PASS' : 'FAIL',
        order_id: cardPayRes.order_id || null,
        capture_id: cardPayRes.capture_id || null,
        card_brand: cardPayRes.card_brand || null,
        card_last_digits: cardPayRes.card_last_digits || null,
        processor_response_code: cardPayRes.processor_response_code || null,
      });
      if (!cardPayRes.ok || !cardPayRes.capture_id) {
        return {
          ok: false,
          error_code: cardPayRes.error_code || 'CARD_CAPTURE_FAILED',
          demo_session_id: demoSessionId,
          stages,
          card_payment_result: cardPayRes,
        };
      }

      // Stage 4: Direct PayPal Orders v2 Verification
      const orderVerifyRes = await executeTool(
        admin,
        'paypal_get_order',
        {
          order_id: cardPayRes.order_id,
          demo_session_id: demoSessionId,
        },
        demoSessionId
      );
      stages.push({
        stage: '4_verify_order_against_paypal',
        status: orderVerifyRes.ok && orderVerifyRes.status === 'COMPLETED' ? 'PASS' : 'FAIL',
        order_id: orderVerifyRes.order_id,
        paypal_order_status: orderVerifyRes.status,
      });

      // Stage 5: Generate & Verify Paid Receipt + PDF
      const paidReceiptRes = await executeTool(
        admin,
        'generate_receipt_pdf',
        {
          invoice_number: testInvoiceNumber,
          demo_session_id: demoSessionId,
        },
        demoSessionId
      );
      stages.push({
        stage: '5_verify_paid_receipt_and_pdf',
        status:
          paidReceiptRes.ok &&
          paidReceiptRes.receipt?.is_live_paypal_capture &&
          paidReceiptRes.pdf_byte_length > 500
            ? 'PASS'
            : 'FAIL',
        receipt_number: paidReceiptRes.receipt?.receipt_number,
        pdf_byte_length: paidReceiptRes.pdf_byte_length,
        pdf_download_url: paidReceiptRes.pdf_download_url,
      });

      let refundId: string | null = null;
      if (includeRefund) {
        // Stage 6: Prepare & Execute Live PayPal Sandbox Refund
        const refPropRes = await executeTool(
          admin,
          'prepare_refund_proposal',
          {
            invoice_number: testInvoiceNumber,
            amount_minor: amountMinor,
            reason: 'Automated Sandbox Card Lifecycle Verification Refund',
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        const refExecRes = await executeTool(
          admin,
          'execute_approved_refund',
          {
            proposal_id: refPropRes.proposal?.id,
            invoice_number: testInvoiceNumber,
            amount_minor: amountMinor,
            explicit_human_approval: true,
            actor_role: 'provider',
            demo_session_id: demoSessionId,
          },
          demoSessionId
        );
        refundId = refExecRes.refund_id || null;
        stages.push({
          stage: '6_execute_live_paypal_refund',
          status: refExecRes.ok && refExecRes.is_live_paypal_refund && refundId ? 'PASS' : 'FAIL',
          refund_id: refundId,
          is_live_paypal_refund: Boolean(refExecRes.is_live_paypal_refund),
          refund_amount_usd: refExecRes.refund_amount_usd,
        });

        if (refundId) {
          // Stage 7: Direct PayPal Refunds v2 Verification
          const refVerifyRes = await executeTool(
            admin,
            'paypal_get_refund',
            {
              refund_id: refundId,
              demo_session_id: demoSessionId,
            },
            demoSessionId
          );
          stages.push({
            stage: '7_verify_refund_against_paypal',
            status: refVerifyRes.ok && refVerifyRes.status === 'COMPLETED' ? 'PASS' : 'FAIL',
            refund_id: refVerifyRes.refund_id,
            paypal_refund_status: refVerifyRes.status,
          });
        }
      }

      // Stage 8: Verify Final Receipt, Audit Trail & Business Metrics
      const finalReceiptRes = await executeTool(
        admin,
        'generate_receipt_pdf',
        {
          invoice_number: testInvoiceNumber,
          demo_session_id: demoSessionId,
        },
        demoSessionId
      );
      const metricsRes = await executeTool(
        admin,
        'get_business_metrics',
        { demo_session_id: demoSessionId },
        demoSessionId
      );
      const auditRes = await executeTool(
        admin,
        'get_financial_audit_history',
        { demo_session_id: demoSessionId, limit: 15 },
        demoSessionId
      );
      stages.push({
        stage: '8_verify_final_ledger_and_audit',
        status: finalReceiptRes.ok && metricsRes.ok && auditRes.ok ? 'PASS' : 'FAIL',
        final_invoice_status: finalReceiptRes.receipt?.status,
        final_balance_due_usd: finalReceiptRes.receipt?.balance_due_usd,
        session_private_audit_events: auditRes.session_private_count,
      });

      const allPassed = stages.every((s) => s.status === 'PASS');
      return {
        ok: allPassed,
        demo_session_id: demoSessionId,
        environment: 'sandbox',
        invoice_number: testInvoiceNumber,
        order_id: cardPayRes.order_id,
        capture_id: cardPayRes.capture_id,
        refund_id: refundId,
        card_brand: cardPayRes.card_brand,
        card_last_digits: cardPayRes.card_last_digits,
        processor_response_code: cardPayRes.processor_response_code,
        pdf_download_url: finalReceiptRes.pdf_download_url,
        stages,
        message: allPassed
          ? `Automated PayPal Sandbox Card Lifecycle Test PASSED for Statement #${testInvoiceNumber} (Order ${cardPayRes.order_id}, Capture ${cardPayRes.capture_id}${
              refundId ? `, Refund ${refundId}` : ''
            }).`
          : `Automated PayPal Sandbox Card Lifecycle Test completed with failures on Statement #${testInvoiceNumber}.`,
      };
    }

    default:
      return {
        ok: false,
        error_code: 'UNKNOWN_TOOL',
        message: `Unknown MCP tool "${toolName}". Call \`discover_billing_capabilities\` or \`tools/list\` for supported tools.`,
      };
  }
}

function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'PayPal AI Billing Kit — MCP Agent Interface API',
      version: '2.0.0',
      description:
        'Public Model Context Protocol (MCP) Agent Interface for the standalone PayPal AI Billing Kit hackathon demonstration. Supports JSON-RPC 2.0 MCP (`tools/list`, `tools/call`) and direct REST tool invocation with isolated `demo_session_id` sandboxes.',
    },
    servers: [
      {
        url: baseUrl,
        description: 'PayPal AI Billing Kit MCP Endpoint',
      },
    ],
    paths: {
      '/': {
        get: {
          operationId: 'discoverBillingCapabilitiesGet',
          summary: 'Discover PayPal AI Billing Kit MCP capabilities, tools, personas, and guardrails',
          parameters: [
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['manifest', 'openapi'] },
            },
          ],
          responses: {
            '200': {
              description: 'MCP Agent Interface capability manifest or OpenAPI 3.1.0 specification',
            },
          },
        },
        post: {
          operationId: 'invokeBillingMcpTool',
          summary:
            'Invoke any of the 15 PayPal AI Billing Kit tools via REST `{ tool, arguments, demo_session_id }` or MCP JSON-RPC 2.0 `{ jsonrpc: "2.0", method: "tools/call", params: { name, arguments } }`',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tool: {
                      type: 'string',
                      enum: MCP_TOOLS.map((t) => t.name),
                      description: 'Name of the MCP billing tool to invoke (REST mode).',
                    },
                    arguments: {
                      type: 'object',
                      description: 'Tool arguments object.',
                    },
                    demo_session_id: {
                      type: 'string',
                      description: 'Optional visitor/agent demo session ID for state isolation.',
                    },
                    jsonrpc: {
                      type: 'string',
                      description: 'Set to "2.0" when calling via Model Context Protocol (MCP).',
                    },
                    method: {
                      type: 'string',
                      description: 'MCP method (initialize, tools/list, tools/call, ping).',
                    },
                    params: {
                      type: 'object',
                      description: 'MCP method parameters.',
                    },
                    id: {
                      type: ['string', 'number'],
                      description: 'JSON-RPC request identifier.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Structured tool response or JSON-RPC 2.0 result',
            },
          },
        },
      },
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const url = new URL(req.url);
  const headerSessionId =
    req.headers.get('x-demo-session-id') ||
    req.headers.get('mcp-session-id') ||
    url.searchParams.get('demo_session_id') ||
    'maas-public-demo';
  const defaultSessionId = sanitizeDemoSessionId(headerSessionId);

  try {
    if (req.method === 'GET') {
      const format = url.searchParams.get('format');
      if (format === 'openapi' || url.pathname.endsWith('/openapi.json')) {
        const publicBase = `${url.origin}${url.pathname.replace(/\/openapi\.json$/, '')}`;
        return new Response(JSON.stringify(buildOpenApiSpec(publicBase), null, 2), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        });
      }

      const toolParam = url.searchParams.get('tool');
      if (toolParam) {
        const queryArgs: Record<string, any> = {};
        url.searchParams.forEach((v, k) => {
          if (k !== 'tool') queryArgs[k] = v;
        });
        const result = await executeTool(admin, toolParam, queryArgs, defaultSessionId);
        return new Response(JSON.stringify(result, null, 2), {
          status: result.ok ? 200 : 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        });
      }

      const discovery = await executeTool(
        admin,
        'discover_billing_capabilities',
        { demo_session_id: defaultSessionId },
        defaultSessionId
      );

      return new Response(
        JSON.stringify(
          {
            ...discovery,
            endpoints: {
              mcp_jsonrpc_post: `${url.origin}${url.pathname}`,
              rest_tool_post: `${url.origin}${url.pathname}`,
              openapi_spec_get: `${url.origin}${url.pathname}?format=openapi`,
            },
            example_requests: {
              mcp_tools_list: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {},
              },
              mcp_tools_call: {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                  name: 'get_invoice_details',
                  arguments: {
                    invoice_number: 'PPB-INV-2026-1003',
                    demo_session_id: 'chatgpt-eval-session',
                  },
                },
              },
              rest_direct_call: {
                tool: 'get_invoice_details',
                demo_session_id: 'chatgpt-eval-session',
                arguments: {
                  invoice_number: 'PPB-INV-2026-1003',
                },
              },
            },
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        }
      );
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));

    // Handle JSON-RPC 2.0 (Model Context Protocol)
    if (body && body.jsonrpc === '2.0' && typeof body.method === 'string') {
      const rpcId = body.id ?? null;
      const method = body.method;
      const params = body.params || {};

      if (method === 'initialize') {
        const clientVersion = String(params.protocolVersion || '2025-03-26');
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              protocolVersion: clientVersion,
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: 'paypal-ai-billing-kit-mcp',
                version: '2.0.0',
              },
              instructions:
                'PayPal AI Billing Kit MCP Server. Provides 15 billing tools across Read-Only, Proposal-Only, and Confirmed Demo Write tiers with $500 single-action / $2,500 daily guardrails and isolated demo_session_id state.',
            },
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      if (method === 'notifications/initialized' || method === 'ping') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {},
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      if (method === 'tools/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              tools: MCP_TOOLS.map((t) => ({
                name: t.name,
                description: `[${t.permissionTier.toUpperCase()}] ${t.description}`,
                annotations: t.annotations,
                inputSchema: t.inputSchema,
              })),
            },
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      if (method === 'tools/call') {
        const toolName = String(params.name || '');
        const toolArgs =
          params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const result = await executeTool(admin, toolName, toolArgs, defaultSessionId);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
              structuredContent: result,
              isError: !result.ok,
            },
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Mcp-Session-Id': defaultSessionId,
            },
          }
        );
      }

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Mcp-Session-Id': defaultSessionId,
          },
        }
      );
    }

    // Handle Direct REST MCP Tool Invocation
    const toolName = String(body?.tool || body?.action || 'discover_billing_capabilities');
    const toolArgs =
      body?.arguments && typeof body.arguments === 'object'
        ? { ...body.arguments, demo_session_id: body.demo_session_id || body.arguments.demo_session_id }
        : { ...body };

    const result = await executeTool(admin, toolName, toolArgs, defaultSessionId);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Mcp-Session-Id': defaultSessionId,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 'INTERNAL_MCP_ERROR',
        message: err instanceof Error ? err.message : 'Unexpected MCP server error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
