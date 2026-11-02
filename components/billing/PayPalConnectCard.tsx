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
} from 'lucide-react-native';
import { shadows } from '../../src/lib/shadow';
import { supabase } from '../../src/lib/supabase';
import type { BillingRoleScope } from '../../src/billing/types';
import { getPreloadedPayPalConnection } from '../../src/billing/api/billingService';

export interface PayPalConnectCardProps {
  roleScope: BillingRoleScope;
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
  onOpenSettings,
}: PayPalConnectCardProps) {
  const isDoctor = roleScope === 'doctor';
  const [loading] = useState(false);
  const [acting, setActing] = useState(false);
  const [conn, setConn] = useState<ConnectionRecord | null>(() => {
    const pre = getPreloadedPayPalConnection(roleScope);
    if (!pre || !pre.connected) return null;
    return {
      status: 'connected',
      connection_type: pre.connectionType,
      environment: pre.environment,
      paypal_payer_id: pre.paypalPayerIdMasked,
      paypal_email_masked: pre.paypalEmailMasked,
      paypal_verified: true,
      connected_at: pre.connectedAt,
    };
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [sandboxEmailInput, setSandboxEmailInput] = useState(
    isDoctor ? 'sb-merchant-jenkins@business.example.com' : 'sb-customer-rivera@personal.example.com'
  );
  const [sandboxMerchantIdInput, setSandboxMerchantIdInput] = useState(
    isDoctor ? 'PAYPAL-SB-MERCHANT-JENKINS' : 'PAYPAL-SB-PAYER-RIVERA'
  );

  const loadStatus = useCallback(async () => {
    const pre = getPreloadedPayPalConnection(roleScope);
    if (pre && pre.connected) {
      setConn({
        status: 'connected',
        connection_type: pre.connectionType,
        environment: pre.environment,
        paypal_payer_id: pre.paypalPayerIdMasked,
        paypal_email_masked: pre.paypalEmailMasked,
        paypal_verified: true,
        connected_at: pre.connectedAt,
      });
      return;
    }
    if (process.env.NODE_ENV === 'test') return;
    try {
      let userId: string | undefined;
      if (typeof supabase.auth.getSession === 'function') {
        const { data: sessRes } = await supabase.auth.getSession();
        userId = sessRes?.session?.user?.id;
      }
      if (!userId) return;

      const { data, error } = await supabase
        .from('billing_account_connections')
        .select(
          'status, connection_type, environment, paypal_payer_id, paypal_email_masked, paypal_verified, connected_at'
        )
        .eq('user_id', userId)
        .eq('connection_type', roleScope === 'doctor' ? 'merchant' : 'payer')
        .maybeSingle();

      if (!error && data) {
        setConn(data as ConnectionRecord);
      }
    } catch {
      // Non-fatal in unit tests / offline mode
    }
  }, [roleScope]);

  useEffect(() => {
    const pre = getPreloadedPayPalConnection(roleScope);
    if (pre?.connected) {
      setConn({
        status: 'connected',
        connection_type: pre.connectionType,
        environment: pre.environment,
        paypal_payer_id: pre.paypalPayerIdMasked,
        paypal_email_masked: pre.paypalEmailMasked,
        paypal_verified: true,
        connected_at: pre.connectedAt,
      });
    } else {
      setConn(null);
    }
  }, [roleScope]);

  const handleConnect = async () => {
    setErrorMsg(null);
    setActing(true);
    try {
      const { data, error } = await supabase.functions.invoke('paypal-billing', {
        body: {
          action: 'connect-account',
          role_scope: roleScope,
          sandbox_email: sandboxEmailInput.trim(),
          merchant_id: sandboxMerchantIdInput.trim(),
        },
      });
      if (error || data?.error) {
        throw new Error(data?.message || error?.message || 'Unable to connect PayPal Sandbox');
      }
      if (data?.connection) {
        setConn(data.connection as ConnectionRecord);
      } else {
        await loadStatus();
      }
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
          role_scope: roleScope,
        },
      });
      if (error || data?.error) {
        throw new Error(data?.message || error?.message || 'Unable to disconnect');
      }
      if (data?.connection) {
        setConn(data.connection as ConnectionRecord);
      } else {
        await loadStatus();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to disconnect.');
    } finally {
      setActing(false);
    }
  };

  const isConnected =
    String(conn?.status || '').toUpperCase() === 'CONNECTED';

  return (
    <View style={styles.card} testID="paypal-connect-card">
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <View style={[styles.iconBadge, isConnected && styles.iconBadgeConnected]}>
            <CreditCard size={20} color={isConnected ? '#047857' : '#003087'} />
          </View>
          <View style={styles.titleCol}>
            <Text style={styles.title}>
              {isDoctor ? 'PayPal Merchant Sandbox' : 'PayPal Customer Sandbox'}
            </Text>
            <Text style={styles.subtitle}>
              {isDoctor
                ? 'Provider Sandbox Merchant Connection & Settlement'
                : 'Customer Sandbox Checkout & Receipt Verification'}
            </Text>
          </View>
        </View>

        <View
          style={[styles.statusBadge, isConnected && styles.statusBadgeConnected]}
          testID="paypal-connect-status-badge"
        >
          <Text
            style={[styles.statusBadgeText, isConnected && styles.statusBadgeTextConnected]}
          >
            {isConnected ? 'SANDBOX CONNECTED' : 'SANDBOX READY'}
          </Text>
        </View>
      </View>

      <Text style={styles.description}>
        {isConnected
          ? `Connected to PayPal Sandbox (${conn?.paypal_email_masked || 'Verified Sandbox Account'} • ID: ${conn?.paypal_payer_id || 'SANDBOX'}). All invoice orders, captures, and refunds are logged to the immutable ledger.`
          : isDoctor
            ? 'Connect your PayPal Developer Sandbox merchant profile to issue invoices, capture customer payments, and process full or partial refunds.'
            : 'Connect your PayPal Developer Sandbox buyer account or launch PayPal Sandbox checkout directly from any open statement.'}
      </Text>

      <View style={styles.guardrailStrip}>
        <ShieldCheck size={15} color="#047857" />
        <Text style={styles.guardrailText}>
          Sensitive-Data Firewall Active: Only invoice numbers, service codes & USD totals reach PayPal
        </Text>
      </View>

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
                <Text style={styles.disconnectButtonText}>Disconnect Sandbox</Text>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={styles.connectButton}
            onPress={() => setShowConnectForm((prev) => !prev)}
            disabled={acting || loading}
            accessibilityRole="button"
            accessibilityLabel={
              isDoctor ? 'Connect PayPal Sandbox Merchant' : 'Link PayPal Sandbox Buyer'
            }
            testID="paypal-connect-cta-btn"
          >
            <Link2 size={15} color="#FFFFFF" />
            <Text style={styles.connectButtonText}>
              {isDoctor ? 'Connect PayPal Sandbox' : 'Link PayPal Sandbox'}
            </Text>
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
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
