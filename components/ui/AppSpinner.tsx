import React from 'react';
import { ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';

export interface AppSpinnerProps {
  size?: 'small' | 'large' | number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AppSpinner({
  size = 'small',
  color = '#F59E0B',
  style,
  testID = 'app-spinner',
}: AppSpinnerProps) {
  return (
    <ActivityIndicator
      size={typeof size === 'number' ? (size > 24 ? 'large' : 'small') : size}
      color={color}
      style={style}
      testID={testID}
    />
  );
}

export default AppSpinner;
