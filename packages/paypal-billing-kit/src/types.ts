export type PayPalEnvironment = 'sandbox' | 'live';

export interface PayPalAgentKitConfig {
  environment: PayPalEnvironment;
  clientId?: string | null;
  clientSecret?: string | null;
  webhookId?: string | null;
  returnUrl?: string | null;
  cancelUrl?: string | null;
  fetchImpl?: typeof fetch;
}

export interface PayPalCredentialsStatus {
  configured: boolean;
  environment: PayPalEnvironment;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasWebhookId: boolean;
  baseUrl: string;
  authUrl: string;
}

export interface PayPalOAuthToken {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  expiresAtMs: number;
  scope: string;
}

export interface PayPalSanitizedLineItem {
  serviceCode: string;
  description: string;
  quantity: number;
  unitAmountMinor: number;
}

export interface PayPalCreateOrderRequest {
  invoiceId: string;
  invoiceNumber: string;
  organizationName: string;
  currency: 'USD';
  amountMinor: number;
  items?: PayPalSanitizedLineItem[];
  returnUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface PayPalOrderSummary {
  orderId: string;
  status: string;
  approvalUrl: string | null;
  amountMinor: number;
  currency: 'USD';
  rawStatus: string;
}

export interface PayPalVerifiedCapture {
  orderId: string;
  captureId: string;
  status: string;
  amountMinor: number;
  currency: 'USD';
  payerEmailMasked: string | null;
  payerAccountId: string | null;
  createTime: string | null;
}

export interface PayPalRefundResult {
  refundId: string;
  captureId: string;
  status: string;
  amountMinor: number;
  currency: 'USD';
}

export interface PayPalWebhookHeaders {
  authAlgo: string | null;
  certUrl: string | null;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
}

export interface PayPalNormalizedFinancialEvent {
  eventId: string;
  eventType: string;
  kind:
    | 'capture_completed'
    | 'capture_denied'
    | 'capture_refunded'
    | 'order_approved'
    | 'invoice_paid'
    | 'invoice_cancelled'
    | 'unknown';
  orderId: string | null;
  captureId: string | null;
  refundId: string | null;
  invoiceId: string | null;
  amountMinor: number | null;
  currency: string;
  occurredAt: string;
}

export interface GuardrailPolicy {
  maxSingleActionMinor: number;
  dailyLimitMinor: number;
  usedTodayMinor: number;
  requireHumanApproval: boolean;
  blockClinicalData: boolean;
  paypalConfirmationRequired: boolean;
}

export interface GuardrailEvaluation {
  passed: boolean;
  singleOk: boolean;
  dailyOk: boolean;
  humanApprovalRequired: true;
  clinicalDataBlocked: true;
  paypalConfirmationRequired: true;
  singleLimitMinor: number;
  dailyLimitMinor: number;
  usedTodayMinor: number;
  requestedAmountMinor: number;
  violationReasons: string[];
}
