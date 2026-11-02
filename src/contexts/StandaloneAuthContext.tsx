import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '@/src/lib/supabase';

export type DemoAccountKey = 'sarah_jenkins' | 'alex_rivera' | 'jordan_taylor';

export interface DemoAccountPreset {
  key: DemoAccountKey;
  id: string;
  fullName: string;
  shortLabel: string;
  email: string;
  password: string;
  accountRole: 'provider' | 'customer';
  roleScope: 'doctor' | 'patient';
  organizationName: string;
  badgeText: string;
}

export const DEMO_ACCOUNT_PRESETS: Record<DemoAccountKey, DemoAccountPreset> = {
  sarah_jenkins: {
    key: 'sarah_jenkins',
    id: '11111111-1111-4111-8111-111111111101',
    fullName: 'Dr. Sarah Jenkins',
    shortLabel: 'Provider: Dr. Sarah Jenkins',
    email: 'sarah.jenkins@demo.paypal-billing-kit.local',
    password: 'DemoPayPalKit2026!',
    accountRole: 'provider',
    roleScope: 'doctor',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    badgeText: 'Provider Account',
  },
  alex_rivera: {
    key: 'alex_rivera',
    id: '11111111-1111-4111-8111-111111111102',
    fullName: 'Alex Rivera',
    shortLabel: 'Customer: Alex Rivera',
    email: 'alex.rivera@demo.paypal-billing-kit.local',
    password: 'DemoPayPalKit2026!',
    accountRole: 'customer',
    roleScope: 'patient',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    badgeText: 'Customer #1',
  },
  jordan_taylor: {
    key: 'jordan_taylor',
    id: '11111111-1111-4111-8111-111111111103',
    fullName: 'Jordan Taylor',
    shortLabel: 'Customer: Jordan Taylor',
    email: 'jordan.taylor@demo.paypal-billing-kit.local',
    password: 'DemoPayPalKit2026!',
    accountRole: 'customer',
    roleScope: 'patient',
    organizationName: 'Jenkins Wellness & Telehealth Practice',
    badgeText: 'Customer #2',
  },
};

export interface StandaloneUserProfile {
  id: string;
  email: string;
  full_name: string;
  user_type: 'doctor' | 'patient';
  account_role: 'provider' | 'customer';
  organization_name: string;
}

interface StandaloneAuthContextValue {
  user: { id: string; email: string } | null;
  profile: StandaloneUserProfile | null;
  activeAccountKey: DemoAccountKey;
  activePreset: DemoAccountPreset;
  isSwitchingAccount: boolean;
  authError: string | null;
  switchDemoAccount: (key: DemoAccountKey) => Promise<void>;
  signInWithCredentials: (email: string, password: string) => Promise<boolean>;
}

const StandaloneAuthContext = createContext<StandaloneAuthContextValue>({
  user: {
    id: DEMO_ACCOUNT_PRESETS.sarah_jenkins.id,
    email: DEMO_ACCOUNT_PRESETS.sarah_jenkins.email,
  },
  profile: {
    id: DEMO_ACCOUNT_PRESETS.sarah_jenkins.id,
    email: DEMO_ACCOUNT_PRESETS.sarah_jenkins.email,
    full_name: DEMO_ACCOUNT_PRESETS.sarah_jenkins.fullName,
    user_type: 'doctor',
    account_role: 'provider',
    organization_name: DEMO_ACCOUNT_PRESETS.sarah_jenkins.organizationName,
  },
  activeAccountKey: 'sarah_jenkins',
  activePreset: DEMO_ACCOUNT_PRESETS.sarah_jenkins,
  isSwitchingAccount: false,
  authError: null,
  switchDemoAccount: async () => {},
  signInWithCredentials: async () => false,
});

