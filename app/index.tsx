import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search,
  Settings,
  Plus,
  Bell,
  ShieldAlert,
  UserCheck,
  RotateCcw,
  Cpu,
} from 'lucide-react-native';
import { supabase } from '../src/lib/supabase';
import {
  DEMO_ACCOUNT_PRESETS,
  useAuth,
  type DemoAccountKey,
} from '../src/contexts/StandaloneAuthContext';
import DoctorBillingView from '../components/billing/DoctorBillingView';
import PatientBillingView from '../components/billing/PatientBillingView';
import BillingInvoiceDetailModal, {
  type PayPalBrowserCheckoutReturnState,
} from '../components/billing/BillingInvoiceDetailModal';
import BillingCreateInvoiceModal from '../components/billing/BillingCreateInvoiceModal';
import BillingAIAssistantModal from '../components/billing/BillingAIAssistantModal';
import BillingAISettingsModal from '../components/billing/BillingAISettingsModal';
import BillingNotificationsModal from '../components/billing/BillingNotificationsModal';
import BillingMaaSMcpModal from '../components/billing/BillingMaaSMcpModal';
import { BillingGlobalSearchModal } from '../components/billing/BillingGlobalSearchModal';
import BillingBrandIcon from '../components/billing/BillingBrandIcon';
import type {
  BillingNotificationItem,
  BillingRoleScope,
  SyntheticBillingInvoice,
} from '../src/billing/types';
import {
  getSyntheticInvoicesForRole,
  resolveBillingDeepLinkInvoice,
} from '../src/billing/data/syntheticBillingFixtures';
import {
  DEFAULT_BILLABLE_PATIENTS,
  DEFAULT_SERVICE_CATALOG,
  fetchBillingDashboardData,
  getDefaultBillingAISettings,
  getOrCreateDemoSessionId,
  getOrCreateDemoSessionIdSync,
  getPreloadedBillingSnapshot,
  markBillingNotificationRead,
  resetBillingDemoSession,
  resolveNotificationLinkedInvoice,
  type BillablePatientOption,
  type BillingAISettingsRecord,
  type BillingAuditEventItem,
  type BillingServiceCatalogItem,
  type PayPalAccountConnectionSummary,
} from '../src/billing/api/billingService';
import { clearBillingAIClientCacheForTests } from '../src/billing/api/billingAIClient';

