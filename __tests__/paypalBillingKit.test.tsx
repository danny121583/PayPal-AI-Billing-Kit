jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import {
  inspectForClinicalData,
  sanitizeAdministrativeDescription,
  evaluateAiFinancialGuardrail,
  extractPayPalWebhookHeaders,
  normalizePayPalWebhookEvent,
} from '../packages/paypal-billing-kit/src';
import BillingAISettingsModal, {
  formatAuditEventLabel,
} from '../components/billing/BillingAISettingsModal';
import BillingCreateInvoiceModal from '../components/billing/BillingCreateInvoiceModal';
import BillingInvoiceCard from '../components/billing/BillingInvoiceCard';
import BillingInvoiceDetailModal from '../components/billing/BillingInvoiceDetailModal';
import PayPalConnectCard from '../components/billing/PayPalConnectCard';
import DoctorBillingView from '../components/billing/DoctorBillingView';
import PatientBillingView from '../components/billing/PatientBillingView';
import {
  DEFAULT_SERVICE_CATALOG,
  getDefaultBillingAISettings,
  type BillingAuditEventItem,
} from '../src/billing/api/billingService';
import { getSyntheticInvoicesForRole } from '../src/billing/data/syntheticBillingFixtures';
import {
  clearBillingAIClientCacheForTests,
  sendBillingAIMessage,
} from '../src/billing/api/billingAIClient';

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  Stack: Object.assign(({ children }: any) => children, {
    Screen: () => null,
  }),
}));

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: '11111111-1111-4111-8111-111111111101' } },
      }),
      signInWithPassword: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: '11111111-1111-4111-8111-111111111101',
            email: 'sarah.jenkins@demo.paypal-billing-kit.local',
          },
        },
        error: null,
      }),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({
      data: {
        id: 'inv-new-35',
        invoice_number: 'PPB-INV-2026-2001',
        status: 'sent',
      },
      error: null,
    }),
    functions: {
      invoke: jest.fn().mockResolvedValue({
        data: { ok: true },
        error: null,
      }),
    },
  },
}));

describe('Standalone PayPal AI Billing Kit — SDK & Guardrails', () => {
  it('blocks sensitive or clinical fields from ever entering PayPal payloads', () => {
    const cleanPayload = {
      invoice_id: '44444444-4444-4444-8444-444444444401',
      invoice_number: 'PPB-INV-2026-1001',
      service_code: 'ADMIN-FORMS',
      amount_minor: 3500,
      currency: 'USD',
    };
    expect(inspectForClinicalData(cleanPayload).allowed).toBe(true);

    const contaminatedPayload = {
      ...cleanPayload,
      diagnosis_notes: 'Confidential patient history',
      medication_plan: 'Confidential treatment',
    };
    const check = inspectForClinicalData(contaminatedPayload);
    expect(check.allowed).toBe(false);
    expect(check.violations.join(' ')).toContain('diagnosis_notes');
    expect(check.violations.join(' ')).toContain('medication_plan');
  });

  it('sanitizes administrative service descriptions and enforces ADMIN-* service code allowlist', () => {
    const sanitized = sanitizeAdministrativeDescription(
      'ADMIN-FORMS',
      '  Administrative Forms Completion  '
    );
    expect(sanitized.serviceCode).toBe('ADMIN-FORMS');
    expect(sanitized.description).toBe('Administrative Forms Completion');

    expect(() =>
      sanitizeAdministrativeDescription('ICD10-CODE', 'Clinical visit')
    ).toThrow(/not in the administrative allowlist/);
  });

  it('enforces single-action ($500) and daily ($2,500) AI monetary velocity guardrails', () => {
    const policy = {
      maxSingleActionMinor: 50000,
      dailyLimitMinor: 250000,
      usedTodayMinor: 10000,
    };

    const allowed35 = evaluateAiFinancialGuardrail({
      amountMinor: 3500,
      policy,
    });
    expect(allowed35.passed).toBe(true);
    expect(allowed35.humanApprovalRequired).toBe(true);
    expect(allowed35.clinicalDataBlocked).toBe(true);

    const rejected600 = evaluateAiFinancialGuardrail({
      amountMinor: 60000,
      policy,
    });
    expect(rejected600.passed).toBe(false);
    expect(rejected600.singleOk).toBe(false);
  });

  it('extracts PayPal webhook verification headers and normalizes settlement events', () => {
    const headers = new Headers({
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
      'paypal-transmission-id': 'tx-123',
      'paypal-transmission-sig': 'sig-abc',
      'paypal-transmission-time': '2026-11-01T12:00:00Z',
    });

    const extracted = extractPayPalWebhookHeaders(headers);
    expect(extracted.transmissionId).toBe('tx-123');
    expect(
      normalizePayPalWebhookEvent({
        id: 'WH-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'CAP-123', amount: { value: '35.00', currency_code: 'USD' } },
      }).kind
    ).toBe('capture_completed');
    expect(
      normalizePayPalWebhookEvent({
        id: 'WH-2',
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: { id: 'REF-123', amount: { value: '35.00', currency_code: 'USD' } },
      }).kind
    ).toBe('capture_refunded');
  });
});

