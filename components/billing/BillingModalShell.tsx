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
  useWindowDimensions,
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
  headerLeftAction?: React.ReactNode;
  headerAccessory?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  scroll?: boolean;
  size?: 'tall' | 'auto';
  desktopMaxWidth?: number;
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

export function BillingModalShell({
  visible,
  onClose,
  title,
  subtitle,
  headerLeftAction,
  headerAccessory,
  footer,
  children,
  scroll = true,
  size = 'tall',
  desktopMaxWidth = 560,
  testID,
  closeTestID,
  closeAccessibilityLabel,
  bodyContentStyle,
}: BillingModalShellProps) {
  const cardRef = useRef<View>(null);
  const keyboardPadding = useKeyboardOverlapPadding(cardRef);
  const { width: windowWidth } = useWindowDimensions();
  const isCompactMobile = windowWidth > 0 && windowWidth < 480;
  const isDesktopViewport = windowWidth >= 768;

  const handleBackdrop = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={[styles.backdrop, isCompactMobile && styles.backdropMobile]}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={handleBackdrop}
          accessibilityRole="button"
          accessibilityLabel="Close modal backdrop"
          testID="billing-modal-backdrop"
        />
        <View
          ref={cardRef}
          style={[
            styles.modalContainer,
            isDesktopViewport && { maxWidth: desktopMaxWidth },
            isCompactMobile && styles.modalContainerMobile,
            size === 'tall'
              ? isCompactMobile
                ? styles.sizeTallMobile
                : styles.sizeTall
              : styles.sizeAuto,
          ]}
          testID={testID}
        >
          <View style={[styles.header, isCompactMobile && styles.headerMobile]}>
            <View style={styles.headerTitleContainer}>
              {headerLeftAction ? (
                <View style={styles.headerLeftSlot} testID="billing-modal-header-left-slot">
                  {headerLeftAction}
                </View>
              ) : null}
              <Text
                style={[styles.headerTitle, isCompactMobile && styles.headerTitleMobile]}
                accessibilityRole="header"
                numberOfLines={1}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  style={[styles.headerSubtitle, isCompactMobile && styles.headerSubtitleMobile]}
                  numberOfLines={2}
                >
                  {subtitle}
                </Text>
              ) : null}
              <Pressable
                testID={closeTestID}
                style={({ pressed }) => [
                  styles.closeIconButton,
                  pressed && styles.closeIconButtonPressed,
                ]}
                onPress={onClose}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={closeAccessibilityLabel || `Close ${title}`}
                {...(Platform.OS === 'web'
                  ? ({ title: closeAccessibilityLabel || `Close ${title}` } as Record<
                      string,
                      unknown
                    >)
                  : {})}
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
  backdropMobile: {
    padding: 10,
  },
  modalContainer: {
    maxWidth: 520,
    width: '100%',
    padding: 20,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  modalContainerMobile: {
    padding: 14,
    borderRadius: 20,
  },
  sizeTall: {
    height: '82%',
    maxHeight: 720,
    minHeight: 460,
  },
  sizeTallMobile: {
    height: '88%',
    maxHeight: 760,
    minHeight: 420,
  },
  sizeAuto: {
    maxHeight: '85%',
  },
  header: {
    marginBottom: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexShrink: 0,
  },
  headerMobile: {
    marginBottom: 6,
    paddingBottom: 8,
  },
  headerTitleContainer: {
    position: 'relative',
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 44,
  },
  headerLeftSlot: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 4,
  },
  headerTitleMobile: {
    fontSize: 17,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  headerSubtitleMobile: {
    fontSize: 11,
    lineHeight: 15,
  },
  closeIconButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  closeIconButtonPressed: {
    backgroundColor: '#E2E8F0',
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
    paddingTop: 8,
    paddingBottom: 16,
  },
  footer: {
    flexShrink: 0,
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
});

export default BillingModalShell;