export default function BillingScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth > 0 && windowWidth < 768;
  const {
    activePreset,
    isSwitchingAccount,
    switchDemoAccount,
  } = useAuth();

  const availableAccounts = useMemo(
    () => Object.values(DEMO_ACCOUNT_PRESETS),
    []
  );

  const params = useLocalSearchParams<{
    invoiceId?: string | string[];
    invoiceNumber?: string | string[];
    notificationId?: string | string[];
    modal?: string | string[];
    account?: string | string[];
    paypal?: string | string[];
    token?: string | string[];
    PayerID?: string | string[];
  }>();

  const rawInvoiceId = Array.isArray(params.invoiceId)
    ? params.invoiceId[0]
    : params.invoiceId;
  const rawInvoiceNumber = Array.isArray(params.invoiceNumber)
    ? params.invoiceNumber[0]
    : params.invoiceNumber;
  const rawNotificationId = Array.isArray(params.notificationId)
    ? params.notificationId[0]
    : params.notificationId;
  const rawModal = Array.isArray(params.modal)
    ? params.modal[0]
    : params.modal;
  const rawAccount = Array.isArray(params.account)
    ? params.account[0]
    : params.account;
  const rawPaypalState = Array.isArray(params.paypal)
    ? params.paypal[0]
    : params.paypal;
  const rawPaypalToken = Array.isArray(params.token)
    ? params.token[0]
    : params.token;
  const rawPaypalPayerId = Array.isArray(params.PayerID)
    ? params.PayerID[0]
    : params.PayerID;

  const roleScope: BillingRoleScope = activePreset.roleScope;
  const isDoctorRole = roleScope === 'doctor';

  const initialSnap = useMemo(
    () => getPreloadedBillingSnapshot(roleScope, activePreset.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] =
    useState<SyntheticBillingInvoice | null>(null);
  const [focusedAiInvoice, setFocusedAiInvoice] =
    useState<SyntheticBillingInvoice | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCreateInvoiceModal, setShowCreateInvoiceModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showMaasModal, setShowMaasModal] = useState(false);
  const [demoSessionId, setDemoSessionId] = useState(() =>
    getOrCreateDemoSessionIdSync()
  );
  const [isResettingDemo, setIsResettingDemo] = useState(false);
  const [resetBannerText, setResetBannerText] = useState<string | null>(null);
  const [openedFromNotifications, setOpenedFromNotifications] = useState(false);
  const [notificationErrorText, setNotificationErrorText] = useState<
    string | null
  >(null);
  const [checkoutReturnState, setCheckoutReturnState] =
    useState<PayPalBrowserCheckoutReturnState | null>(null);
  const [paypalReturnBannerText, setPaypalReturnBannerText] = useState<
    string | null
  >(null);

  const [liveInvoices, setLiveInvoices] = useState<
    SyntheticBillingInvoice[] | null
  >(() => initialSnap.invoices);
  const [hasLoadedLiveOnce, setHasLoadedLiveOnce] = useState(
    process.env.NODE_ENV === 'test'
  );
  const [catalog, setCatalog] = useState<BillingServiceCatalogItem[]>(
    () => initialSnap.catalog || DEFAULT_SERVICE_CATALOG
  );
  const [billablePatients, setBillablePatients] = useState<
    BillablePatientOption[]
  >(() => initialSnap.billablePatients || DEFAULT_BILLABLE_PATIENTS);
  const [aiSettings, setAiSettings] = useState<BillingAISettingsRecord>(() =>
    initialSnap.settings || getDefaultBillingAISettings(activePreset.id)
  );
  const [connection, setConnection] =
    useState<PayPalAccountConnectionSummary | null>(() => initialSnap.connection);
  const [auditEvents, setAuditEvents] = useState<BillingAuditEventItem[]>(
    () => initialSnap.auditEvents
  );
  const [notifications, setNotifications] = useState<BillingNotificationItem[]>(
    () => initialSnap.notifications
  );
  const [refreshing, setRefreshing] = useState(false);

  const handleSelectDemoAccount = useCallback(
    (key: DemoAccountKey) => {
      if (key === activePreset.key) return;
      const targetPreset = DEMO_ACCOUNT_PRESETS[key];
      if (!targetPreset) return;
      // Synchronously apply preloaded persona state before render to prevent any flicker
      const snap = getPreloadedBillingSnapshot(
        targetPreset.roleScope,
        targetPreset.id
      );
      setSelectedInvoice(null);
      setFocusedAiInvoice(null);
      setResetBannerText(null);
      setNotificationErrorText(null);
      setOpenedFromNotifications(false);
      setCheckoutReturnState(null);
      setPaypalReturnBannerText(null);
      setSearchQuery('');
      setLiveInvoices(snap.invoices);
      setCatalog(snap.catalog);
      setBillablePatients(snap.billablePatients);
      setAiSettings(snap.settings);
      setConnection(snap.connection);
      setAuditEvents(snap.auditEvents);
      setNotifications(snap.notifications);
      void switchDemoAccount(key);
    },
    [activePreset.key, switchDemoAccount]
  );

  useEffect(() => {
    if (
      (rawAccount === 'sarah_jenkins' ||
        rawAccount === 'alex_rivera' ||
        rawAccount === 'jordan_taylor') &&
      rawAccount !== activePreset.key
    ) {
      handleSelectDemoAccount(rawAccount as DemoAccountKey);
    }
  }, [activePreset.key, handleSelectDemoAccount, rawAccount]);

  const refreshBillingData = useCallback(
    async (forceRefresh = true) => {
      try {
        const sid = await getOrCreateDemoSessionId();
        setDemoSessionId(sid);
        const dash = await fetchBillingDashboardData(
          roleScope,
          activePreset.id,
          { forceRefresh }
        );
        setLiveInvoices(dash.invoices);
        setCatalog(dash.catalog);
        setBillablePatients(dash.billablePatients);
        setAiSettings(dash.settings);
        setConnection(dash.connection);
        setAuditEvents(dash.auditEvents);
        setNotifications(dash.notifications);
      } catch (err) {
        console.error('refreshBillingData error:', err);
      } finally {
        setHasLoadedLiveOnce(true);
      }
    },
    [activePreset.id, roleScope]
  );

  const handleResetDemoSession = useCallback(async () => {
    if (isResettingDemo) return;
    setIsResettingDemo(true);
    setResetBannerText(null);
    try {
      await resetBillingDemoSession();
      clearBillingAIClientCacheForTests();
      setSelectedInvoice(null);
      setFocusedAiInvoice(null);
      await refreshBillingData(true);
      setResetBannerText(
        'Demo session reset to the 6 canonical seed statements (#PPB-INV-2026-1001 through #PPB-INV-2026-1006).'
      );
    } catch (err: any) {
      setResetBannerText(
        err?.message || 'Could not reset demo session.'
      );
    } finally {
      setIsResettingDemo(false);
    }
  }, [isResettingDemo, refreshBillingData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshBillingData(true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshBillingData]);

  // Initial silent preload of all 3 demo personas on mount
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    void refreshBillingData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronize persona slice from memory cache if activePreset changes externally
  useEffect(() => {
    const snap = getPreloadedBillingSnapshot(roleScope, activePreset.id);
    setLiveInvoices(snap.invoices);
    setCatalog(snap.catalog);
    setBillablePatients(snap.billablePatients);
    setAiSettings(snap.settings);
    setConnection(snap.connection);
    setAuditEvents(snap.auditEvents);
    setNotifications(snap.notifications);
  }, [activePreset.id, roleScope]);

  useEffect(() => {
    if (!selectedInvoice || !liveInvoices) return;
    const updated = liveInvoices.find((inv) => inv.id === selectedInvoice.id);
    if (updated) {
      setSelectedInvoice(updated);
    }
  }, [liveInvoices, selectedInvoice]);

  useEffect(() => {
    const sbAny = supabase as any;
    if (typeof sbAny?.channel !== 'function') return;

    let channel: any = null;
    try {
      channel = sbAny
        .channel(`billing-kit-live-session-${demoSessionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'billing_invoices' },
          () => void refreshBillingData(true)
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'billing_transactions' },
          () => void refreshBillingData(true)
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'billing_payment_attempts' },
          () => void refreshBillingData(true)
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'billing_notifications' },
          () => void refreshBillingData(true)
        )
        .subscribe();
    } catch {
      // Ignore realtime errors in unit tests
    }

    return () => {
      try {
        if (channel) sbAny.removeChannel(channel);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [demoSessionId, refreshBillingData]);

  const roleInvoices = useMemo(() => {
    const source =
      liveInvoices && liveInvoices.length > 0
        ? liveInvoices
        : getSyntheticInvoicesForRole(roleScope);
    if (roleScope === 'patient') {
      return source.filter(
        (inv) =>
          inv.patientDisplayName.toLowerCase() ===
          activePreset.fullName.toLowerCase()
      );
    }
    return source;
  }, [activePreset.fullName, liveInvoices, roleScope]);

  const deepLinkResolution = useMemo(
    () =>
      resolveBillingDeepLinkInvoice({
        isAuthenticated: true,
        role: roleScope,
        invoiceId: rawInvoiceId,
        notificationId: rawNotificationId,
        additionalInvoices: liveInvoices ?? undefined,
      }),
    [liveInvoices, rawInvoiceId, rawNotificationId, roleScope]
  );

  useEffect(() => {
    if (deepLinkResolution.status === 'resolved') {
      setSelectedInvoice(deepLinkResolution.invoice);
    } else if (
      deepLinkResolution.status === 'not_found' ||
      deepLinkResolution.status === 'unauthorized'
    ) {
      setSelectedInvoice(null);
    }
  }, [deepLinkResolution]);

  useEffect(() => {
    if (!rawModal) {
      setShowSettingsModal(false);
      setShowAiModal(false);
      setShowCreateInvoiceModal(false);
      setShowNotificationsModal(false);
      setShowMaasModal(false);
      return;
    }
    setShowSettingsModal(rawModal === 'settings');
    setShowAiModal(rawModal === 'ai');
    setShowCreateInvoiceModal(rawModal === 'create');
    setShowNotificationsModal(rawModal === 'notifications');
    setShowMaasModal(rawModal === 'maas' || rawModal === 'mcp');
  }, [rawModal]);

  useEffect(() => {
    if (rawPaypalState !== 'return' && rawPaypalState !== 'cancel') {
      return;
    }
    const mode = rawPaypalState as 'return' | 'cancel';
    const orderId = rawPaypalToken ? String(rawPaypalToken).trim() : null;
    const payerId = rawPaypalPayerId ? String(rawPaypalPayerId).trim() : null;
    setCheckoutReturnState({ mode, orderId, payerId });

    const candidateRef = String(rawInvoiceId || rawInvoiceNumber || '').trim();
    let targetInv = candidateRef
      ? roleInvoices.find(
          (inv) =>
            inv.id === candidateRef ||
            inv.invoiceNumber.toLowerCase() === candidateRef.toLowerCase()
        )
      : null;

    if (!targetInv && orderId) {
      targetInv =
        roleInvoices.find((inv) =>
          inv.paymentAttempts.some(
            (a) =>
              a.demoReferenceCode === orderId ||
              a.actionableMessage?.includes(orderId)
          )
        ) || null;
    }

    if (!targetInv) {
      targetInv =
        roleInvoices.find(
          (inv) =>
            inv.status === 'pending' ||
            inv.status === 'sent' ||
            inv.status === 'overdue' ||
            inv.status === 'failed'
        ) ||
        roleInvoices[0] ||
        null;
    }

    if (targetInv) {
      setSelectedInvoice(targetInv);
    }

    if (mode === 'return') {
      setPaypalReturnBannerText(
        `Returned from PayPal Sandbox Browser Checkout${
          orderId ? ` (Order ${orderId})` : ''
        }${
          targetInv ? ` for Statement #${targetInv.invoiceNumber}` : ''
        }. Review and tap "Capture Approved Order" to complete settlement.`
      );
    } else {
      setPaypalReturnBannerText(
        `PayPal Sandbox Browser Checkout was canceled${
          orderId ? ` (Order ${orderId})` : ''
        }${
          targetInv ? ` for Statement #${targetInv.invoiceNumber}` : ''
        }. No funds were charged.`
      );
    }
  }, [
    rawInvoiceId,
    rawInvoiceNumber,
    rawPaypalPayerId,
    rawPaypalState,
    rawPaypalToken,
    roleInvoices,
  ]);

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const handleOpenBillingAI = (
    invoice: SyntheticBillingInvoice | null = null
  ) => {
    setFocusedAiInvoice(invoice);
    setShowAiModal(true);
  };

  const handleMarkAllNotificationsRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.isRead).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await Promise.all(unreadIds.map((id) => markBillingNotificationRead(id)));
  }, [notifications]);

  const handleSelectNotification = async (
    notif: BillingNotificationItem
  ): Promise<{ ok: boolean; errorMessage?: string }> => {
    setNotificationErrorText(null);
    const sourceInvoices =
      liveInvoices && liveInvoices.length > 0 ? liveInvoices : roleInvoices;
    const resolution = resolveNotificationLinkedInvoice({
      notification: notif,
      roleScope,
      activeUserId: activePreset.id,
      activeFullName: activePreset.fullName,
      allInvoices: sourceInvoices,
    });

    if (resolution.status !== 'resolved') {
      setNotificationErrorText(resolution.message);
      return { ok: false, errorMessage: resolution.message };
    }

    await markBillingNotificationRead(notif.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
    );
    setShowNotificationsModal(false);
    setOpenedFromNotifications(true);
    setSelectedInvoice(resolution.invoice);
    return { ok: true };
  };

  const demoAccountSwitcherNode = (
    <View
      style={[
        styles.demoSwitcherContainer,
        isMobile && styles.demoSwitcherContainerMobile,
      ]}
      testID="demo-account-switcher-bar"
    >
      <View style={styles.demoSwitcherLabelRow}>
        <UserCheck size={13} color={isMobile ? '#B45309' : '#FEF3C7'} />
        <Text
          style={[
            styles.demoSwitcherTitle,
            isMobile && styles.demoSwitcherTitleMobile,
          ]}
        >
          Active Demo Account ({activePreset.badgeText}):
        </Text>
        {isSwitchingAccount ? (
          <ActivityIndicator
            size="small"
            color={isMobile ? '#D97706' : '#FFFFFF'}
          />
        ) : null}
      </View>
      <View style={styles.demoAccountsRow}>
        {availableAccounts.map((acct) => {
          const isSelected = acct.key === activePreset.key;
          return (
            <Pressable
              key={acct.key}
              style={[
                styles.demoAccountChip,
                isMobile && styles.demoAccountChipMobile,
                isSelected &&
                  (isMobile
                    ? styles.demoAccountChipActiveMobile
                    : styles.demoAccountChipActive),
              ]}
              onPress={() => handleSelectDemoAccount(acct.key)}
              disabled={isSwitchingAccount}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              testID={`demo-account-chip-${acct.key}`}
            >
              <Text
                style={[
                  styles.demoAccountChipText,
                  isMobile && styles.demoAccountChipTextMobile,
                  isSelected &&
                    (isMobile
                      ? styles.demoAccountChipTextActiveMobile
                      : styles.demoAccountChipTextActive),
                ]}
                numberOfLines={1}
              >
                {acct.shortLabel}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[
            styles.demoActionChip,
            isMobile && styles.demoActionChipMobile,
          ]}
          onPress={() => setShowMaasModal(true)}
          accessibilityRole="button"
          accessibilityLabel="Open MCP Agent Interface"
          testID="demo-open-maas-mcp-btn"
        >
          <Cpu size={12} color="#FEF3C7" />
          <Text style={styles.demoActionChipText} numberOfLines={1}>
            MCP Agent Interface
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.demoActionChip,
            isMobile && styles.demoActionChipMobile,
          ]}
          onPress={() => void handleResetDemoSession()}
          disabled={isResettingDemo}
          accessibilityRole="button"
          accessibilityLabel="Reset Demo Session"
          testID="demo-reset-session-btn"
        >
          <RotateCcw size={12} color="#FEF3C7" />
          <Text style={styles.demoActionChipText} numberOfLines={1}>
            {isResettingDemo ? 'Resetting...' : 'Reset Demo'}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.page} testID="billing-screen">
      {/* Approved Orange Rounded Header (#F59E0B) — Compact on Mobile */}
      <LinearGradient
        colors={['#F59E0B', '#F59E0B']}
        style={[
          styles.header,
          isMobile && styles.headerMobile,
          {
            paddingTop: isMobile
              ? Math.max(insets.top, 8) + 4
              : insets.top + 8,
          },
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        testID="billing-main-header"
      >
        {/* Desktop: Top Demo Account Switcher Bar stays in header */}
        {!isMobile ? demoAccountSwitcherNode : null}

        <View style={[styles.headerRow, isMobile && styles.headerRowMobile]}>
          <View style={styles.headerText}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: isMobile ? 8 : 10,
              }}
            >
              <BillingBrandIcon size={isMobile ? 24 : 28} />
              <Text
                style={[styles.title, isMobile && styles.titleMobile]}
                numberOfLines={1}
                testID="billing-header-title"
              >
                {isDoctorRole ? 'Provider Billing' : 'Customer Billing'}
              </Text>
            </View>
            <Text
              style={[styles.subtitle, isMobile && styles.subtitleMobile]}
              numberOfLines={1}
              testID="billing-header-subtitle"
            >
              {isMobile
                ? `${activePreset.fullName} • ${
                    isDoctorRole ? 'Provider' : 'Customer'
                  }`
                : isDoctorRole
                  ? `${activePreset.fullName} • Manage invoices, PayPal Sandbox & Billing AI`
                  : `${activePreset.fullName} • View statements, PayPal Sandbox & Billing AI`}
            </Text>
          </View>

          <View
            style={[styles.headerIcons, isMobile && styles.headerIconsMobile]}
          >
            <Pressable
              style={[styles.iconButton, isMobile && styles.iconButtonMobile]}
              onPress={() => setSearchVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Search invoices"
              testID="billing-header-search-btn"
            >
              <Search
                size={isMobile ? 18 : 20}
                color="#FFFFFF"
                strokeWidth={2.5}
              />
            </Pressable>

            <Pressable
              style={[styles.iconButton, isMobile && styles.iconButtonMobile]}
              onPress={() => setShowNotificationsModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Billing Notifications"
              testID="billing-header-notifications-btn"
            >
              <Bell
                size={isMobile ? 18 : 20}
                color="#FFFFFF"
                strokeWidth={2.5}
              />
              {unreadNotificationsCount > 0 ? (
                <View
                  style={styles.notificationBadge}
                  testID="billing-header-notifications-badge"
                >
                  <Text style={styles.notificationBadgeText}>
                    {unreadNotificationsCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>

            <Pressable
              style={[styles.iconButton, isMobile && styles.iconButtonMobile]}
              onPress={() => setShowSettingsModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Billing Settings"
              testID="billing-header-settings-btn"
            >
              <Settings
                size={isMobile ? 18 : 20}
                color="#FFFFFF"
                strokeWidth={2.5}
              />
            </Pressable>

            {isDoctorRole ? (
              <Pressable
                style={[styles.iconButton, isMobile && styles.iconButtonMobile]}
                onPress={() => setShowCreateInvoiceModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Create Invoice"
                testID="billing-header-add-btn"
              >
                <Plus
                  size={isMobile ? 20 : 22}
                  color="#FFFFFF"
                  strokeWidth={2.5}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          isMobile && styles.contentMobile,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#D97706']}
            tintColor="#D97706"
          />
        }
      >
        {/* Mobile: Demo Account Controls sit below main header inside scrollable content */}
        {isMobile ? demoAccountSwitcherNode : null}

        {/* PayPal Browser Checkout Return / Cancel Banner */}
        {paypalReturnBannerText ? (
          <View
            style={styles.deepLinkResolvedBanner}
            testID="billing-paypal-return-banner"
          >
            <Text style={styles.deepLinkResolvedText}>
              {paypalReturnBannerText}
            </Text>
          </View>
        ) : null}

        {/* Deep-Link Error / Unauthorized Banner */}
        {resetBannerText ? (
          <View
            style={styles.deepLinkResolvedBanner}
            testID="billing-demo-reset-banner"
          >
            <Text style={styles.deepLinkResolvedText}>{resetBannerText}</Text>
          </View>
        ) : null}
        {(deepLinkResolution.status === 'not_found' &&
          (hasLoadedLiveOnce ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(rawInvoiceId || ''))) ||
        deepLinkResolution.status === 'unauthorized' ? (
          <View
            style={styles.deepLinkErrorBanner}
            testID="billing-deeplink-error-banner"
          >
            <ShieldAlert size={18} color="#B91C1C" />
            <View style={styles.deepLinkErrorCol}>
              <Text style={styles.deepLinkErrorTitle}>
                {deepLinkResolution.status === 'unauthorized'
                  ? 'Invoice Access Restricted'
                  : 'Invoice Not Found'}
              </Text>
              <Text style={styles.deepLinkErrorBody}>
                {deepLinkResolution.message}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Deep-Link Resolved Notification Pill */}
        {deepLinkResolution.status === 'resolved' &&
        deepLinkResolution.notificationId ? (
          <View
            style={styles.deepLinkResolvedBanner}
            testID="billing-deeplink-resolved-banner"
          >
            <Text style={styles.deepLinkResolvedText}>
              Opened from Notification ({deepLinkResolution.notificationId}) →
              Statement #{deepLinkResolution.invoice.invoiceNumber}
            </Text>
          </View>
        ) : null}

        {isDoctorRole ? (
          <DoctorBillingView
            invoices={roleInvoices}
            searchVisible={searchVisible}
            searchQuery={searchQuery}
            onChangeSearchQuery={setSearchQuery}
            highlightedInvoiceId={
              deepLinkResolution.status === 'resolved'
                ? deepLinkResolution.invoice.id
                : null
            }
            onSelectInvoice={(inv) => setSelectedInvoice(inv)}
            onAskBillingAI={(inv) => handleOpenBillingAI(inv)}
            onOpenSettings={() => setShowSettingsModal(true)}
            onOpenCreateInvoice={() => setShowCreateInvoiceModal(true)}
          />
        ) : (
          <PatientBillingView
            invoices={roleInvoices}
            searchVisible={searchVisible}
            searchQuery={searchQuery}
            onChangeSearchQuery={setSearchQuery}
            highlightedInvoiceId={
              deepLinkResolution.status === 'resolved'
                ? deepLinkResolution.invoice.id
                : null
            }
            onSelectInvoice={(inv) => setSelectedInvoice(inv)}
            onAskBillingAI={(inv) => handleOpenBillingAI(inv)}
            onOpenSettings={() => setShowSettingsModal(true)}
          />
        )}
      </ScrollView>

      {/* Conditionally Mounted Modals per Fabric Yoga Rule */}
      {searchVisible ? (
        <BillingGlobalSearchModal
          visible={searchVisible}
          roleScope={roleScope}
          activeUserId={activePreset.id}
          activeAccountLabel={`${activePreset.shortLabel} (${activePreset.badgeText})`}
          invoices={roleInvoices}
          billablePatients={billablePatients}
          searchQuery={searchQuery}
          onChangeSearchQuery={setSearchQuery}
          onClose={() => setSearchVisible(false)}
          onSelectInvoice={(inv) => {
            setOpenedFromNotifications(false);
            setSelectedInvoice(inv);
          }}
          onAskBillingAI={(inv) => handleOpenBillingAI(inv)}
          onRetry={() => void refreshBillingData(true)}
        />
      ) : null}

      {selectedInvoice ? (
        <BillingInvoiceDetailModal
          visible={Boolean(selectedInvoice)}
          invoice={selectedInvoice}
          roleScope={roleScope}
          onClose={() => {
            setSelectedInvoice(null);
            setOpenedFromNotifications(false);
            setCheckoutReturnState(null);
          }}
          onAskBillingAI={(inv) => handleOpenBillingAI(inv)}
          onInvoiceMutated={() => void refreshBillingData()}
          initialCheckoutState={checkoutReturnState}
          onClearCheckoutState={() => setCheckoutReturnState(null)}
          onBackToNotifications={
            openedFromNotifications
              ? () => {
                  setSelectedInvoice(null);
                  setOpenedFromNotifications(false);
                  setShowNotificationsModal(true);
                }
              : null
          }
        />
      ) : null}

      {showAiModal ? (
        <BillingAIAssistantModal
          visible={showAiModal}
          roleScope={roleScope}
          focusedInvoice={focusedAiInvoice}
          invoices={roleInvoices}
          onClose={() => setShowAiModal(false)}
          onDataChanged={() => void refreshBillingData()}
          onOpenInvoice={(inv) => {
            if (inv) {
              setShowAiModal(false);
              setOpenedFromNotifications(false);
              setSelectedInvoice(inv);
            }
          }}
        />
      ) : null}

      {showSettingsModal ? (
        <BillingAISettingsModal
          visible={showSettingsModal}
          roleScope={roleScope}
          initialSettings={aiSettings}
          connection={connection}
          auditEvents={auditEvents}
          onSettingsUpdated={(next) => setAiSettings(next)}
          onConnectionChanged={() => void refreshBillingData()}
          onClose={() => setShowSettingsModal(false)}
        />
      ) : null}

      {showCreateInvoiceModal && isDoctorRole ? (
        <BillingCreateInvoiceModal
          visible={showCreateInvoiceModal}
          patients={billablePatients}
          catalog={catalog}
          onInvoiceCreated={() => void refreshBillingData()}
          onClose={() => setShowCreateInvoiceModal(false)}
        />
      ) : null}

      {showNotificationsModal ? (
        <BillingNotificationsModal
          visible={showNotificationsModal}
          notifications={notifications}
          onClose={() => {
            setShowNotificationsModal(false);
            setNotificationErrorText(null);
          }}
          onSelectNotification={(n) => handleSelectNotification(n)}
          onMarkAllRead={() => void handleMarkAllNotificationsRead()}
          errorMessage={notificationErrorText}
          onClearError={() => setNotificationErrorText(null)}
        />
      ) : null}

      {showMaasModal ? (
        <BillingMaaSMcpModal
          visible={showMaasModal}
          demoSessionId={demoSessionId}
          onClose={() => setShowMaasModal(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F8F9FC',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    gap: 10,
  },
  headerMobile: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    gap: 6,
  },
  demoSwitcherContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  demoSwitcherContainerMobile: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  demoSwitcherLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  demoSwitcherTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FEF3C7',
    flex: 1,
  },
  demoSwitcherTitleMobile: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '800',
  },
  demoAccountsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  demoAccountChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  demoAccountChipMobile: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FCD34D',
  },
  demoAccountChipActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  demoAccountChipActiveMobile: {
    backgroundColor: '#D97706',
    borderColor: '#B45309',
  },
  demoAccountChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  demoAccountChipTextMobile: {
    color: '#92400E',
  },
  demoAccountChipTextActive: {
    color: '#B45309',
    fontWeight: '800',
  },
  demoAccountChipTextActiveMobile: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  demoActionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    borderWidth: 1,
    borderColor: 'rgba(254, 243, 199, 0.45)',
  },
  demoActionChipMobile: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  demoActionChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FEF3C7',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  headerRowMobile: {
    gap: 8,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconsMobile: {
    gap: 6,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  iconButtonMobile: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#F59E0B',
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  titleMobile: {
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: '#FEF3C7',
    fontSize: 13,
    marginTop: 2,
  },
  subtitleMobile: {
    fontSize: 11,
    marginTop: 1,
  },
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  contentMobile: {
    padding: 14,
    gap: 12,
    paddingBottom: 32,
  },
  deepLinkErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
  },
  deepLinkErrorCol: {
    flex: 1,
  },
  deepLinkErrorTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#991B1B',
  },
  deepLinkErrorBody: {
    fontSize: 12,
    lineHeight: 17,
    color: '#B91C1C',
    marginTop: 2,
  },
  deepLinkResolvedBanner: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deepLinkResolvedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3730A3',
  },
});
