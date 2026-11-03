import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
} from 'react-native';
import {
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  FlaskConical,
  FileDown,
  ExternalLink,
  CreditCard,
  ArrowLeft,
} from 'lucide-react-native';
import {
  ModalActionButtons,
  type ModalActionButtonConfig,
} from '../ui/ModalActionButtons';
import BillingModalShell, { billingModalStyles } from './BillingModalShell';
import type {
  BillingRoleScope,
  SyntheticBillingInvoice,
} from '../../src/billing/types';
import {
  formatBillingDate,
  formatUsdCents,
} from '../../src/billing/data/syntheticBillingFixtures';
import {
  getOrCreateDemoSessionIdSync,
  invokePayPalBillingFunction,
  payInvoiceWithSandboxCard,
  sendBillingPaymentReminder,
  sendDraftBillingInvoice,
  simulateBillingDemoRefund,
  simulateBillingDemoSettlement,
  voidBillingInvoice,
} from '../../src/billing/api/billingService';

export interface PayPalBrowserCheckoutReturnState {
  mode: 'return' | 'cancel';
  orderId?: string | null;
  payerId?: string | null;
}

export interface BillingInvoiceDetailModalProps {
  visible: boolean;
  invoice: SyntheticBillingInvoice | null;
  roleScope: BillingRoleScope;
  onClose: () => void;
  onAskBillingAI: (invoice: SyntheticBillingInvoice) => void;
  onInvoiceMutated?: () => void;
  initialCheckoutState?: PayPalBrowserCheckoutReturnState | null;
  onClearCheckoutState?: () => void;
  onBackToNotifications?: (() => void) | null;
}

type SandboxCardProfileOption =
  | 'visa_sandbox'
  | 'mastercard_sandbox'
  | 'decline_refused';

