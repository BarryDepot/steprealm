// Smoothed progress display.
//
// Core Motion delivers step updates in batches rather than one at a time, so a
// bar bound straight to the data lurches forward five to fifteen steps at a
// time. Rather than chase finer-grained data — which the platform does not
// offer — the display is eased towards each new value over a fixed window, so
// a burst reads as a glide.
//
// This is presentation only. The animated value is never read back into game
// state, and the server remains the authority on what the numbers mean.

import { useEffect, useState } from 'react';
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing, runOnJS, useAnimatedReaction, useAnimatedStyle,
  useSharedValue, withTiming,
} from 'react-native-reanimated';

import { palette } from './styles';

// Long enough to read as motion, short enough that the bar has settled before
// the next 5-second flush arrives.
const DURATION_MS = 600;

// Ease-out: quick to acknowledge the new steps, unhurried as it settles.
const EASING = Easing.out(Easing.cubic);

interface ProgressBarProps {
  /** 0..1. Values outside that range are clamped. */
  progress: number;
  height?: number;
  colour?: string;
  style?: StyleProp<ViewStyle>;
}

export function AnimatedProgressBar({
  progress, height = 8, colour = palette.accent, style,
}: ProgressBarProps) {
  // Starts at zero so the bar fills in when the screen is opened rather than
  // appearing already drawn.
  const shared = useSharedValue(0);

  useEffect(() => {
    const clamped = Math.min(1, Math.max(0, progress));
    shared.value = withTiming(clamped, { duration: DURATION_MS, easing: EASING });
  }, [progress, shared]);

  const fill = useAnimatedStyle(() => ({ width: `${shared.value * 100}%` }));

  return (
    <View
      style={[{
        height,
        backgroundColor: palette.panelEdge,
        borderRadius: height / 2,
        marginTop: 8,
        overflow: 'hidden',
      }, style]}
    >
      <Animated.View style={[{ height: '100%', backgroundColor: colour }, fill]} />
    </View>
  );
}

interface CounterProps {
  value: number;
  style?: StyleProp<TextStyle>;
  /** Renders the whole label, so surrounding text counts up with the number. */
  format?: (n: number) => string;
}

/**
 * A number that counts up to its new value over the same window as the bar.
 *
 * The bar animates entirely on the UI thread, but text content is not a style
 * property and cannot, so this mirrors the shared value back to React. The
 * reaction fires only when the rounded value changes, which caps the work at
 * one re-render per frame for the length of the animation.
 */
export function AnimatedCounter({ value, style, format = String }: CounterProps) {
  const shared = useSharedValue(0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    shared.value = withTiming(value, { duration: DURATION_MS, easing: EASING });
  }, [value, shared]);

  useAnimatedReaction(
    () => Math.round(shared.value),
    (rounded, previous) => {
      if (rounded !== previous) runOnJS(setShown)(rounded);
    },
    []
  );

  return <Text style={style}>{format(shown)}</Text>;
}
