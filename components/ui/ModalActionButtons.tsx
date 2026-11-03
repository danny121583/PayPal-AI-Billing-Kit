import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
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
  const { width: windowWidth } = useWindowDimensions();
  const isWideEnoughForThreeInRow = windowWidth >= 520;

  const renderSingleButton = (
    action: ModalActionButtonConfig,
    index: number,
    isRowItem: boolean
  ) => {
    const variant = action.variant ?? 'primary';
    const palette = VARIANT_STYLES[variant];
    const isDisabled = Boolean(action.disabled || action.loading);

    return (
      <Pressable
        key={`${action.label}-${index}`}
        style={({ pressed }) => [
          styles.buttonBase,
          isRowItem ? styles.rowButton : styles.columnButton,
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
  };

  // Responsive 3-button layout when layout prop is not explicitly forced:
  // - >= 520px: single clean horizontal row of 3 equal-height buttons
  // - < 520px: compact 2-row grid (secondary actions side-by-side on row 1, primary action full-width on row 2)
  if (!layout && actions.length === 3 && !isWideEnoughForThreeInRow) {
    return (
      <View style={[styles.container, styles.columnLayout, containerStyle]}>
        <View style={[styles.rowLayout, equalHeight && styles.equalHeightRow, { gap: 10 }]}>
          {renderSingleButton(actions[0], 0, true)}
          {renderSingleButton(actions[1], 1, true)}
        </View>
        {renderSingleButton(actions[2], 2, false)}
      </View>
    );
  }

  const effectiveLayout: 'row' | 'column' =
    layout ?? (actions.length <= 2 || (actions.length === 3 && isWideEnoughForThreeInRow) ? 'row' : 'column');
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
      {actions.map((action, index) => renderSingleButton(action, index, isRow))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 10,
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
    minHeight: 46,
    paddingVertical: 11,
    paddingHorizontal: 14,
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
    gap: 7,
  },
  buttonText: {
    fontSize: 14,
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
