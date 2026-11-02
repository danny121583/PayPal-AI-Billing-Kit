import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
} from 'react-native';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Calendar,
  DollarSign,
  RotateCcw,
} from 'lucide-react-native';
import { ModalActionButtons } from '../ui/ModalActionButtons';
import BillingModalShell from './BillingModalShell';
import {
  createBillingInvoice,
  DEFAULT_SERVICE_CATALOG,
  type BillablePatientOption,
  type BillingServiceCatalogItem,
} from '../../src/billing/api/billingService';

export interface BillingCreateInvoiceModalProps {
  visible: boolean;
  patients: BillablePatientOption[];
  catalog: BillingServiceCatalogItem[];
  onInvoiceCreated: () => void;
  onClose: () => void;
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

const DUE_DATE_SHORTCUTS = [
  { label: 'In 7 Days (+7d)', days: 7 },
  { label: 'In 14 Days (+14d)', days: 14 },
  { label: 'In 30 Days (+30d)', days: 30 },
  { label: 'In 45 Days (+45d)', days: 45 },
];

export default function BillingCreateInvoiceModal({
  visible,
  patients,
  catalog,
  onInvoiceCreated,
  onClose,
}: BillingCreateInvoiceModalProps) {
  const effectiveCatalog =
    catalog && catalog.length > 0 ? catalog : DEFAULT_SERVICE_CATALOG;

  const [selectedPatientId, setSelectedPatientId] = useState<string>(
    patients[0]?.patientId ?? ''
  );
  const [selectedCode, setSelectedCode] = useState<string>(
    effectiveCatalog[0]?.code ?? 'ADMIN-TELEHEALTH'
  );
  const [amountUsd, setAmountUsd] = useState<string>(() => {
    const first = effectiveCatalog[0];
    return first ? (first.defaultAmountMinor / 100).toFixed(2) : '150.00';
  });
  const [isCustomAmount, setIsCustomAmount] = useState<boolean>(false);
  const [dueDate, setDueDate] = useState<string>(() => addDaysIso(14));
  const [showCalendarPicker, setShowCalendarPicker] = useState<boolean>(false);
  const [description, setDescription] = useState<string>(
    effectiveCatalog[0]?.description ?? ''
  );
  const [submittingMode, setSubmittingMode] = useState<'draft' | 'send' | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (
      patients.length > 0 &&
      !patients.some((p) => p.patientId === selectedPatientId)
    ) {
      setSelectedPatientId(patients[0].patientId);
    }
    const activeService =
      effectiveCatalog.find((c) => c.code === selectedCode) ??
      effectiveCatalog[0];
    if (activeService && !isCustomAmount) {
      setSelectedCode(activeService.code);
      setAmountUsd((activeService.defaultAmountMinor / 100).toFixed(2));
      setDescription(activeService.description);
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, patients]);

  const selectedCatalogItem = useMemo(
    () =>
      effectiveCatalog.find((c) => c.code === selectedCode) ??
      effectiveCatalog[0],
    [effectiveCatalog, selectedCode]
  );

  const upcomingCalendarDates = useMemo(() => {
    return [3, 5, 7, 10, 14, 21, 30, 45, 60].map((d) => {
      const iso = addDaysIso(d);
      const dt = new Date(`${iso}T12:00:00Z`);
      const label = dt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      return { days: d, iso, label };
    });
  }, []);

  if (!visible) return null;

  const handleSelectCatalog = (item: BillingServiceCatalogItem) => {
    setSelectedCode(item.code);
    setIsCustomAmount(false);
    setAmountUsd((item.defaultAmountMinor / 100).toFixed(2));
    setDescription(item.description);
    setErrorMsg(null);
  };

  const handleEnableCustomAmount = () => {
    setIsCustomAmount(true);
    setErrorMsg(null);
  };

  const handleResetToCatalogAmount = () => {
    if (!selectedCatalogItem) return;
    setIsCustomAmount(false);
    setAmountUsd((selectedCatalogItem.defaultAmountMinor / 100).toFixed(2));
  };

