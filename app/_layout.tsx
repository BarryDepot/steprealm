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
        <Stack.Screen name="index"      options={{ title: 'StepRealm' }} />
        <Stack.Screen name="activity"   options={{ title: 'Active' }} />
        <Stack.Screen name="inventory"  options={{ title: 'Inventory' }} />
        <Stack.Screen name="forge"      options={{ title: 'Forge' }} />
      </Stack>
    </>
  );
}
