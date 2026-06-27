module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 moved the worklet runtime into its own package; the plugin
    // must come last in the plugins list.
    plugins: ['react-native-worklets/plugin'],
  };
};
