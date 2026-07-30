// The three permanent destinations.
//
// These were previously reached by buttons rendered at the bottom of the
// quests screen, which meant a screen's reachability depended on another
// screen's markup. A tab bar makes each destination structural: nothing an
// edit does to one screen can orphan another.

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { town } from '../../src/content/starterRegion';
import { palette } from '../../src/ui/styles';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.accent,
        headerTitleStyle: { fontWeight: '700' },
        sceneStyle: { backgroundColor: palette.bg },
        tabBarStyle: {
          backgroundColor: palette.panel,
          borderTopColor: palette.panelEdge,
        },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textDim,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Quests',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="world"
        options={{
          title: 'World',
          headerTitle: 'The Realm',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="earth-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="forge"
        options={{
          // Tab label stays short; the header names the town it sits in.
          title: 'Forge',
          headerTitle: town.name,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="hammer-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
