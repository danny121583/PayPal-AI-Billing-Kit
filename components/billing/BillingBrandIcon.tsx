import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Path } from 'react-native-svg';

export interface BillingBrandIconProps {
  size?: number;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Reusable PayPal AI Billing Kit brand emblem (SVG).
 * Used across the application header, MCP Agent Interface modal, and receipts,
 * matching the browser tab favicon (/public/favicon.svg).
 */
export function BillingBrandIcon({
  size = 28,
  style,
  testID = 'billing-brand-icon',
}: BillingBrandIconProps) {
  return (
    <View style={[styles.container, { width: size, height: size }, style]} testID={testID}>
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Defs>
          <LinearGradient id="ppBrandBg" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#003087" />
            <Stop offset="55%" stopColor="#005EA6" />
            <Stop offset="100%" stopColor="#0070E0" />
          </LinearGradient>
          <LinearGradient id="ppAiSparkle" x1="36" y1="8" x2="56" y2="28" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#38BDF8" />
            <Stop offset="100%" stopColor="#22D3EE" />
          </LinearGradient>
        </Defs>
        <Rect x="2" y="2" width="60" height="60" rx="15" fill="url(#ppBrandBg)" />
        <Rect
          x="3.5"
          y="3.5"
          width="57"
          height="57"
          rx="13.5"
          stroke="#FFFFFF"
          strokeOpacity="0.18"
          strokeWidth="1.5"
        />
        <Path
          d="M17 15C17 13.3431 18.3431 12 20 12H35.5C41.8513 12 46.5 16.2533 46.5 22.2C46.5 28.45 41.45 32.8 34.8 32.8H25.2V45C25.2 46.6569 23.8569 48 22.2 48H18.5C17.6716 48 17 47.3284 17 46.5V15Z"
          fill="#FFFFFF"
        />
        <Path
          d="M25.2 19.2V26.2H33.6C36.65 26.2 38.7 24.55 38.7 22.65C38.7 20.8 36.65 19.2 33.6 19.2H25.2Z"
          fill="#003087"
        />
        <Path
          d="M25.2 35.8H36.8C41.8 35.8 45.5 39.1 45.5 43.8C45.5 48.5 41.8 52 36.8 52H28C26.4536 52 25.2 50.7464 25.2 49.2V35.8Z"
          fill="#38BDF8"
          fillOpacity="0.92"
        />
        <Path
          d="M31.5 44L34.3 46.8L40.2 40.9"
          stroke="#003087"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M49 9L50.6 13.4L55 15L50.6 16.6L49 21L47.4 16.6L43 15L47.4 13.4L49 9Z"
          fill="url(#ppAiSparkle)"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default BillingBrandIcon;