export default function BillingInvoiceDetailModal({
  visible,
  invoice,
  roleScope,
  onClose,
  onAskBillingAI,
  onInvoiceMutated,
  initialCheckoutState = null,
  onClearCheckoutState,
  onBackToNotifications = null,
}: BillingInvoiceDetailModalProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeCheckoutSession, setActiveCheckoutSession] = useState<{
    orderId: string;
    approvalUrl: string;
    guestCardCheckoutUrl: string;
    classicWebCheckoutUrl: string;
  } | null>(null);
  const [selectedCardProfile, setSelectedCardProfile] =
    useState<SandboxCardProfileOption>('visa_sandbox');
  const [localSettledReceipt, setLocalSettledReceipt] = useState<{
    invoiceId: string;
    receiptNumber: string;
    isSample: boolean;
  } | null>(null);
  const capturedOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!visible || !invoice) return;
    if (initialCheckoutState?.mode === 'return') {
      const returnedOrderId = initialCheckoutState.orderId
        ? String(initialCheckoutState.orderId).trim()
        : null;
      if (invoice.status === 'paid' || invoice.balanceDueCents <= 0) {
        setBannerMessage({
          type: 'info',
          text: `Duplicate Capture Prevented: Statement #${invoice.invoiceNumber} is already settled${
            invoice.receiptNumber ? ` (Capture ID: ${invoice.receiptNumber})` : ''
          }. Refreshing or returning from checkout did not charge your account again.`,
        });
        return;
      }
      if (returnedOrderId) {
        setActiveOrderId(returnedOrderId);
        const safeUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(
          returnedOrderId
        )}&appSwitchEligible=false`;
        setActiveCheckoutSession({
          orderId: returnedOrderId,
          approvalUrl: safeUrl,
          guestCardCheckoutUrl: `${safeUrl}&fundingSource=card`,
          classicWebCheckoutUrl: `https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_express-checkout&token=${encodeURIComponent(
            returnedOrderId
          )}&useraction=commit`,
        });
      }
      setBannerMessage({
        type: 'info',
        text: `Returned from PayPal Sandbox Browser Checkout${
          returnedOrderId ? ` (Order ${returnedOrderId})` : ''
        }${
          initialCheckoutState.payerId
            ? ` • Buyer Approved (Payer ${initialCheckoutState.payerId})`
            : ''
        }. Tap "Capture Approved Order" below to finalize settlement.`,
      });
    } else if (initialCheckoutState?.mode === 'cancel') {
      const canceledOrderId = initialCheckoutState.orderId
        ? String(initialCheckoutState.orderId).trim()
        : null;
      setActiveOrderId(null);
      setActiveCheckoutSession(null);
      setBannerMessage({
        type: 'info',
        text: `PayPal Sandbox browser checkout was canceled${
          canceledOrderId ? ` (Order ${canceledOrderId})` : ''
        }. No funds were charged. You can retry checkout below at any time.`,
      });
    }
  }, [initialCheckoutState, invoice, visible]);

  if (!visible || !invoice) return null;

  const activeLocalReceipt =
    localSettledReceipt && localSettledReceipt.invoiceId === invoice.id
      ? localSettledReceipt
      : null;
  const isSettledInvoice =
    invoice.status === 'paid' ||
    invoice.status === 'refunded' ||
    Boolean(activeLocalReceipt);
  const effectiveReceiptNumber = isSettledInvoice
    ? invoice.receiptNumber || activeLocalReceipt?.receiptNumber || null
    : null;

  const isDoctor = roleScope === 'doctor';
  const canCustomerPay =
    !isDoctor &&
    !activeLocalReceipt &&
    (invoice.status === 'pending' ||
      invoice.status === 'sent' ||
      invoice.status === 'overdue' ||
      invoice.status === 'failed');

  const canDoctorSendDraft = isDoctor && invoice.status === 'draft';
  const canDoctorSendReminder =
    isDoctor &&
    (invoice.status === 'pending' ||
      invoice.status === 'sent' ||
      invoice.status === 'overdue' ||
      invoice.status === 'failed');
  const canDoctorVoid =
    isDoctor &&
    (invoice.status === 'draft' ||
      invoice.status === 'pending' ||
      invoice.status === 'sent' ||
      invoice.status === 'overdue' ||
      invoice.status === 'failed');
  const canDoctorRefund = isDoctor && invoice.status === 'paid';

  const effectiveBalanceCents =
    invoice.status === 'void' ||
    invoice.status === 'refunded' ||
    invoice.status === 'paid' ||
    Boolean(activeLocalReceipt)
      ? 0
      : invoice.balanceDueCents;

  const isSampleRecord =
    invoice.settlementVerificationStatus === 'sample_demo' ||
    Boolean(activeLocalReceipt?.isSample);
  const isVerifiedPayPalCapture =
    invoice.settlementVerificationStatus === 'paypal_verified' ||
    (Boolean(activeLocalReceipt) && !activeLocalReceipt?.isSample);
  const primaryServiceCode = invoice.lineItems[0]?.serviceCode || 'ADMIN-SERVICE';
  const latestApprovalPending = invoice.paymentAttempts.find(
    (a) =>
      a.attemptClassification === 'approval_required' ||
      a.attemptClassification === 'awaiting_buyer_approval'
  );
  const latestFailure = invoice.paymentAttempts.find(
    (a) =>
      a.status === 'failed_demo' &&
      a.failureReason &&
      a.attemptClassification !== 'approval_required' &&
      a.attemptClassification !== 'awaiting_buyer_approval'
  );

  const openBrowserUrlSafely = (targetUrl: string) => {
    if (!targetUrl) return;
    // Never invoke native paypal:// app schemes; always stay in HTTP/HTTPS web browser
    const safeBrowserUrl = targetUrl.includes('appSwitchEligible=')
      ? targetUrl
      : `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}appSwitchEligible=false`;
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(safeBrowserUrl, '_blank', 'noopener,noreferrer');
    } else {
      try {
        void Linking.openURL(safeBrowserUrl);
      } catch {
        // Ignore in test environment
      }
    }
  };

  const handlePayWithPayPal = async () => {
    if (invoice.status === 'paid' || Boolean(activeLocalReceipt)) {
      setBannerMessage({
        type: 'info',
        text: `Duplicate Capture Prevented: Statement #${invoice.invoiceNumber} is already paid ($0.00 balance due).`,
      });
      return;
    }
    setBannerMessage(null);
    onClearCheckoutState?.();
    setBusyAction('create_order');
    try {
      const appOrigin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://paypal-ai-billing-kit.vercel.app';
      const res = await invokePayPalBillingFunction({
        action: 'create-order',
        invoiceId: invoice.id,
        invoice_id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoice_number: invoice.invoiceNumber,
        appOrigin,
      });
      if (!res.ok) {
        if (res.code === 'PAYPAL_SANDBOX_CREDENTIALS_MISSING') {
          setBannerMessage({
            type: 'info',
            text:
              res.message ||
              `Statement #${invoice.invoiceNumber} (${formatUsdCents(invoice.balanceDueCents)}) verified for checkout. Live PayPal Sandbox REST API credentials are not configured on the server; use "Simulate Demo Settlement" below or configure Sandbox credentials to open live PayPal buyer approval.`,
          });
          return;
        }
        setBannerMessage({
          type: 'error',
          text:
            res.message ||
            'PayPal Sandbox API credentials (PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET) are not configured on the server.',
        });
        return;
      }
      const orderId = String(res.data?.order_id || res.data?.orderId || '');
      const rawApprove =
        res.data?.approval_url || res.data?.approveUrl || res.data?.approvalUrl || '';
      const approvalUrl = rawApprove
        ? rawApprove.includes('appSwitchEligible=')
          ? String(rawApprove)
          : `${rawApprove}${String(rawApprove).includes('?') ? '&' : '?'}appSwitchEligible=false`
        : orderId
          ? `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(
              orderId
            )}&appSwitchEligible=false`
          : '';
      const guestCardCheckoutUrl =
        res.data?.guestCardCheckoutUrl ||
        (approvalUrl ? `${approvalUrl}&fundingSource=card` : '');
      const classicWebCheckoutUrl =
        res.data?.classicWebCheckoutUrl ||
        (orderId
          ? `https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_express-checkout&token=${encodeURIComponent(
              orderId
            )}&useraction=commit`
          : '');

      if (orderId) {
        setActiveOrderId(orderId);
        setActiveCheckoutSession({
          orderId,
          approvalUrl,
          guestCardCheckoutUrl,
          classicWebCheckoutUrl,
        });
      }
      setBannerMessage({
        type: 'info',
        text: `PayPal Sandbox Order ${orderId} created in Browser Checkout Mode (iOS app handoff disabled via appSwitchEligible=false). Complete approval in the Browser Checkout Panel below, then tap "Capture Approved Order".`,
      });
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'Unable to start PayPal Sandbox checkout.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelBrowserCheckout = () => {
    const canceledOrder = activeOrderId;
    setActiveOrderId(null);
    setActiveCheckoutSession(null);
    onClearCheckoutState?.();
    setBannerMessage({
      type: 'info',
      text: `PayPal Sandbox checkout canceled${
        canceledOrder ? ` for Order ${canceledOrder}` : ''
      }. No funds were charged. You can restart checkout whenever you are ready.`,
    });
  };

  const handleCaptureOrder = async () => {
    if (!activeOrderId) return;
    if (
      invoice.status === 'paid' ||
      Boolean(activeLocalReceipt) ||
      capturedOrderIdsRef.current.has(activeOrderId)
    ) {
      setBannerMessage({
        type: 'info',
        text: `Duplicate Capture Prevented: Order ${activeOrderId} for Statement #${invoice.invoiceNumber} has already been captured.`,
      });
      return;
    }
    setBannerMessage(null);
    setBusyAction('capture_order');
    try {
      const res = await invokePayPalBillingFunction({
        action: 'capture-order',
        invoiceId: invoice.id,
        invoice_id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoice_number: invoice.invoiceNumber,
        orderId: activeOrderId,
        order_id: activeOrderId,
      });
      if (!res.ok) {
        const isApprovalRequired =
          res.code === 'ORDER_NOT_APPROVED' ||
          res.data?.attempt_classification === 'approval_required' ||
          String(res.message || '').includes('ORDER_NOT_APPROVED') ||
          String(res.message || '').includes('waiting for buyer approval');
        setBannerMessage({
          type: isApprovalRequired ? 'info' : 'error',
          text: isApprovalRequired
            ? 'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'
            : res.message || 'PayPal Sandbox capture failed.',
        });
        onInvoiceMutated?.();
        return;
      }
      const captureId = res.data?.capture_id || res.data?.captureId || 'COMPLETED';
      capturedOrderIdsRef.current.add(activeOrderId);
      setLocalSettledReceipt({
        invoiceId: invoice.id,
        receiptNumber: String(captureId),
        isSample: false,
      });
      setBannerMessage({
        type: 'success',
        text: `Payment settled! Verified PayPal Sandbox Capture ID: ${captureId}.`,
      });
      setActiveOrderId(null);
      setActiveCheckoutSession(null);
      onClearCheckoutState?.();
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'PayPal Sandbox capture failed.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendDraft = async () => {
    setBannerMessage(null);
    setBusyAction('send_draft');
    try {
      await sendDraftBillingInvoice(invoice.id);
      setBannerMessage({
        type: 'success',
        text: `Invoice ${invoice.invoiceNumber} sent to customer.`,
      });
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'Failed to send draft invoice.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleVoidInvoice = async () => {
    setBannerMessage(null);
    setBusyAction('void_invoice');
    try {
      await voidBillingInvoice(invoice.id);
      setBannerMessage({
        type: 'success',
        text: `Invoice ${invoice.invoiceNumber} has been voided ($0.00 balance due).`,
      });
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'Failed to void invoice.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendReminder = async () => {
    setBannerMessage(null);
    setBusyAction('send_reminder');
    try {
      await sendBillingPaymentReminder(invoice.id);
      setBannerMessage({
        type: 'success',
        text: `Payment reminder notification sent to ${invoice.patientDisplayName}.`,
      });
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'Failed to send payment reminder.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSimulateDemoSettlement = async () => {
    setBannerMessage(null);
    setBusyAction('simulate_demo_settlement');
    try {
      const sim = await simulateBillingDemoSettlement(invoice.id);
      setLocalSettledReceipt({
        invoiceId: invoice.id,
        receiptNumber: String(sim.captureId || 'SAMPLE-DEMO-SETTLEMENT'),
        isSample: true,
      });
      setBannerMessage({
        type: 'success',
        text: `Demo Settlement Completed (${sim.captureId}) — Marked as Sample Demo Record (Not a Live PayPal Capture).`,
      });
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'Failed to simulate demo settlement.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePayWithSandboxCard = async (
    profileOverride?: SandboxCardProfileOption
  ) => {
    const chosenProfile = profileOverride || selectedCardProfile || 'visa_sandbox';
    setBannerMessage(null);
    setBusyAction('pay_with_sandbox_card');
    try {
      const res = await payInvoiceWithSandboxCard({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        cardProfile: chosenProfile,
        intent: 'CAPTURE',
      });
      if (!res.ok) {
        setBannerMessage({
          type: 'error',
          text:
            res.message ||
            'PayPal Sandbox Direct Card payment failed. Please check card profile or credentials.',
        });
        onInvoiceMutated?.();
        return;
      }
      const captureId =
        res.data?.capture_id || res.data?.captureId || 'COMPLETED';
      const orderId = res.data?.order_id || res.data?.orderId || '';
      const brandLabel =
        res.data?.card_brand ||
        (chosenProfile === 'mastercard_sandbox' ? 'MASTERCARD' : 'VISA');
      const lastDigits =
        res.data?.card_last_digits ||
        (chosenProfile === 'mastercard_sandbox' ? '8291' : '0191');
      setLocalSettledReceipt({
        invoiceId: invoice.id,
        receiptNumber: `PP-CAP-${captureId}`,
        isSample: false,
      });
      setBannerMessage({
        type: 'success',
        text: `PayPal Sandbox Direct Card Payment Captured! Order ${orderId} • Capture ID: ${captureId} (${brandLabel} •••• ${lastDigits}).`,
      });
      setActiveOrderId(null);
      setActiveCheckoutSession(null);
      onClearCheckoutState?.();
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'Unable to execute PayPal Sandbox Direct Card payment.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefundInvoice = async () => {
    setBannerMessage(null);
    setBusyAction('refund_invoice');
    try {
      if (isVerifiedPayPalCapture) {
        const res = await invokePayPalBillingFunction({
          action: 'refund-capture',
          invoice_id: invoice.id,
          reason: 'Provider-initiated administrative refund',
        });
        if (res.ok) {
          const refundId = res.data?.refund_id || res.data?.refundId || 'REFUNDED';
          setBannerMessage({
            type: 'success',
            text: `PayPal Refund ${refundId} processed ($0.00 remaining balance).`,
          });
          onInvoiceMutated?.();
          return;
        }
      }
      const demoRef = await simulateBillingDemoRefund(invoice.id);
      setBannerMessage({
        type: 'success',
        text: `Refund ${demoRef.refundId} processed in Demo Session ($0.00 remaining balance).`,
      });
      onInvoiceMutated?.();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err?.message || 'Refund failed.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const footerActions: ModalActionButtonConfig[] = [
    {
      label: 'Close',
      onPress: onClose,
      variant: 'cancel',
      testID: 'billing-detail-cancel-btn',
    },
    {
      label: 'Ask Billing AI',
      onPress: () => {
        onClose();
        onAskBillingAI(invoice);
      },
      variant: 'warning',
      icon: <Sparkles size={16} color="#FFFFFF" />,
      testID: 'billing-detail-ask-ai-btn',
    },
  ];

  if (canCustomerPay) {
    if (activeOrderId) {
      footerActions.push({
        label: 'Capture Approved Order',
        onPress: handleCaptureOrder,
        variant: 'success',
        loading: busyAction === 'capture_order',
        disabled: Boolean(busyAction),
        testID: 'billing-detail-capture-paypal-btn',
      });
    } else {
      footerActions.push({
        label:
          invoice.status === 'failed'
            ? 'Retry with PayPal Sandbox'
            : 'Pay with PayPal Sandbox',
        onPress: handlePayWithPayPal,
        variant: 'primary',
        loading: busyAction === 'create_order',
        disabled: Boolean(busyAction),
        testID: 'billing-detail-paypal-checkout-btn',
      });
    }
  }

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title="Statement Details"
      subtitle={`#${invoice.invoiceNumber} • ${invoice.status.toUpperCase()}`}
      testID="billing-invoice-detail-modal"
      closeTestID="billing-detail-close-btn"
      closeAccessibilityLabel="Close invoice details"
      headerAccessory={
        onBackToNotifications ? (
          <Pressable
            style={styles.backToNotificationsChip}
            onPress={onBackToNotifications}
            accessibilityRole="button"
            accessibilityLabel="Back to Billing Notifications"
            testID="billing-detail-back-to-notifications-btn"
          >
            <ArrowLeft size={13} color="#C2410C" />
            <Text style={styles.backToNotificationsText}>
              Back to Notifications
            </Text>
          </Pressable>
        ) : undefined
      }
      footer={<ModalActionButtons actions={footerActions} />}
    >
      {bannerMessage ? (
        <View
          style={[
            styles.feedbackBanner,
            bannerMessage.type === 'error'
              ? styles.feedbackError
              : bannerMessage.type === 'success'
                ? styles.feedbackSuccess
                : styles.feedbackInfo,
          ]}
          testID="billing-detail-feedback-banner"
        >
          {bannerMessage.type === 'success' ? (
            <CheckCircle2 size={16} color="#047857" />
          ) : (
            <AlertTriangle
              size={16}
              color={bannerMessage.type === 'error' ? '#B91C1C' : '#1D4ED8'}
            />
          )}
          <Text
            style={[
              styles.feedbackText,
              bannerMessage.type === 'error'
                ? styles.feedbackErrorText
                : bannerMessage.type === 'success'
                  ? styles.feedbackSuccessText
                  : styles.feedbackInfoText,
            ]}
          >
            {bannerMessage.text}
          </Text>
        </View>
      ) : null}

      {/* Browser-Based PayPal Sandbox Checkout Panel (Prevents Mobile App Handoff) */}
      {canCustomerPay && (activeCheckoutSession || activeOrderId) ? (
        <View
          style={styles.browserCheckoutPanel}
          testID="billing-detail-browser-checkout-panel"
        >
          <View style={styles.browserCheckoutHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.browserCheckoutTitle}>
                PayPal Sandbox Browser Checkout
              </Text>
              <Text style={styles.browserCheckoutSub}>
                Stays in your mobile/desktop browser — never hands off to the
                installed PayPal app (`appSwitchEligible=false`).
              </Text>
            </View>
            <View
              style={styles.browserCheckoutOrderBadge}
              testID="billing-checkout-panel-order-id"
            >
              <Text style={styles.browserCheckoutOrderBadgeText}>
                Order {activeCheckoutSession?.orderId || activeOrderId}
              </Text>
            </View>
          </View>

          <View style={styles.browserCheckoutActionsCol}>
            {activeCheckoutSession?.approvalUrl ? (
              <Pressable
                style={styles.browserOpenPrimaryBtn}
                onPress={() =>
                  openBrowserUrlSafely(activeCheckoutSession.approvalUrl)
                }
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                accessibilityLabel="Open PayPal Browser Checkout without App Switch"
                testID="billing-checkout-panel-open-browser-btn"
              >
                <ExternalLink size={15} color="#FFFFFF" />
                <Text style={styles.browserOpenPrimaryBtnText}>
                  Open PayPal Browser Checkout (No App Switch)
                </Text>
              </Pressable>
            ) : null}

            {activeCheckoutSession?.guestCardCheckoutUrl ? (
              <Pressable
                style={styles.browserOpenSecondaryBtn}
                onPress={() =>
                  openBrowserUrlSafely(activeCheckoutSession.guestCardCheckoutUrl)
                }
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                accessibilityLabel="Open PayPal Guest Card Web Form"
                testID="billing-checkout-panel-open-guest-card-btn"
              >
                <CreditCard size={15} color="#1E40AF" />
                <Text style={styles.browserOpenSecondaryBtnText}>
                  Open PayPal Guest Card Web Form (Browser Only)
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.inAppCardBox}>
            <Text style={styles.inAppCardTitle}>
              Or Complete In-Browser Sandbox Card Checkout (`Orders v2 payment_source.card`)
            </Text>
            <View style={styles.cardProfilePillsRow}>
              {(
                [
                  {
                    key: 'visa_sandbox' as const,
                    label: 'VISA •••• 0191 (Approve)',
                  },
                  {
                    key: 'mastercard_sandbox' as const,
                    label: 'Mastercard •••• 8291 (Approve)',
                  },
                  {
                    key: 'decline_refused' as const,
                    label: 'Test Decline (4000 •••• 0002)',
                  },
                ]
              ).map((opt) => {
                const isSelected = selectedCardProfile === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={[
                      styles.cardProfilePill,
                      isSelected && styles.cardProfilePillActive,
                    ]}
                    onPress={() => setSelectedCardProfile(opt.key)}
                    disabled={Boolean(busyAction)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    testID={`billing-checkout-card-profile-${opt.key}`}
                  >
                    <Text
                      style={[
                        styles.cardProfilePillText,
                        isSelected && styles.cardProfilePillTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.browserPanelBottomRow}>
              <Pressable
                style={[styles.inAppCardSubmitBtn, { flex: 1 }]}
                onPress={() => void handlePayWithSandboxCard(selectedCardProfile)}
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                accessibilityLabel="Complete In-Browser Sandbox Card Checkout"
                testID="billing-checkout-panel-card-pay-btn"
              >
                <CreditCard size={14} color="#FFFFFF" />
                <Text style={styles.inAppCardSubmitBtnText}>
                  {busyAction === 'pay_with_sandbox_card'
                    ? 'Capturing Sandbox Card...'
                    : 'Complete In-Browser Sandbox Card Checkout'}
                </Text>
              </Pressable>

              <Pressable
                style={styles.cancelCheckoutBtn}
                onPress={handleCancelBrowserCheckout}
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                accessibilityLabel="Cancel PayPal Sandbox Checkout"
                testID="billing-checkout-panel-cancel-btn"
              >
                <Text style={styles.cancelCheckoutBtnText}>Cancel Checkout</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {/* Sample Demo Record vs Verified PayPal Capture Notice */}
      {effectiveReceiptNumber ? (
        <View
          style={[
            styles.settlementNoticeBox,
            isSampleRecord && !isVerifiedPayPalCapture
              ? styles.sampleSettlementBox
              : styles.liveSettlementBox,
          ]}
          testID="billing-detail-settlement-verification"
        >
          {isSampleRecord && !isVerifiedPayPalCapture ? (
            <>
              <FlaskConical size={16} color="#92400E" />
              <View style={{ flex: 1 }}>
                <Text style={styles.sampleSettlementTitle}>
                  Sample Demo Settlement Record (Not a Live PayPal Capture)
                </Text>
                <Text style={styles.sampleSettlementSub}>
                  {invoice.organizationName} • Sample Demo Receipt — Not a Real PayPal
                  Payment (Reference ID: {effectiveReceiptNumber}).
                </Text>
              </View>
            </>
          ) : (
            <>
              <CheckCircle2 size={16} color="#047857" />
              <View style={{ flex: 1 }}>
                <Text style={styles.liveSettlementTitle}>
                  Verified PayPal Sandbox Settlement • Payment processed through PayPal
                </Text>
                <Text style={styles.liveSettlementSub}>
                  {invoice.organizationName} (Provider: {invoice.issuerDoctorName}) • Capture ID:{' '}
                  {effectiveReceiptNumber} (PayPal Sandbox Test Transaction)
                </Text>
              </View>
            </>
          )}
          <Pressable
            style={styles.downloadPdfBtn}
            onPress={() => {
              const sid = getOrCreateDemoSessionIdSync();
              const pdfUrl = `https://paypal-ai-billing-mcp.apd1034.workers.dev/api/receipts/${encodeURIComponent(
                invoice.invoiceNumber
              )}.pdf?session=${encodeURIComponent(sid)}`;
              if (typeof window !== 'undefined' && typeof window.open === 'function') {
                window.open(pdfUrl, '_blank', 'noopener,noreferrer');
              } else {
                void Linking.openURL(pdfUrl);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={`Download PDF Receipt for ${invoice.invoiceNumber}`}
            testID="billing-download-pdf-receipt-btn"
          >
            <FileDown size={14} color="#1E40AF" />
            <Text style={styles.downloadPdfBtnText}>Download PDF Receipt</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Summary Banner */}
      <View style={styles.amountHero}>
        <Text style={styles.amountHeroLabel}>{invoice.administrativeSummary}</Text>
        <Text
          style={styles.amountHeroValue}
          testID="billing-detail-original-amount"
        >
          {formatUsdCents(invoice.totalCents)} {invoice.currencyCode}
        </Text>
        <Text
          style={styles.amountHeroSub}
          testID="billing-detail-remaining-balance"
        >
          Original Amount: {formatUsdCents(invoice.totalCents)} • Remaining
          Balance Due: {formatUsdCents(effectiveBalanceCents)} • Due{' '}
          {formatBillingDate(invoice.dueDate)}
        </Text>
      </View>

      {/* Provider Quick Actions */}
      {isDoctor &&
      (canDoctorSendDraft ||
        canDoctorSendReminder ||
        canDoctorVoid ||
        canDoctorRefund) ? (
        <View style={styles.providerActionsBox}>
          <Text style={styles.sectionTitle}>Provider Invoice Actions</Text>
          <View style={styles.providerButtonsRow}>
            {canDoctorSendDraft ? (
              <Pressable
                style={[billingModalStyles.primaryButton, styles.providerBtnFlex]}
                onPress={handleSendDraft}
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                testID="billing-detail-send-draft-btn"
              >
                <Text style={billingModalStyles.primaryButtonText}>
                  {busyAction === 'send_draft'
                    ? 'Sending...'
                    : 'Send Draft to Customer'}
                </Text>
              </Pressable>
            ) : null}

            {canDoctorSendReminder ? (
              <Pressable
                style={[billingModalStyles.primaryButton, styles.providerBtnFlex]}
                onPress={handleSendReminder}
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                testID="billing-detail-send-reminder-btn"
              >
                <Text style={billingModalStyles.primaryButtonText}>
                  {busyAction === 'send_reminder'
                    ? 'Sending...'
                    : 'Send Payment Reminder'}
                </Text>
              </Pressable>
            ) : null}

            {canDoctorVoid ? (
              <Pressable
                style={styles.providerDangerBtn}
                onPress={handleVoidInvoice}
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                testID="billing-detail-void-btn"
              >
                <Text style={styles.providerDangerBtnText}>
                  {busyAction === 'void_invoice' ? 'Voiding...' : 'Void Invoice'}
                </Text>
              </Pressable>
            ) : null}

            {canDoctorRefund ? (
              <Pressable
                style={styles.providerRefundBtn}
                onPress={handleRefundInvoice}
                disabled={Boolean(busyAction)}
                accessibilityRole="button"
                testID="billing-detail-refund-btn"
              >
                <Text style={styles.providerRefundBtnText}>
                  {busyAction === 'refund_invoice'
                    ? 'Refunding...'
                    : 'Issue Refund'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Customer Demo & Direct Card Settlement Options */}
      {canCustomerPay ? (
        <View style={styles.providerActionsBox}>
          <Text style={styles.sectionTitle}>Sandbox & Demo Settlement Options</Text>
          <Text
            style={{
              fontSize: 12,
              lineHeight: 17,
              color: '#475569',
              marginBottom: 8,
            }}
          >
            Choose between PayPal Sandbox Wallet Checkout (footer button), automated server-side PayPal Sandbox Direct Card Checkout (`payment_source.card`), or an explicitly labeled Sample Demo Settlement.
          </Text>
          <View style={styles.providerButtonsRow}>
            <Pressable
              style={[billingModalStyles.primaryButton, { alignSelf: 'flex-start' }]}
              onPress={() => void handlePayWithSandboxCard()}
              disabled={Boolean(busyAction)}
              accessibilityRole="button"
              testID="billing-detail-sandbox-card-btn"
            >
              <Text style={billingModalStyles.primaryButtonText}>
                {busyAction === 'pay_with_sandbox_card'
                  ? 'Capturing Sandbox Card...'
                  : 'Pay with PayPal Sandbox Card (VISA Test Card)'}
              </Text>
            </Pressable>
            <Pressable
              style={[billingModalStyles.secondaryButton, { alignSelf: 'flex-start' }]}
              onPress={handleSimulateDemoSettlement}
              disabled={Boolean(busyAction)}
              accessibilityRole="button"
              testID="billing-detail-simulate-demo-settlement-btn"
            >
              <Text style={billingModalStyles.secondaryButtonText}>
                {busyAction === 'simulate_demo_settlement'
                  ? 'Simulating Settlement...'
                  : 'Simulate Demo Settlement (Sample Record)'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Counterparts & Metadata */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Statement Metadata</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaKey}>Organization</Text>
          <Text style={styles.metaVal}>{invoice.organizationName}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaKey}>Provider</Text>
          <Text style={styles.metaVal}>{invoice.issuerDoctorName}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaKey}>Customer</Text>
          <Text style={styles.metaVal}>{invoice.patientDisplayName}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaKey}>Service Code</Text>
          <Text style={styles.metaVal}>{primaryServiceCode}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaKey}>Original Invoice Total</Text>
          <Text style={styles.metaVal}>{formatUsdCents(invoice.totalCents)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaKey}>Remaining Balance Due</Text>
          <Text style={styles.metaVal}>
            {formatUsdCents(effectiveBalanceCents)}
          </Text>
        </View>
        {invoice.amountRefundedCents > 0 ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Refunded Amount</Text>
            <Text style={styles.metaVal}>
              {formatUsdCents(invoice.amountRefundedCents)}
            </Text>
          </View>
        ) : null}
        {invoice.receiptNumber ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>
              {isSampleRecord && !isVerifiedPayPalCapture
                ? 'Sample Reference ID'
                : 'PayPal Capture ID'}
            </Text>
            <Text style={styles.metaVal}>{invoice.receiptNumber}</Text>
          </View>
        ) : null}
      </View>

      {/* Line Items */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Administrative Line Items</Text>
        {invoice.lineItems.map((item) => (
          <View key={item.id} style={styles.lineItemRow}>
            <View style={styles.lineItemLeft}>
              <Text style={styles.lineItemTitle}>{item.description}</Text>
              <Text style={styles.lineItemMeta}>
                {item.serviceCode} • Qty {item.quantity} ×{' '}
                {formatUsdCents(item.unitAmountCents)}
              </Text>
            </View>
            <Text style={styles.lineItemTotal}>
              {formatUsdCents(item.lineTotalCents)}
            </Text>
          </View>
        ))}

        <View style={styles.divider} />

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Original Invoice Amount</Text>
          <Text style={styles.totalValue}>
            {formatUsdCents(invoice.totalCents)}
          </Text>
        </View>
        <View style={[styles.totalRow, { marginTop: 6 }]}>
          <Text style={styles.totalLabel}>Remaining Balance Due</Text>
          <Text
            style={[
              styles.totalValue,
              effectiveBalanceCents === 0 && { color: '#047857' },
            ]}
          >
            {formatUsdCents(effectiveBalanceCents)}
          </Text>
        </View>
      </View>

      {/* Awaiting Buyer Approval Diagnostics */}
      {invoice.status !== 'paid' &&
      invoice.status !== 'refunded' &&
      invoice.status !== 'void' &&
      latestApprovalPending ? (
        <View
          style={[styles.feedbackBanner, styles.feedbackInfo]}
          testID="billing-detail-approval-pending-card"
        >
          <AlertTriangle size={16} color="#1D4ED8" />
          <View style={styles.failureTextCol}>
            <Text style={[styles.failureTitle, { color: '#1E40AF' }]}>
              Awaiting PayPal Buyer Approval ({latestApprovalPending.demoReferenceCode})
            </Text>
            <Text style={[styles.failureBody, { color: '#1D4ED8' }]}>
              {latestApprovalPending.actionableMessage ||
                'PayPal is waiting for buyer approval. Complete Sandbox checkout before capturing this payment.'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Failed Attempt Diagnostics */}
      {latestFailure?.failureReason ? (
        <View style={styles.failureCard}>
          <AlertTriangle size={16} color="#B91C1C" />
          <View style={styles.failureTextCol}>
            <Text style={styles.failureTitle}>Last Payment Attempt Declined</Text>
            <Text style={styles.failureBody}>{latestFailure.failureReason}</Text>
          </View>
        </View>
      ) : null}

      {/* Sensitive-Data Isolation Notice */}
      <View style={styles.phiGuardBox}>
        <ShieldCheck size={16} color="#047857" />
        <Text style={styles.phiGuardText}>
          Sensitive-Data Firewall: Only the invoice number (#{invoice.invoiceNumber}
          ), administrative code ({primaryServiceCode}), and USD amount are included
          in PayPal API requests.
        </Text>
      </View>
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  backToNotificationsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  backToNotificationsText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#C2410C',
  },
  browserCheckoutPanel: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 14,
    padding: 12,
    gap: 10,
    marginBottom: 12,
  },
  browserCheckoutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  browserCheckoutTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  browserCheckoutSub: {
    fontSize: 11,
    lineHeight: 16,
    color: '#1D4ED8',
    marginTop: 2,
  },
  browserCheckoutOrderBadge: {
    backgroundColor: '#DBEAFE',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  browserCheckoutOrderBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1E40AF',
  },
  browserCheckoutActionsCol: {
    gap: 8,
  },
  browserOpenPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  browserOpenPrimaryBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  browserOpenSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  browserOpenSecondaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E40AF',
  },
  inAppCardBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  inAppCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
  },
  cardProfilePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cardProfilePill: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  cardProfilePillActive: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
  },
  cardProfilePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  cardProfilePillTextActive: {
    color: '#B45309',
    fontWeight: '800',
  },
  browserPanelBottomRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  inAppCardSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#D97706',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  inAppCardSubmitBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  cancelCheckoutBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  cancelCheckoutBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  feedbackError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  feedbackSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  feedbackInfo: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  feedbackText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  feedbackErrorText: {
    color: '#991B1B',
  },
  feedbackSuccessText: {
    color: '#065F46',
  },
  feedbackInfoText: {
    color: '#1E40AF',
  },
  settlementNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  sampleSettlementBox: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  liveSettlementBox: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  sampleSettlementTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
  },
  sampleSettlementSub: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 17,
  },
  liveSettlementTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  downloadPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  downloadPdfBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E40AF',
  },
  liveSettlementSub: {
    fontSize: 12,
    color: '#047857',
    marginTop: 2,
  },
  amountHero: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    alignItems: 'center',
    marginBottom: 12,
  },
  amountHeroLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400E',
    textAlign: 'center',
  },
  amountHeroValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },
  amountHeroSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#78350F',
    marginTop: 4,
    textAlign: 'center',
  },
  providerActionsBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
    marginBottom: 12,
  },
  providerButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  providerBtnFlex: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  providerDangerBtn: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  providerDangerBtnText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '700',
  },
  providerRefundBtn: {
    flex: 1,
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  providerRefundBtnText: {
    color: '#6D28D9',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaKey: {
    fontSize: 13,
    color: '#6B7280',
  },
  metaVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    flexShrink: 1,
    textAlign: 'right',
  },
  lineItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  lineItemLeft: {
    flex: 1,
  },
  lineItemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  lineItemMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  lineItemTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 6,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  failureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 12,
  },
  failureTextCol: {
    flex: 1,
  },
  failureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991B1B',
  },
  failureBody: {
    fontSize: 12,
    color: '#B91C1C',
    marginTop: 2,
    lineHeight: 17,
  },
  phiGuardBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  phiGuardText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#065F46',
  },
});
