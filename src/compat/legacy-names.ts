export const PROJECT_NAME = "granted" as const;

export const LEGACY_PROJECT_NAMES = ["openclaw"] as const;

export const MANIFEST_KEY = PROJECT_NAME;

export const LEGACY_MANIFEST_KEYS = LEGACY_PROJECT_NAMES;

/** All accepted package.json manifest keys, current name first. */
export const MANIFEST_KEYS = [MANIFEST_KEY, ...LEGACY_MANIFEST_KEYS] as const;

export type AnyManifestKey = (typeof MANIFEST_KEYS)[number];

/**
 * Read the project's manifest block from a package.json-like record, accepting
 * the current key ("granted") and legacy keys ("openclaw") so existing plugin
 * packages keep installing and loading unchanged.
 */
export function readProjectManifestField<T>(
  record: Partial<Record<AnyManifestKey, T>> | null | undefined,
): T | undefined {
  if (!record) {
    return undefined;
  }
  const asRecord = record as Partial<Record<string, T>>;
  for (const key of MANIFEST_KEYS) {
    const value = asRecord[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export const LEGACY_PLUGIN_MANIFEST_FILENAMES = ["openclaw.plugin.json"] as const;

export const LEGACY_CANVAS_HANDLER_NAMES = [] as const;

export const MACOS_APP_SOURCES_DIR = "apps/macos/Sources/OpenClaw" as const;

export const LEGACY_MACOS_APP_SOURCES_DIRS = [] as const;
