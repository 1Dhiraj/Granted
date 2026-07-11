const BRAND_ENV_PREFIX = "GRANTED_";
const LEGACY_ENV_PREFIX = "OPENCLAW_";

/**
 * Bridge GRANTED_* env vars onto their legacy OPENCLAW_* names so every internal
 * read keeps working while users configure the product under its own brand.
 * Legacy names still win when both are set (existing installs stay stable).
 */
export function applyGrantedEnvAliases(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of Object.keys(env)) {
    if (!key.startsWith(BRAND_ENV_PREFIX)) {
      continue;
    }
    const legacyKey = LEGACY_ENV_PREFIX + key.slice(BRAND_ENV_PREFIX.length);
    if (env[legacyKey] === undefined) {
      env[legacyKey] = env[key];
    }
  }
}
