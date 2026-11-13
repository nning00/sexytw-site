export function assertPresenceCapability(result, required) {
  if (required && (result?.presenceVersion !== 3 || result?.presenceSchemaReady !== true)) {
    throw new Error("Presence v3 is not ready; no profiles were sent.");
  }
}
