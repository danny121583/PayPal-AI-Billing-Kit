import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
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
import BillingInvoiceDetailModal from '../components/billing/BillingInvoiceDetailModal';
import BillingCreateInvoiceModal from '../components/billing/BillingCreateInvoiceModal';
import BillingAIAssistantModal from '../components/billing/BillingAIAssistantModal';
import BillingAISettingsModal from '../components/billing/BillingAISettingsModal';
import BillingNotificationsModal from '../components/billing/BillingNotificationsModal';
import BillingMaaSMcpModal from '../components/billing/BillingMaaSMcpModal';
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
  type BillablePatientOption,
  type BillingAISettingsRecord,
  type BillingAuditEventItem,
  type BillingServiceCatalogItem,
  type PayPalAccountConnectionSummary,
} from '../src/billing/api/billingService';
import { clearBillingAIClientCacheForTests } from '../src/billing/api/billingAIClient';

export default function BillingScreen() {
  const insets = useSafeAreaInsets();
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
    notificationId?: string | string[];
    modal?: string | string[];
    account?: string | string[];
  }>();

  const rawInvoiceId = Array.isArray(params.invoiceId)
    ? params.invoiceId[0]
    : params.invoiceId;
  const rawNotificationId = Array.isArray(params.notificationId)
    ? params.notificationId[0]
    : params.notificationId;
  const rawModal = Array.isArray(params.modal)
    ? params.modal[0]
    : params.modal;
  const rawAccount = Array.isArray(params.account)
    ? params.account[0]
    : params.account;

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

  const handleSelectNotification = async (notif: BillingNotificationItem) => {
    void markBillingNotificationRead(notif.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
    );
    setShowNotificationsModal(false);

    if (notif.invoiceId) {
      const target = roleInvoices.find(
        (inv) =>
          inv.id === notif.invoiceId || inv.invoiceNumber === notif.invoiceId
      );
      if (target) {
        setSelectedInvoice(target);
      }
    }
  };

  return (
    <View style={styles.page} testID="billing-screen">
      {/* Approved Orange Rounded Header (#F59E0B) — No Home Icon */}
      <LinearGradient
        colors={['#F59E0B', '#F59E0B']}
        style={[styles.header, { paddingTop: insets.top + 8 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        {/* Top Demo Account Switcher Bar */}
        <View
          style={styles.demoSwitcherContainer}
          testID="demo-account-switcher-bar"
        >
          <View style={styles.demoSwitcherLabelRow}>
            <UserCheck size={13} color="#FEF3C7" />
            <Text style={styles.demoSwitcherTitle}>
              Active Demo Account ({activePreset.badgeText}):
            </Text>
            {isSwitchingAccount ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
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
                    isSelected && styles.demoAccountChipActive,
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
                      isSelected && styles.demoAccountChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {acct.shortLabel}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={styles.demoActionChip}
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
              style={styles.demoActionChip}
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

        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <BillingBrandIcon size={28} />
              <Text style={styles.title} testID="billing-header-title">
                {isDoctorRole ? 'Provider Billing' : 'Customer Billing'}
              </Text>
            </View>
            <Text
              style={styles.subtitle}
              numberOfLines={1}
              testID="billing-header-subtitle"
            >
              {isDoctorRole
                ? `${activePreset.fullName} • Manage invoices, PayPal Sandbox & Billing AI`
                : `${activePreset.fullName} • View statements, PayPal Sandbox & Billing AI`}
            </Text>
          </View>

          <View style={styles.headerIcons}>
            <Pressable
              style={styles.iconButton}
              onPress={() =>
                setSearchVisible((prev) => {
                  if (prev) setSearchQuery('');
                  return !prev;
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Search invoices"
              testID="billing-header-search-btn"
            >
              <Search size={20} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>

            <Pressable
              style={styles.iconButton}
              onPress={() => setShowNotificationsModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Billing Notifications"
              testID="billing-header-notifications-btn"
            >
              <Bell size={20} color="#FFFFFF" strokeWidth={2.5} />
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
              style={styles.iconButton}
              onPress={() => setShowSettingsModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Billing Settings"
              testID="billing-header-settings-btn"
            >
              <Settings size={20} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>

            {isDoctorRole ? (
              <Pressable
                style={styles.iconButton}
                onPress={() => setShowCreateInvoiceModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Create Invoice"
                testID="billing-header-add-btn"
              >
                <Plus size={22} color="#FFFFFF" strokeWidth={2.5} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
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
      {selectedInvoice ? (
        <BillingInvoiceDetailModal
          visible={Boolean(selectedInvoice)}
          invoice={selectedInvoice}
          roleScope={roleScope}
          onClose={() => setSelectedInvoice(null)}
          onAskBillingAI={(inv) => handleOpenBillingAI(inv)}
          onInvoiceMutated={() => void refreshBillingData()}
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
          onClose={() => setShowNotificationsModal(false)}
          onSelectNotification={(n) => void handleSelectNotification(n)}
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
  demoSwitcherContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
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
  demoAccountChipActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  demoAccountChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  demoAccountChipTextActive: {
    color: '#B45309',
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
  headerText: {
    flex: 1,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  subtitle: {
    color: '#FEF3C7',
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
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
