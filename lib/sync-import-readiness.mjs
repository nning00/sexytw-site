// Import eligibility is not source presence. Keep EVERY raw source ID in the
// catalogue proof, including these records, so missing media cannot cause removal.
export function partitionImportReadiness(profiles) {
  const ready = [], pendingImages = [];
  for (const profile of profiles) {
    if (Array.isArray(profile.images) && profile.images.length === 0) pendingImages.push(profile);
    else ready.push(profile); // Malformed/nonempty images still hit server validation.
  }
  return { ready, pendingImages };
}
