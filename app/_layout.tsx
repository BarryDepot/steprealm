// Root navigator.
//
// The three main destinations live in the (tabs) group, so every screen is
// reachable from the tab bar regardless of what any single screen renders.
// Only the live quest view is pushed on top, because it belongs to a quest in
// progress rather than being a place you visit.

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { palette } from '../src/ui/styles';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.bg },
          headerTintColor: palette.accent,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        {/* The tab group draws its own headers. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="activity" options={{ title: 'Active Quest' }} />
      </Stack>
    </>
  );
}
