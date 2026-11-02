import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardEvent,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';

export interface BillingModalShellProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  headerAccessory?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  scroll?: boolean;
  size?: 'tall' | 'auto';
  testID?: string;
  closeTestID?: string;
  closeAccessibilityLabel?: string;
  bodyContentStyle?: StyleProp<ViewStyle>;
}

const KEYBOARD_GAP = 8;

export function useKeyboardOverlapPadding(cardRef: React.RefObject<View | null>) {
  const [padding, setPadding] = useState(0);

  const animate = (duration?: number) => {
    if (Platform.OS === 'web') return;
    LayoutAnimation.configureNext({
      duration: duration && duration > 0 ? duration : 250,
      update: { type: LayoutAnimation.Types.keyboard },
    });
  };

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const keyboardTop = e.endCoordinates.screenY;
      const node = cardRef.current;
      if (!node || typeof node.measureInWindow !== 'function') return;
      node.measureInWindow((_x, y, _w, h) => {
        setPadding((prev) => {
          const overlap = Math.max(0, y + h - prev - keyboardTop + KEYBOARD_GAP);
          if (overlap !== prev) animate(e.duration);
          return overlap;
        });
      });
    };
    const onHide = (e: KeyboardEvent) => {
      animate(e?.duration);
      setPadding(0);
    };

    const s1 = Keyboard.addListener(showEvent, onShow);
    const s2 = Keyboard.addListener(hideEvent, onHide);
    return () => {
      s1.remove();
      s2.remove();
    };
  }, [cardRef]);

  return padding;
}

export default function BillingModalShell({
  visible,
  onClose,
  title,
  subtitle,
  headerAccessory,
  footer,
  children,
  scroll = true,
  size = 'tall',
  testID,
  closeTestID,
  closeAccessibilityLabel,
  bodyContentStyle,
}: BillingModalShellProps) {
  const cardRef = useRef<View>(null);
  const keyboardPadding = useKeyboardOverlapPadding(cardRef);

  const handleBackdrop = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={handleBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Close modal backdrop"
          testID="billing-modal-backdrop"
        />
        <View
          ref={cardRef}
          style={[styles.modalContainer, size === 'tall' ? styles.sizeTall : styles.sizeAuto]}
          testID={testID}
        >
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>
                {title}
              </Text>
              {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
              <Pressable
                testID={closeTestID}
                style={styles.closeIconButton}
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={closeAccessibilityLabel || `Close ${title}`}
              >
                <X size={18} color="#475569" />
              </Pressable>
            </View>
            {headerAccessory ? <View style={styles.headerAccessory}>{headerAccessory}</View> : null}
          </View>

          {scroll ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={[styles.bodyContent, bodyContentStyle]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={false}
              overScrollMode="never"
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.body}>{children}</View>
          )}

          {footer ? <View style={styles.footer}>{footer}</View> : null}
          <View style={{ height: keyboardPadding }} testID="billing-modal-keyboard-spacer" />
        </View>
      </View>
    </Modal>
  );
}

export const billingModalStyles = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 6 },
  primaryButton: {
    backgroundColor: '#F59E0B',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#1F2937', fontSize: 15, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB', marginVertical: 12 },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    maxWidth: 460,
    width: '100%',
    padding: 20,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  sizeTall: {
    height: '78%',
    maxHeight: 640,
    minHeight: 440,
  },
  sizeAuto: {
    maxHeight: '85%',
  },
  header: {
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexShrink: 0,
  },
  headerTitleContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  closeIconButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAccessory: {
    marginTop: 8,
    alignItems: 'center',
  },
  body: {
    flex: 1,
    width: '100%',
  },
  bodyContent: {
    paddingBottom: 8,
  },
  footer: {
    flexShrink: 0,
    paddingTop: 10,
  },
});
