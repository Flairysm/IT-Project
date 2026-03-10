// Merge with app.json and ensure extra.eas.projectId is set for push notifications.
// Set EXPO_PUBLIC_EAS_PROJECT_ID in .env, or run `npx eas init` to add projectId to app.json.
module.exports = ({ config }) => {
  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    config?.extra?.eas?.projectId;
  return {
    ...config,
    plugins: [...(config.plugins || []), "@react-native-community/datetimepicker"],
    extra: {
      ...config?.extra,
      eas: {
        ...(config?.extra?.eas || {}),
        ...(projectId ? { projectId } : {}),
      },
    },
  };
};