  const handleAmountChange = (val: string) => {
    setAmountUsd(val);
    const catalogDefault = selectedCatalogItem
      ? (selectedCatalogItem.defaultAmountMinor / 100).toFixed(2)
      : '';
    setIsCustomAmount(val.trim() !== catalogDefault);
  };

  const handleSubmit = async (sendNow: boolean) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedPatientId) {
      setErrorMsg('Please select an authorized customer recipient.');
      return;
    }

    const parsedUsd = Number.parseFloat(amountUsd);
    if (!Number.isFinite(parsedUsd) || parsedUsd <= 0 || parsedUsd > 10000) {
      setErrorMsg(
        'Enter a valid invoice amount between $1.00 and $10,000.00 USD.'
      );
      return;
    }

    const amountMinor = Math.round(parsedUsd * 100);
    setSubmittingMode(sendNow ? 'send' : 'draft');

    try {
      const result = await createBillingInvoice({
        recipientUserId: selectedPatientId,
        items: [
          {
            serviceCode: selectedCatalogItem.code,
            quantity: 1,
            unitAmountMinor: amountMinor,
          },
        ],
        dueDate: dueDate.trim() || addDaysIso(14),
        sendImmediately: sendNow,
      });

      setSuccessMsg(
        sendNow
          ? `Invoice ${result.invoiceNumber} ($${(amountMinor / 100).toFixed(2)}) created and sent to customer.`
          : `Draft invoice ${result.invoiceNumber} ($${(amountMinor / 100).toFixed(2)}) saved.`
      );
      onInvoiceCreated();
      setTimeout(() => {
        onClose();
      }, 650);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to create invoice.');
    } finally {
      setSubmittingMode(null);
    }
  };

  return (
    <BillingModalShell
      visible={visible}
      onClose={onClose}
      title="Create Invoice"
      subtitle="Select customer, service catalog item & due date"
      testID="billing-create-invoice-modal"
      closeTestID="billing-create-invoice-close-btn"
      closeAccessibilityLabel="Close Create Invoice"
      footer={
        <ModalActionButtons
          actions={[
            {
              label: 'Cancel',
              onPress: onClose,
              variant: 'cancel',
              disabled: Boolean(submittingMode),
              testID: 'create-invoice-cancel-btn',
            },
            {
              label: 'Save Draft',
              onPress: () => void handleSubmit(false),
              variant: 'secondary',
              loading: submittingMode === 'draft',
              disabled: Boolean(submittingMode),
              testID: 'create-invoice-save-draft-btn',
            },
            {
              label: 'Send Invoice',
              onPress: () => void handleSubmit(true),
              variant: 'warning',
              loading: submittingMode === 'send',
              disabled: Boolean(submittingMode),
              testID: 'create-invoice-send-btn',
            },
          ]}
        />
      }
    >
      {errorMsg ? (
        <View style={styles.errorBanner} testID="create-invoice-error-banner">
          <AlertTriangle size={15} color="#B91C1C" />
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : null}

      {successMsg ? (
        <View
          style={styles.successBanner}
          testID="create-invoice-success-banner"
        >
          <CheckCircle2 size={15} color="#047857" />
          <Text style={styles.successText}>{successMsg}</Text>
        </View>
      ) : null}

      {/* 1. Customer Recipient Selection */}
      <Text style={styles.label}>1. Authorized Customer Recipient</Text>
      {patients.length === 0 ? (
        <View style={styles.emptyPatientsBox}>
          <Text style={styles.emptyPatientsText}>
            No authorized customers found.
          </Text>
        </View>
      ) : (
        <View style={styles.choiceList}>
          {patients.map((pt) => {
            const active = pt.patientId === selectedPatientId;
            return (
              <Pressable
                key={pt.patientId}
                style={[styles.choiceCard, active && styles.choiceCardActive]}
                onPress={() => setSelectedPatientId(pt.patientId)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`create-invoice-patient-${pt.patientId}`}
              >
                <UserCheck size={16} color={active ? '#B45309' : '#6B7280'} />
                <View style={styles.choiceTextCol}>
                  <Text
                    style={[
                      styles.choiceTitle,
                      active && styles.choiceTitleActive,
                    ]}
                  >
                    {pt.fullName}
                  </Text>
                  {pt.emailMasked ? (
                    <Text style={styles.choiceSub}>{pt.emailMasked}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* 2. Administrative Service Catalog */}
      <Text style={styles.label}>2. Administrative Service Code</Text>
      <View style={styles.choiceList}>
        {effectiveCatalog.map((item) => {
          const active = item.code === selectedCode;
          return (
            <Pressable
              key={item.code}
              style={[styles.choiceCard, active && styles.choiceCardActive]}
              onPress={() => handleSelectCatalog(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              testID={`create-invoice-service-${item.code}`}
            >
              <View style={styles.choiceTextCol}>
                <Text
                  style={[
                    styles.choiceTitle,
                    active && styles.choiceTitleActive,
                  ]}
                >
                  {item.title}
                </Text>
                <Text style={styles.choiceSub}>
                  {item.code} • Catalog Price: $
                  {(item.defaultAmountMinor / 100).toFixed(2)} USD
                </Text>
              </View>
              <View style={[styles.pricePill, active && styles.pricePillActive]}>
                <Text
                  style={[
                    styles.pricePillText,
                    active && styles.pricePillTextActive,
                  ]}
                >
                  ${(item.defaultAmountMinor / 100).toFixed(2)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* 3. Amount & Custom Amount Option */}
      <View style={styles.amountHeaderRow}>
        <Text style={styles.label}>3. Invoice Amount (USD)</Text>
        <View style={styles.amountModeRow}>
          {isCustomAmount ? (
            <Pressable
              style={styles.resetCatalogBtn}
              onPress={handleResetToCatalogAmount}
              accessibilityRole="button"
              testID="create-invoice-reset-catalog-price-btn"
            >
              <RotateCcw size={12} color="#1D4ED8" />
              <Text style={styles.resetCatalogBtnText}>
                Reset to $
                {(selectedCatalogItem.defaultAmountMinor / 100).toFixed(2)}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.customAmountToggleBtn}
              onPress={handleEnableCustomAmount}
              accessibilityRole="button"
              testID="create-invoice-custom-amount-btn"
            >
              <DollarSign size={12} color="#B45309" />
              <Text style={styles.customAmountToggleText}>Custom Amount</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.amountInputRow}>
        <View style={styles.amountInputWrapper}>
          <Text style={styles.currencyPrefix}>$</Text>
          <TextInput
            style={styles.amountInput}
            value={amountUsd}
            onChangeText={handleAmountChange}
            keyboardType="decimal-pad"
            placeholder="150.00"
            placeholderTextColor="#9CA3AF"
            testID="create-invoice-amount-input"
          />
          <Text style={styles.currencySuffix}>USD</Text>
        </View>
        <View
          style={[
            styles.amountModeBadge,
            isCustomAmount
              ? styles.amountModeBadgeCustom
              : styles.amountModeBadgeCatalog,
          ]}
          testID="create-invoice-amount-mode-badge"
        >
          <Text
            style={[
              styles.amountModeBadgeText,
              isCustomAmount
                ? styles.amountModeBadgeTextCustom
                : styles.amountModeBadgeTextCatalog,
            ]}
          >
            {isCustomAmount ? 'CUSTOM AMOUNT' : 'CATALOG PRICE'}
          </Text>
        </View>
      </View>

      {/* 4. Due Date with Quick Shortcuts & Calendar Picker */}
      <View style={styles.amountHeaderRow}>
        <Text style={styles.label}>4. Statement Due Date</Text>
        <Pressable
          style={styles.calendarToggleBtn}
          onPress={() => setShowCalendarPicker((prev) => !prev)}
          accessibilityRole="button"
          testID="create-invoice-calendar-toggle-btn"
        >
          <Calendar size={13} color="#2563EB" />
          <Text style={styles.calendarToggleText}>
            {showCalendarPicker ? 'Hide Date Picker' : 'Open Date Picker'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.dueDateShortcutsRow}>
        {DUE_DATE_SHORTCUTS.map((sc) => {
          const targetIso = addDaysIso(sc.days);
          const isSelected = dueDate === targetIso;
          return (
            <Pressable
              key={sc.days}
              style={[
                styles.dueShortcutChip,
                isSelected && styles.dueShortcutChipActive,
              ]}
              onPress={() => setDueDate(targetIso)}
              accessibilityRole="button"
              testID={`create-invoice-due-shortcut-${sc.days}d`}
            >
              <Text
                style={[
                  styles.dueShortcutText,
                  isSelected && styles.dueShortcutTextActive,
                ]}
              >
                {sc.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {showCalendarPicker ? (
        <View
          style={styles.calendarGridCard}
          testID="create-invoice-calendar-picker"
        >
          <Text style={styles.calendarGridTitle}>
            Select Upcoming Statement Due Date:
          </Text>
          <View style={styles.calendarDatesGrid}>
            {upcomingCalendarDates.map((dt) => {
              const active = dueDate === dt.iso;
              return (
                <Pressable
                  key={dt.iso}
                  style={[
                    styles.calendarDateCell,
                    active && styles.calendarDateCellActive,
                  ]}
                  onPress={() => {
                    setDueDate(dt.iso);
                    setShowCalendarPicker(false);
                  }}
                  accessibilityRole="button"
                  testID={`create-invoice-calendar-date-${dt.days}d`}
                >
                  <Text
                    style={[
                      styles.calendarDateLabel,
                      active && styles.calendarDateLabelActive,
                    ]}
                  >
                    {dt.label}
                  </Text>
                  <Text
                    style={[
                      styles.calendarDateSub,
                      active && styles.calendarDateLabelActive,
                    ]}
                  >
                    +{dt.days}d
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        value={dueDate}
        onChangeText={setDueDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#9CA3AF"
        testID="create-invoice-duedate-input"
      />

      {/* 5. Administrative Description */}
      <Text style={styles.label}>
        5. Administrative Statement Summary (Sensitive-Data Filtered)
      </Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        placeholder="Administrative billing description (do not include private clinical notes)"
        placeholderTextColor="#9CA3AF"
        multiline
        testID="create-invoice-description-input"
      />

      {/* Sensitive-Data Guardrail Notice */}
      <View style={styles.phiNotice}>
        <ShieldCheck size={15} color="#047857" />
        <Text style={styles.phiNoticeText}>
          Sensitive-Data Firewall: Only the administrative service code (
          {selectedCatalogItem.code}), invoice number, and USD amount are sent to
          PayPal Sandbox.
        </Text>
      </View>
    </BillingModalShell>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    marginBottom: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#991B1B',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginBottom: 8,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#065F46',
  },
  label: {
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
    marginBottom: 6,
  },
  emptyPatientsBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  emptyPatientsText: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '600',
  },
  choiceList: {
    gap: 8,
  },
  choiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  choiceCardActive: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  choiceTextCol: {
    flex: 1,
  },
  choiceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  choiceTitleActive: {
    color: '#92400E',
  },
  choiceSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  pricePill: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  pricePillActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  pricePillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
  },
  pricePillTextActive: {
    color: '#92400E',
  },
  amountHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  amountModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customAmountToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  customAmountToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  resetCatalogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  resetCatalogBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  amountInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  currencyPrefix: {
    fontSize: 16,
    fontWeight: '800',
    color: '#374151',
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  currencySuffix: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    marginLeft: 4,
  },
  amountModeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  amountModeBadgeCatalog: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  amountModeBadgeCustom: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  amountModeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  amountModeBadgeTextCatalog: {
    color: '#047857',
  },
  amountModeBadgeTextCustom: {
    color: '#B45309',
  },
  calendarToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  calendarToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  dueDateShortcutsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  dueShortcutChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  dueShortcutChipActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  dueShortcutText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  dueShortcutTextActive: {
    color: '#92400E',
  },
  calendarGridCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  calendarGridTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
  calendarDatesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  calendarDateCell: {
    width: '30%',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  calendarDateCellActive: {
    backgroundColor: '#2563EB',
    borderColor: '#1D4ED8',
  },
  calendarDateLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  calendarDateSub: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  calendarDateLabelActive: {
    color: '#FFFFFF',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  textArea: {
    minHeight: 74,
    textAlignVertical: 'top',
  },
  phiNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginTop: 10,
  },
  phiNoticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: '#065F46',
  },
});
