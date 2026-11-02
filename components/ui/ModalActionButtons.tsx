import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { AppSpinner } from './AppSpinner';
import { shadow } from '../../src/lib/shadow';

export type ModalActionVariant =
  | 'cancel'
  | 'primary'
  | 'secondary'
  | 'destructive'
  | 'success'
  | 'warning';

export interface ModalActionButtonConfig {
  label: string;
  onPress: () => void;
  variant?: ModalActionVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  buttonStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export interface ModalActionButtonsProps {
  actions: ModalActionButtonConfig[];
  layout?: 'row' | 'column';
  containerStyle?: StyleProp<ViewStyle>;
  equalHeight?: boolean;
}

const VARIANT_STYLES: Record<
  ModalActionVariant,
  {
    backgroundColor: string;
    borderColor?: string;
    borderWidth?: number;
    textColor: string;
    spinnerColor: string;
    shadowStyle?: ViewStyle;
  }
> = {
  cancel: {
    backgroundColor: '#F3F4F6',
    textColor: '#374151',
    spinnerColor: '#374151',
  },
  secondary: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    textColor: '#374151',
    spinnerColor: '#374151',
  },
  primary: {
    backgroundColor: '#2563EB',
    textColor: '#FFFFFF',
    spinnerColor: '#FFFFFF',
    shadowStyle: shadow({ color: '#2563EB', opacity: 0.2, radius: 6, y: 2, elevation: 2 }),
  },
  destructive: {
    backgroundColor: '#EF4444',
    textColor: '#FFFFFF',
    spinnerColor: '#FFFFFF',
    shadowStyle: shadow({ color: '#EF4444', opacity: 0.2, radius: 6, y: 2, elevation: 2 }),
  },
  success: {
    backgroundColor: '#22C55E',
    textColor: '#FFFFFF',
    spinnerColor: '#FFFFFF',
    shadowStyle: shadow({ color: '#22C55E', opacity: 0.25, radius: 6, y: 2, elevation: 2 }),
  },
  warning: {
    backgroundColor: '#F59E0B',
    textColor: '#FFFFFF',
    spinnerColor: '#FFFFFF',
    shadowStyle: shadow({ color: '#EA580C', opacity: 0.25, radius: 6, y: 2, elevation: 2 }),
  },
};

export function ModalActionButtons({
  actions,
  layout,
  containerStyle,
  equalHeight = true,
}: ModalActionButtonsProps) {
  // 1x3 Grid Rule: >2 buttons automatically stack vertically in a 1x3 column
  const effectiveLayout: 'row' | 'column' =
    layout ?? (actions.length > 2 ? 'column' : 'row');
  const isRow = effectiveLayout === 'row';

  return (
    <View
      style={[
        styles.container,
        isRow ? styles.rowLayout : styles.columnLayout,
        isRow && equalHeight && styles.equalHeightRow,
        containerStyle,
      ]}
    >
      {actions.map((action, index) => {
        const variant = action.variant ?? 'primary';
        const palette = VARIANT_STYLES[variant];
        const isDisabled = Boolean(action.disabled || action.loading);

        return (
          <Pressable
            key={`${action.label}-${index}`}
            style={({ pressed }) => [
              styles.buttonBase,
              isRow ? styles.rowButton : styles.columnButton,
              {
                backgroundColor: palette.backgroundColor,
                borderColor: palette.borderColor,
                borderWidth: palette.borderWidth ?? 0,
              },
              palette.shadowStyle,
              pressed && !isDisabled && styles.buttonPressed,
              isDisabled && styles.buttonDisabled,
              action.buttonStyle,
            ]}
            onPress={action.onPress}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            accessibilityState={{ disabled: isDisabled, busy: Boolean(action.loading) }}
            testID={action.testID}
          >
            {action.loading ? (
              <AppSpinner size={18} color={palette.spinnerColor} />
            ) : (
              <View style={styles.contentRow}>
                {action.icon}
                <Text
                  style={[
                    styles.buttonText,
                    { color: palette.textColor },
                    action.textStyle,
                  ]}
                  numberOfLines={2}
                >
                  {action.label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 12,
  },
  rowLayout: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  equalHeightRow: {
    alignItems: 'stretch',
  },
  columnLayout: {
    flexDirection: 'column',
  },
  buttonBase: {
    minHeight: 48,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowButton: {
    flex: 1,
  },
  columnButton: {
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});

export default ModalActionButtons;
