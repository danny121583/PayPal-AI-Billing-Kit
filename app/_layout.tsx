import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StandaloneAuthProvider } from '../src/contexts/StandaloneAuthContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StandaloneAuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#F8F9FC' },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'PayPal AI Billing Kit' }} />
          <Stack.Screen name="billing" options={{ title: 'PayPal AI Billing Kit' }} />
        </Stack>
      </StandaloneAuthProvider>
    </SafeAreaProvider>
  );
}
