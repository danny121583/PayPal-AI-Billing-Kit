import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const STANDALONE_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://dvzfesfvefggnunkjhom.supabase.co';

export const STANDALONE_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2emZlc2Z2ZWZnZ251bmtqaG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NTQyMzMsImV4cCI6MjEwOTAzMDIzM30.2tR5MsIMnCBrLvvhE1mgC-nbOPIhDbdkU0cGFs1x4PA';

const isWeb = Platform.OS === 'web';

const customStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (isWeb) {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
        return null;
      }
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (isWeb) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
        }
        return;
      }
      await AsyncStorage.setItem(key, value);
    } catch {
      // Ignore storage write errors in headless test environments
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (isWeb) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
        return;
      }
      await AsyncStorage.removeItem(key);
    } catch {
      // Ignore storage remove errors
    }
  },
};

export const supabase = createClient(
  STANDALONE_SUPABASE_URL,
  STANDALONE_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: customStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