describe('Standalone PayPal AI Billing Kit — Section 4 UI Corrections', () => {
  it('Settings Modal: removes duplicate audit heading, preserves LOCKED ON badges, renders full audit list (>5 items), and formats snake_case labels', () => {
    expect(formatAuditEventLabel('invoice_created')).toBe(
      'Invoice Created & Sent to Customer'
    );
    expect(formatAuditEventLabel('ai_proposal_approved')).toBe(
      'Billing AI Proposal Approved by User'
    );

    const eightAuditEvents: BillingAuditEventItem[] = Array.from(
      { length: 8 },
      (_, idx) => ({
        id: idx + 1,
        eventType: idx % 2 === 0 ? 'invoice_created' : 'ai_settings_updated',
        actorKind: 'user',
        createdAt: '2026-11-01T12:00:00Z',
        details: {},
      })
    );

    const { getByTestId, queryByText, getAllByText } = render(
      <BillingAISettingsModal
        visible={true}
        roleScope="doctor"
        initialSettings={getDefaultBillingAISettings('provider-1')}
        connection={null}
        auditEvents={eightAuditEvents}
        onSettingsUpdated={jest.fn()}
        onConnectionChanged={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(getByTestId('guardrail-hitl-locked')).toBeTruthy();
    expect(getByTestId('guardrail-phi-locked')).toBeTruthy();
    expect(getAllByText('LOCKED ON').length).toBe(2);

    // Ensure all 8 audit events are rendered (no .slice(0, 5) truncation)
    for (let i = 1; i <= 8; i++) {
      expect(getByTestId(`billing-audit-event-${i}`)).toBeTruthy();
    }

    // Ensure raw snake_case is replaced by human-readable text
    expect(queryByText('invoice_created')).toBeNull();
    expect(
      getAllByText('Invoice Created & Sent to Customer').length
    ).toBeGreaterThan(0);
  });

  it('Create Invoice Modal: selecting $35 Forms Completion immediately populates 35.00 (never retains 150.00) and supports Custom Amount + Due Date shortcuts', async () => {
    const patients = [
      {
        patientId: '11111111-1111-4111-8111-111111111102',
        fullName: 'Alex Rivera',
        emailMasked: 'a***@demo.paypal-billing-kit.local',
      },
      {
        patientId: '11111111-1111-4111-8111-111111111103',
        fullName: 'Jordan Taylor',
        emailMasked: 'j***@demo.paypal-billing-kit.local',
      },
    ];

    const { getByTestId, getByText } = render(
      <BillingCreateInvoiceModal
        visible={true}
        patients={patients}
        catalog={DEFAULT_SERVICE_CATALOG}
        onInvoiceCreated={jest.fn()}
        onClose={jest.fn()}
      />
    );

    const amountInput = getByTestId('create-invoice-amount-input');
    expect(amountInput.props.value).toBe('150.00');

    // Select $35.00 Administrative Forms Completion
    fireEvent.press(getByTestId('create-invoice-service-ADMIN-FORMS'));
    expect(getByTestId('create-invoice-amount-input').props.value).toBe('35.00');
    expect(getByText('CATALOG PRICE')).toBeTruthy();

    // Enter a custom amount
    fireEvent.changeText(getByTestId('create-invoice-amount-input'), '42.50');
    expect(getByText('CUSTOM AMOUNT')).toBeTruthy();

    // Reset back to catalog price ($35.00)
    fireEvent.press(getByTestId('create-invoice-reset-catalog-price-btn'));
    expect(getByTestId('create-invoice-amount-input').props.value).toBe('35.00');

    // Open interactive calendar picker & select +30d shortcut
    fireEvent.press(getByTestId('create-invoice-calendar-toggle-btn'));
    expect(getByTestId('create-invoice-calendar-picker')).toBeTruthy();
    fireEvent.press(getByTestId('create-invoice-due-shortcut-30d'));

    // Verify Save Draft, Send Invoice, and Cancel buttons exist
    expect(getByTestId('create-invoice-cancel-btn')).toBeTruthy();
    expect(getByTestId('create-invoice-save-draft-btn')).toBeTruthy();
    expect(getByTestId('create-invoice-send-btn')).toBeTruthy();
  });

  it('Invoice History & Detail: displays Original Amount vs Remaining Balance, $0.00 on Voided & Refunded invoices, and labels Sample Demo settlements accurately', () => {
    const invoices = getSyntheticInvoicesForRole('doctor');
    const voidedInv = invoices.find(
      (i) => i.invoiceNumber === 'PPB-INV-2026-1005'
    )!;
    const refundedInv = invoices.find(
      (i) => i.invoiceNumber === 'PPB-INV-2026-1006'
    )!;
    const samplePaidInv = invoices.find(
      (i) => i.invoiceNumber === 'PPB-INV-2026-1003'
    )!;

    // 1. Voided invoice shows $35.00 original and $0.00 remaining balance
    const { getByTestId: getVoidById } = render(
      <BillingInvoiceCard
        invoice={voidedInv}
        roleScope="doctor"
        onSelect={jest.fn()}
        onAskBillingAI={jest.fn()}
      />
    );
    expect(
      getVoidById(`billing-invoice-original-${voidedInv.id}`).props.children
    ).toBe('$35.00');
    expect(
      getVoidById(`billing-invoice-remaining-${voidedInv.id}`).props.children
    ).toBe('$0.00');

    // 2. Refunded invoice shows $45.00 original, refunded banner, and $0.00 remaining balance
    const { getByTestId: getRefundById } = render(
      <BillingInvoiceCard
        invoice={refundedInv}
        roleScope="doctor"
        onSelect={jest.fn()}
        onAskBillingAI={jest.fn()}
      />
    );
    expect(
      getRefundById(`billing-invoice-original-${refundedInv.id}`).props.children
    ).toBe('$45.00');
    expect(
      getRefundById(`billing-invoice-remaining-${refundedInv.id}`).props.children
    ).toBe('$0.00');
    expect(
      getRefundById(`billing-invoice-refund-banner-${refundedInv.id}`)
    ).toBeTruthy();

    // 3. Sample paid invoice clearly states "Sample Demo Record — Not a Live PayPal Capture"
    const { getByTestId: getSampleById } = render(
      <BillingInvoiceDetailModal
        visible={true}
        invoice={samplePaidInv}
        roleScope="doctor"
        onClose={jest.fn()}
        onAskBillingAI={jest.fn()}
      />
    );
    expect(
      getSampleById('billing-detail-settlement-verification')
    ).toBeTruthy();
  });

  it('DoctorBillingView & PatientBillingView: removes duplicate inline Add Invoice button and preserves status filtering', () => {
    const invoices = getSyntheticInvoicesForRole('doctor');
    const { queryByTestId, getByTestId } = render(
      <DoctorBillingView
        invoices={invoices}
        searchVisible={true}
        searchQuery=""
        onChangeSearchQuery={jest.fn()}
        onSelectInvoice={jest.fn()}
        onAskBillingAI={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );

    // Duplicate large inline Add Invoice button must NOT exist
    expect(queryByTestId('doctor-add-invoice-inline-btn')).toBeNull();
    expect(getByTestId('doctor-open-billing-ai-btn')).toBeTruthy();
    expect(getByTestId('doctor-filter-overdue')).toBeTruthy();

    const patientInvoices = getSyntheticInvoicesForRole('patient');
    const { getByTestId: getPatientTestId } = render(
      <PatientBillingView
        invoices={patientInvoices}
        searchVisible={false}
        searchQuery=""
        onChangeSearchQuery={jest.fn()}
        onSelectInvoice={jest.fn()}
        onAskBillingAI={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );
    expect(getPatientTestId('patient-open-billing-ai-btn')).toBeTruthy();
    expect(getPatientTestId('patient-failed-attempt-banner')).toBeTruthy();
  });

  it('Billing AI Focused Invoice Explanation: answers "what is this invoice for? when were services provided?" for #PPB-INV-2026-1003 with line items and service dates', async () => {
    clearBillingAIClientCacheForTests();
    const invoices = getSyntheticInvoicesForRole('doctor');
    const inv1003 = invoices.find((i) => i.invoiceNumber === 'PPB-INV-2026-1003')!;

    const res = await sendBillingAIMessage({
      message: 'what is this invoice for? when were services provided?',
      roleScope: 'doctor',
      focusedInvoiceId: inv1003.id,
      focusedInvoiceNumber: inv1003.invoiceNumber,
    });

    expect(res.reply.content).toContain('Statement #PPB-INV-2026-1003 (PAID)');
    expect(res.reply.content).toContain('ADMIN-FOLLOWUP');
    expect(res.reply.content).toContain(
      'When services were provided / statement issued: Sep 12, 2026'
    );
    expect(res.reply.content).toContain('Original Total $125.00 USD');
    expect(res.reply.content).toContain('Remaining Balance Due $0.00 USD');
  });

  it('Section 8 Regression: PayPalConnectCard renders distinct Disconnected, Demo Profile Available (Sandbox Configuration Missing), and Sandbox Authenticated (Account Linked) states', async () => {
    const onConnectionChanged = jest.fn();

    // 1. Disconnected state: shows DISCONNECTED badge, Connect PayPal Sandbox button, and hides setup form initially
    const { getByTestId, queryByTestId, getByText, rerender } = render(
      <PayPalConnectCard
        roleScope="patient"
        connection={{
          connected: false,
          environment: 'sandbox',
          connectionType: 'payer',
          paypalEmailMasked: null,
          paypalPayerIdMasked: null,
          connectedAt: null,
          sandboxCredentialsConfigured: false,
          oauthVerified: false,
        }}
        onConnectionChanged={onConnectionChanged}
      />
    );

    expect(getByTestId('paypal-connect-status-badge')).toBeTruthy();
    expect(getByText('DISCONNECTED')).toBeTruthy();
    expect(getByTestId('paypal-connect-cta-btn')).toBeTruthy();
    expect(queryByTestId('paypal-connect-form')).toBeNull();
    expect(queryByTestId('paypal-disconnect-cta-btn')).toBeNull();

    // Clicking Connect PayPal Sandbox reveals setup form
    fireEvent.press(getByTestId('paypal-connect-cta-btn'));
    expect(getByTestId('paypal-connect-form')).toBeTruthy();
    expect(getByTestId('paypal-connect-email-input')).toBeTruthy();

    // 2. Demo Profile Available (unauthenticated seed where Sandbox Configuration is Missing)
    rerender(
      <PayPalConnectCard
        roleScope="patient"
        connection={{
          connected: true,
          environment: 'sandbox',
          connectionType: 'payer',
          paypalPayerIdMasked: 'PAYER-SANDBOX-ALEX',
          paypalEmailMasked: 'a***@personal.example.com',
          connectedAt: '2026-10-15T10:00:00Z',
          sandboxCredentialsConfigured: false,
          oauthVerified: false,
        }}
        onConnectionChanged={onConnectionChanged}
      />
    );

    expect(getByText('DEMO PROFILE AVAILABLE')).toBeTruthy();
    expect(getByTestId('paypal-connected-account-summary')).toBeTruthy();

    // 3. Sandbox Authenticated + Account Linked state (backed by real PayPal OAuth 2.0)
    rerender(
      <PayPalConnectCard
        roleScope="patient"
        connection={{
          connected: true,
          environment: 'sandbox',
          connectionType: 'payer',
          paypalPayerIdMasked: 'SB-PAYER-ALEX-1002',
          paypalEmailMasked: 'sb-***@personal.example.com',
          connectedAt: '2026-11-02T21:35:00Z',
          sandboxCredentialsConfigured: true,
          oauthVerified: true,
        }}
        onConnectionChanged={onConnectionChanged}
      />
    );

    expect(getByText('SANDBOX AUTHENTICATED')).toBeTruthy();
    expect(getByTestId('paypal-connected-account-summary')).toBeTruthy();
    expect(getByTestId('paypal-disconnect-cta-btn')).toBeTruthy();
    expect(queryByTestId('paypal-connect-form')).toBeNull();
    expect(queryByTestId('paypal-connect-cta-btn')).toBeNull();
  });

  it('Section 9 Regression: Jordan Taylor #PPB-INV-2026-1004 failed payment statement opens cleanly and retries without "Invoice not found."', async () => {
    const invoices = getSyntheticInvoicesForRole('patient');
    const jordanFailedInv = invoices.find(
      (i) => i.invoiceNumber === 'PPB-INV-2026-1004'
    )!;
    expect(jordanFailedInv).toBeTruthy();

    const { getByTestId, getByText, queryByText } = render(
      <BillingInvoiceDetailModal
        visible={true}
        invoice={jordanFailedInv}
        roleScope="patient"
        onClose={jest.fn()}
        onAskBillingAI={jest.fn()}
      />
    );

    // Failed attempt history is rendered
    expect(getByText('Last Payment Attempt Declined')).toBeTruthy();

    // Press Retry with PayPal Sandbox button
    const retryBtn = getByTestId('billing-detail-paypal-checkout-btn');
    fireEvent.press(retryBtn);

    await waitFor(() => {
      expect(getByTestId('billing-detail-feedback-banner')).toBeTruthy();
    });

    expect(queryByText(/Invoice not found/i)).toBeNull();
  });
});