export function StandaloneAuthProvider({ children }: { children: React.ReactNode }) {
  const [activeAccountKey, setActiveAccountKey] = useState<DemoAccountKey>('sarah_jenkins');
  const [user, setUser] = useState<{ id: string; email: string } | null>({
    id: DEMO_ACCOUNT_PRESETS.sarah_jenkins.id,
    email: DEMO_ACCOUNT_PRESETS.sarah_jenkins.email,
  });
  const [profile, setProfile] = useState<StandaloneUserProfile | null>({
    id: DEMO_ACCOUNT_PRESETS.sarah_jenkins.id,
    email: DEMO_ACCOUNT_PRESETS.sarah_jenkins.email,
    full_name: DEMO_ACCOUNT_PRESETS.sarah_jenkins.fullName,
    user_type: 'doctor',
    account_role: 'provider',
    organization_name: DEMO_ACCOUNT_PRESETS.sarah_jenkins.organizationName,
  });
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const applyPresetState = useCallback((preset: DemoAccountPreset, realUserId?: string) => {
    const resolvedId = realUserId || preset.id;
    setActiveAccountKey(preset.key);
    setUser({ id: resolvedId, email: preset.email });
    setProfile({
      id: resolvedId,
      email: preset.email,
      full_name: preset.fullName,
      user_type: preset.roleScope,
      account_role: preset.accountRole,
      organization_name: preset.organizationName,
    });
  }, []);

  const switchDemoAccount = useCallback(
    async (key: DemoAccountKey) => {
      const preset = DEMO_ACCOUNT_PRESETS[key];
      if (!preset) return;
      setIsSwitchingAccount(true);
      setAuthError(null);
      // Apply preset immediately for responsive UI, then establish real Supabase JWT session
      applyPresetState(preset);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: preset.email,
          password: preset.password,
        });
        if (error) {
          setAuthError(error.message);
        } else if (data?.user?.id) {
          applyPresetState(preset, data.user.id);
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Could not sign in to demo account.');
      } finally {
        setIsSwitchingAccount(false);
      }
    },
    [applyPresetState]
  );

  const signInWithCredentials = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setIsSwitchingAccount(true);
      setAuthError(null);
      try {
        const cleanEmail = email.trim().toLowerCase();
        const matchedPreset = Object.values(DEMO_ACCOUNT_PRESETS).find(
          (p) => p.email.toLowerCase() === cleanEmail
        );
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (error || !data?.user) {
          setAuthError(error?.message || 'Invalid credentials');
          return false;
        }
        if (matchedPreset) {
          applyPresetState(matchedPreset, data.user.id);
        } else {
          const { data: acc } = await supabase
            .from('billing_accounts')
            .select('*')
            .eq('id', data.user.id)
            .maybeSingle();
          const isProvider = acc?.account_role === 'provider';
          setUser({ id: data.user.id, email: data.user.email || cleanEmail });
          setProfile({
            id: data.user.id,
            email: data.user.email || cleanEmail,
            full_name: acc?.full_name || cleanEmail,
            user_type: isProvider ? 'doctor' : 'patient',
            account_role: isProvider ? 'provider' : 'customer',
            organization_name: acc?.organization_name || 'Practice Billing',
          });
        }
        return true;
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Sign-in failed');
        return false;
      } finally {
        setIsSwitchingAccount(false);
      }
    },
    [applyPresetState]
  );

  useEffect(() => {
    let initialKey: DemoAccountKey = 'sarah_jenkins';
    if (typeof window !== 'undefined' && window.location?.search) {
      const sp = new URLSearchParams(window.location.search);
      const acc = sp.get('account');
      if (acc === 'sarah_jenkins' || acc === 'alex_rivera' || acc === 'jordan_taylor') {
        initialKey = acc;
      }
    }
    void switchDemoAccount(initialKey);
  }, [switchDemoAccount]);

  return (
    <StandaloneAuthContext.Provider
      value={{
        user,
        profile,
        activeAccountKey,
        activePreset: DEMO_ACCOUNT_PRESETS[activeAccountKey],
        isSwitchingAccount,
        authError,
        switchDemoAccount,
        signInWithCredentials,
      }}
    >
      {children}
    </StandaloneAuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(StandaloneAuthContext);
}
