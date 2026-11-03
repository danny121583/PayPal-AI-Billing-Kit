import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import {
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  Link2,
  Unlink,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
import { shadows } from '../../src/lib/shadow';
import { supabase } from '../../src/lib/supabase';
import type { BillingRoleScope } from '../../src/billing/types';
import {
  DEMO_USER_IDS,
  getPreloadedPayPalConnection,
  setPreloadedPayPalConnection,
  type PayPalAccountConnectionSummary,
} from '../../src/billing/api/billingService';
import { useAuth } from '../../src/contexts/StandaloneAuthContext';

export interface PayPalConnectCardProps {
  roleScope: BillingRoleScope;
  userId?: string;
  connection?: PayPalAccountConnectionSummary | null;
  defaultExpanded?: boolean;
  onConnectionChanged?: (next: PayPalAccountConnectionSummary) => void;
  onOpenSettings?: () => void;
}

interface ConnectionRecord {
  status: string;
  connection_type?: string;
  environment?: string;
  paypal_payer_id: string | null;
  paypal_email_masked: string | null;
  paypal_verified?: boolean | null;
  connected_at: string | null;
}

export default function PayPalConnectCard({
  roleScope,
  userId: propUserId,
  connection: propConnection,
  defaultExpanded = false,
  onConnectionChanged,
  onOpenSettings,
}: PayPalConnectCardProps) {
  const { user } = useAuth();
  const isDoctor = roleScope === 'doctor';
  const effectiveUserId =
    propUserId ||
    user?.id ||
    (isDoctor ? DEMO_USER_IDS.sarah_jenkins : DEMO_USER_IDS.alex_rivera);

  const [loading] = useState(false);
  const [acting, setActing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(Boolean(defaultExpanded));
  const [conn, setConn] = useState<ConnectionRecord | null>(() => {
    const pre =
      propConnection ?? getPreloadedPayPalConnection(roleScope, effectiveUserId);
    if (!pre || !pre.connected) return null;
    const isVerified =
      pre.oauthVerified !== undefined
        ? Boolean(pre.oauthVerified)
        : Boolean(pre.sandboxCredentialsConfigured);
    return {
      status: 'connected',
      connection_type: pre.connectionType,
      environment: pre.environment,
      paypal_payer_id: pre.paypalPayerIdMasked,
      paypal_email_masked: pre.paypalEmailMasked,
      paypal_verified: isVerified,
      connected_at: pre.connectedAt,
    };
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [sandboxEmailInput, setSandboxEmailInput] = useState(
    isDoctor
      ? 'sb-merchant-jenkins@business.example.com'
      : effectiveUserId === DEMO_USER_IDS.jordan_taylor
        ? 'sb-customer-taylor@personal.example.com'
        : 'sb-customer-rivera@personal.example.com'
  );
  const [sandboxMerchantIdInput, setSandboxMerchantIdInput] = useState(
    isDoctor
      ? 'PAYPAL-SB-MERCHANT-JENKINS'
      : effectiveUserId === DEMO_USER_IDS.jordan_taylor
        ? 'SB-PAYER-JORDAN-1003'
        : 'SB-PAYER-ALEX-1002'
  );

  const loadStatus = useCallback(async () => {
    const pre = getPreloadedPayPalConnection(roleScope, effectiveUserId);
    if (pre && pre.connected) {
      const isVerified =
        pre.oauthVerified !== undefined
          ? Boolean(pre.oauthVerified)
          : Boolean(pre.sandboxCredentialsConfigured);
      setConn({
        status: 'connected',
        connection_type: pre.connectionType,
        environment: pre.environment,
        paypal_payer_id: pre.paypalPayerIdMasked,
        paypal_email_masked: pre.paypalEmailMasked,
        paypal_verified: isVerified,
        connected_at: pre.connectedAt,
      });
      return;
    }
    if (process.env.NODE_ENV === 'test') return;
    try {
      const { data, error } = await supabase
        .from('billing_account_connections')
        .select(
          'status, connection_status, connection_type, environment, paypal_environment, paypal_merchant_id, paypal_payer_id, paypal_email_masked, paypal_verified, connected_at'
        )
        .eq('user_id', effectiveUserId)
        .maybeSingle();

      if (!error && data) {
        const raw = data as any;
        const isConn =
          String(raw.status || raw.connection_status || '').toLowerCase() === 'connected';
        const isOAuth = Boolean(raw.paypal_verified);
        const payerOrMerchantId = raw.paypal_merchant_id || raw.paypal_payer_id || null;
        const record: ConnectionRecord = {
          status: isConn ? 'connected' : 'revoked',
          connection_type: roleScope === 'doctor' ? 'merchant' : 'payer',
          environment: (raw.environment || raw.paypal_environment) === 'live' ? 'live' : 'sandbox',
          paypal_payer_id: isConn ? payerOrMerchantId : null,
          paypal_email_masked: isConn ? raw.paypal_email_masked : null,
          paypal_verified: isConn && isOAuth,
          connected_at: isConn ? raw.connected_at : null,
        };
        setConn(record);
        setPreloadedPayPalConnection(effectiveUserId, {
          connected: isConn,
          environment: (raw.environment || raw.paypal_environment) === 'live' ? 'live' : 'sandbox',
          connectionType: roleScope === 'doctor' ? 'merchant' : 'payer',
          paypalEmailMasked: isConn ? raw.paypal_email_masked : null,
          paypalPayerIdMasked: isConn ? payerOrMerchantId : null,
          connectedAt: isConn ? raw.connected_at : null,
          sandboxCredentialsConfigured: isOAuth,
          oauthVerified: isOAuth,
        });
      }
    } catch {
      // Non-fatal in unit tests / offline mode
    }
  }, [roleScope, effectiveUserId]);

  useEffect(() => {
    const pre =
      propConnection ?? getPreloadedPayPalConnection(roleScope, effectiveUserId);
    if (pre?.connected) {
      const isVerified =
        pre.oauthVerified !== undefined
          ? Boolean(pre.oauthVerified)
          : Boolean(pre.sandboxCredentialsConfigured);
      setConn({
        status: 'connected',
        connection_type: pre.connectionType,
        environment: pre.environment,
        paypal_payer_id: pre.paypalPayerIdMasked,
        paypal_email_masked: pre.paypalEmailMasked,
        paypal_verified: isVerified,
        connected_at: pre.connectedAt,
      });
      setShowConnectForm(false);
    } else {
      setConn(null);
    }
    setSandboxEmailInput(
      isDoctor
        ? 'sb-merchant-jenkins@business.example.com'
        : effectiveUserId === DEMO_USER_IDS.jordan_taylor
          ? 'sb-customer-taylor@personal.example.com'
          : 'sb-customer-rivera@personal.example.com'
    );
    setSandboxMerchantIdInput(
      isDoctor
        ? 'PAYPAL-SB-MERCHANT-JENKINS'
        : effectiveUserId === DEMO_USER_IDS.jordan_taylor
          ? 'SB-PAYER-JORDAN-1003'
          : 'SB-PAYER-ALEX-1002'
    );
  }, [roleScope, effectiveUserId, propConnection, isDoctor]);

  const handleConnect = async () => {
    setErrorMsg(null);
    setActing(true);
    try {
      const { data, error } = await supabase.functions.invoke('paypal-billing', {
        body: {
          action: 'connect-account',
          roleScope,
          role_scope: roleScope,
          userId: effectiveUserId,
          user_id: effectiveUserId,
          merchantEmail: sandboxEmailInput.trim(),
          merchant_email: sandboxEmailInput.trim(),
          payerEmail: sandboxEmailInput.trim(),
          payer_email: sandboxEmailInput.trim(),
          merchantId: sandboxMerchantIdInput.trim(),
          merchant_id: sandboxMerchantIdInput.trim(),
        },
      });
      if (error || data?.error || data?.ok === false) {
        throw new Error(
          data?.message || error?.message || 'Unable to connect PayPal Sandbox'
        );
      }
      const nextConn: ConnectionRecord = data?.connection
        ? (data.connection as ConnectionRecord)
        : {
            status: 'connected',
            connection_type: isDoctor ? 'merchant' : 'payer',
            environment: 'sandbox',
            paypal_payer_id: sandboxMerchantIdInput.trim() || 'PAYPAL-SANDBOX',
            paypal_email_masked: sandboxEmailInput.trim() || 'sb-***@sandbox.paypal.com',
            paypal_verified: Boolean(data?.oauthVerified),
            connected_at: new Date().toISOString(),
          };
      const isVerified = Boolean(data?.oauthVerified ?? nextConn.paypal_verified);
      nextConn.paypal_verified = isVerified;
      setConn(nextConn);
      const summary: PayPalAccountConnectionSummary = {
        connected: true,
        environment: nextConn.environment === 'live' ? 'live' : 'sandbox',
        connectionType: isDoctor ? 'merchant' : 'payer',
        paypalEmailMasked: nextConn.paypal_email_masked,
        paypalPayerIdMasked: nextConn.paypal_payer_id,
        connectedAt: nextConn.connected_at || new Date().toISOString(),
        sandboxCredentialsConfigured: isVerified,
        oauthVerified: isVerified,
      };
      setPreloadedPayPalConnection(effectiveUserId, summary);
      onConnectionChanged?.(summary);
      setShowConnectForm(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'PayPal Sandbox connection failed.');
    } finally {
      setActing(false);
    }
  };

  const handleDisconnect = async () => {
    setErrorMsg(null);
    setActing(true);
    try {
      const { data, error } = await supabase.functions.invoke('paypal-billing', {
        body: {
          action: 'disconnect-account',
          roleScope,
          role_scope: roleScope,
          userId: effectiveUserId,
          user_id: effectiveUserId,
        },
      });
      if (error || data?.error || data?.ok === false) {
        throw new Error(data?.message || error?.message || 'Unable to disconnect');
      }
      setConn({
        status: 'revoked',
        connection_type: isDoctor ? 'merchant' : 'payer',
        environment: 'sandbox',
        paypal_payer_id: null,
        paypal_email_masked: null,
        paypal_verified: false,
        connected_at: null,
      });
      const disconnectedSummary: PayPalAccountConnectionSummary = {
        connected: false,
        environment: 'sandbox',
        connectionType: isDoctor ? 'merchant' : 'payer',
        paypalEmailMasked: null,
        paypalPayerIdMasked: null,
        connectedAt: null,
        sandboxCredentialsConfigured: false,
      };
      setPreloadedPayPalConnection(effectiveUserId, disconnectedSummary);
      onConnectionChanged?.(disconnectedSummary);
      setShowConnectForm(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to disconnect.');
    } finally {
      setActing(false);
    }
  };

  const isConnected =
    String(conn?.status || '').toUpperCase() === 'CONNECTED';
  const isOAuthAuthenticated = isConnected && Boolean(conn?.paypal_verified);
  const isDemoProfileOnly = isConnected && !conn?.paypal_verified;
  const badgeLabel = !isConnected
    ? 'DISCONNECTED'
    : isOAuthAuthenticated
      ? 'SANDBOX AUTHENTICATED'
      : 'DEMO PROFILE AVAILABLE';

  // When disconnected or explicitly expanded, show full details and action buttons.
  const showFullDetails = !isConnected || isExpanded;

  return (
    <View
      style={[styles.card, !showFullDetails && styles.cardCollapsed]}
      testID="paypal-connect-card"
    >
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <View
            style={[
              styles.iconBadge,
              !showFullDetails && styles.iconBadgeCompact,
              isOAuthAuthenticated && styles.iconBadgeConnected,
            ]}
          >
            <CreditCard
              size={showFullDetails ? 20 : 18}
              color={isOAuthAuthenticated ? '#047857' : '#003087'}
            />
          </View>
          <View style={styles.titleCol}>
            <Text style={styles.title}>
              {isDoctor ? 'PayPal Merchant Sandbox' : 'PayPal Customer Sandbox'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {!showFullDetails && isConnected
                ? `${conn?.paypal_email_masked || 'Verified Sandbox Account'} • Sensitive-Data Firewall Active`
                : isDoctor
                  ? 'Provider Sandbox Merchant Connection & Settlement'
                  : 'Customer Sandbox Checkout & Receipt Verification'}
            </Text>
          </View>
        </View>

        <View style={styles.topRightRow}>
          <View
            style={[styles.statusBadge, isOAuthAuthenticated && styles.statusBadgeConnected]}
            testID="paypal-connect-status-badge"
          >
            <Text
              style={[styles.statusBadgeText, isOAuthAuthenticated && styles.statusBadgeTextConnected]}
            >
              {badgeLabel}
            </Text>
          </View>

          {isConnected ? (
            <Pressable
              style={styles.toggleDetailsBtn}
              onPress={() => setIsExpanded((prev) => !prev)}
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
              accessibilityLabel={
                isExpanded
                  ? 'Hide PayPal Sandbox connection details'
                  : 'View PayPal Sandbox connection details'
              }
              testID="paypal-connect-toggle-details-btn"
            >
              <Text style={styles.toggleDetailsBtnText}>
                {isExpanded ? 'Hide Details' : 'View Details'}
              </Text>
              {isExpanded ? (
                <ChevronUp size={14} color="#334155" />
              ) : (
                <ChevronDown size={14} color="#334155" />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      {showFullDetails ? (
        <>
          <Text style={styles.description}>
            {isOAuthAuthenticated
              ? `Authenticated with PayPal Sandbox OAuth 2.0 (${conn?.paypal_email_masked || 'Verified Sandbox Account'} • ID: ${conn?.paypal_payer_id || 'SANDBOX'}). Account Linked — all invoice orders, captures, and refunds are logged to the immutable ledger.`
              : isDemoProfileOnly
                ? `Demo Profile Available (${conn?.paypal_email_masked || 'Demo Account'} • ID: ${conn?.paypal_payer_id || 'DEMO'}). Sandbox Configuration Missing — fictional profile available for demonstration, not OAuth authenticated.`
                : isDoctor
                  ? 'Connect your PayPal Developer Sandbox merchant profile to issue invoices, capture customer payments, and process full or partial refunds.'
                  : 'Connect your PayPal Developer Sandbox buyer account or launch PayPal Sandbox checkout directly from any open statement.'}
          </Text>

          {isConnected ? (
            <View
              style={styles.connectedAccountBox}
              testID="paypal-connected-account-summary"
            >
              <CheckCircle2 size={15} color={isOAuthAuthenticated ? '#047857' : '#B45309'} />
              <Text style={styles.connectedAccountText}>
                {isOAuthAuthenticated ? 'Account Linked' : 'Demo Profile Available'}:{' '}
                {conn?.paypal_email_masked || 'sb-***@sandbox.paypal.com'} •{' '}
                {isDoctor ? 'Merchant ID' : 'Payer ID'}:{' '}
                {conn?.paypal_payer_id || 'PAYPAL-SANDBOX'} •{' '}
                {isOAuthAuthenticated
                  ? 'PayPal OAuth 2.0 Authenticated'
                  : 'Sandbox Configuration Missing'}
              </Text>
            </View>
          ) : null}

          <View style={styles.guardrailStrip}>
            <ShieldCheck size={15} color="#047857" />
            <Text style={styles.guardrailText}>
              Sensitive-Data Firewall Active: Only invoice numbers, service codes & USD totals reach PayPal
            </Text>
          </View>
        </>
      ) : null}

      {errorMsg ? (
        <View style={styles.errorBanner} testID="paypal-connect-error">
          <Text style={styles.errorBannerText}>{errorMsg}</Text>
        </View>
      ) : null}

      {showConnectForm && !isConnected ? (
        <View style={styles.connectForm} testID="paypal-connect-form">
          <Text style={styles.formLabel}>PayPal Sandbox Account Email</Text>
          <TextInput
            style={styles.input}
            value={sandboxEmailInput}
            onChangeText={setSandboxEmailInput}
            placeholder="sb-merchant@business.example.com"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            keyboardType="email-address"
            testID="paypal-connect-email-input"
          />
          <Text style={styles.formLabel}>
            {isDoctor ? 'PayPal Sandbox Merchant ID' : 'PayPal Sandbox Payer ID'}
          </Text>
          <TextInput
            style={styles.input}
            value={sandboxMerchantIdInput}
            onChangeText={setSandboxMerchantIdInput}
            placeholder="PAYPAL-SB-MERCHANT-01"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="characters"
            testID="paypal-connect-merchant-input"
          />
          <View style={styles.formButtonsRow}>
            <Pressable
              style={styles.cancelFormBtn}
              onPress={() => setShowConnectForm(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancel PayPal Sandbox connection"
              testID="paypal-connect-cancel-btn"
            >
              <Text style={styles.cancelFormBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.confirmFormBtn}
              onPress={handleConnect}
              disabled={acting}
              accessibilityRole="button"
              accessibilityLabel="Confirm PayPal Sandbox connection"
              testID="paypal-connect-confirm-btn"
            >
              {acting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <CheckCircle2 size={15} color="#FFFFFF" />
                  <Text style={styles.confirmFormBtnText}>Link Sandbox Account</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {showFullDetails ? (
        <View style={styles.actionRow}>
          {isConnected ? (
            <Pressable
              style={styles.disconnectButton}
              onPress={handleDisconnect}
              disabled={acting}
              accessibilityRole="button"
              accessibilityLabel="Disconnect PayPal Sandbox"
              testID="paypal-disconnect-cta-btn"
            >
              {acting ? (
                <ActivityIndicator size="small" color="#B91C1C" />
              ) : (
                <>
                  <Unlink size={14} color="#B91C1C" />
                  <Text style={styles.disconnectButtonText}>
                    Disconnect PayPal Sandbox
                  </Text>
                </>
              )}
            </Pressable>
          ) : (
            <Pressable
              style={styles.connectButton}
              onPress={() => setShowConnectForm((prev) => !prev)}
              disabled={acting || loading}
              accessibilityRole="button"
              accessibilityLabel="Connect PayPal Sandbox"
              testID="paypal-connect-cta-btn"
            >
              <Link2 size={15} color="#FFFFFF" />
              <Text style={styles.connectButtonText}>Connect PayPal Sandbox</Text>
            </Pressable>
          )}

          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              void loadStatus();
              if (onOpenSettings) onOpenSettings();
            }}
            accessibilityRole="button"
            accessibilityLabel="Open AI Guardrails and Settings"
            testID="paypal-connect-settings-btn"
          >
            <RefreshCw size={13} color="#374151" />
            <Text style={styles.secondaryButtonText}>Guardrails & Audit</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    ...shadows.sm,
  },
  cardCollapsed: {
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  topRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  toggleDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  toggleDetailsBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 190,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  iconBadgeCompact: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  iconBadgeConnected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  titleCol: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  statusBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusBadgeConnected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#6EE7B7',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.4,
  },
  statusBadgeTextConnected: {
    color: '#047857',
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    color: '#4B5563',
    marginTop: 12,
  },
  connectedAccountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  connectedAccountText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  guardrailStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  guardrailText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#065F46',
  },
  errorBanner: {
    marginTop: 10,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBannerText: {
    fontSize: 12,
    color: '#991B1B',
    fontWeight: '600',
  },
  connectForm: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#374151',
    marginTop: 4,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111827',
  },
  formButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  cancelFormBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  cancelFormBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  confirmFormBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#003087',
  },
  confirmFormBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  connectButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#003087',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  disconnectButton: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectButtonText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
});
