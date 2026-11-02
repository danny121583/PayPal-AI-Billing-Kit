module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules(?!(/|\\\\).bun/)/(?!(.pnpm|react-native|@react-native|@react-native-community|@react-native/js-polyfills|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|lucide-react-native|react-native-svg))',
  ],
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/supabase/functions/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@paypal-ai-billing-kit/sdk$': '<rootDir>/packages/paypal-billing-kit/src/index.ts',
  },
};
