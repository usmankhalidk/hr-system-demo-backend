import crypto from 'crypto';

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function normalizeObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

export function computeDeviceProfileHash(metadata: unknown): string | null {
  const root = normalizeObject(metadata);
  const browser = normalizeObject(root.browser);
  const os = normalizeObject(root.os);
  const device = normalizeObject(root.device);
  const screen = normalizeObject(root.screen);

  const profile = {
    userAgent: normalizeText(root.userAgent),
    browserName: normalizeText(browser.name),
    browserVersion: normalizeText(browser.version),
    osName: normalizeText(os.name),
    osVersion: normalizeText(os.version),
    deviceModel: normalizeText(device.model),
    deviceVendor: normalizeText(device.vendor),
    deviceType: normalizeText(device.type),
    language: normalizeText(root.language),
    timezone: normalizeText(root.timezone),
    platform: normalizeText(root.platform),
    vendor: normalizeText(root.vendor),
    hardwareConcurrency: normalizeNumber(root.hardwareConcurrency),
    deviceMemory: normalizeNumber(root.deviceMemory),
    maxTouchPoints: normalizeNumber(root.maxTouchPoints),
    screenWidth: normalizeNumber(screen.width),
    screenHeight: normalizeNumber(screen.height),
    screenColorDepth: normalizeNumber(screen.colorDepth),
    screenPixelRatio: normalizeNumber(screen.pixelRatio),
  };

  const populatedCount = Object.values(profile).filter((value) => value !== null).length;
  if (populatedCount < 6) {
    return null;
  }

  return crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

function hashStableIdentifier(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pickNestedText(root: Record<string, any>, paths: string[][]): string | null {
  for (const path of paths) {
    let current: unknown = root;
    for (const key of path) {
      current = normalizeObject(current)[key];
    }
    const value = normalizeText(current);
    if (value) return value;
  }
  return null;
}

export function resolveStableDeviceIdentifier(metadata: unknown, fallbackToken?: string | null): string | null {
  const root = normalizeObject(metadata);
  const nativeIdentifier = pickNestedText(root, [
    ['stableDevice', 'nativeId'],
    ['stableDevice', 'identifier'],
    ['nativeDeviceId'],
    ['deviceIdentifier'],
    ['deviceId'],
    ['androidId'],
    ['iosVendorId'],
    ['identifierForVendor'],
  ]);

  if (nativeIdentifier) {
    return `native:${hashStableIdentifier(nativeIdentifier)}`;
  }

  const stableDevice = normalizeObject(root.stableDevice);
  const stableHash = normalizeText(stableDevice.hash);
  if (stableHash) {
    return `profile:${stableHash}`;
  }

  const profileHash = getStoredDeviceProfileHash(metadata);
  if (profileHash) {
    return `profile:${profileHash}`;
  }

  return fallbackToken ? `fingerprint:${fallbackToken}` : null;
}

export function resolveStableDeviceIdentifierFromFingerprint(fingerprint: unknown, fallbackToken?: string | null): string | null {
  const rawFingerprint = normalizeText(fingerprint);
  if (rawFingerprint?.startsWith('web-profile-v1:')) {
    const profileHash = rawFingerprint.slice('web-profile-v1:'.length).trim();
    if (/^[a-f0-9]{32,64}$/.test(profileHash)) {
      return `profile:${profileHash}`;
    }
  }

  return fallbackToken ? `fingerprint:${fallbackToken}` : null;
}

export function getStoredDeviceProfileHash(metadata: unknown): string | null {
  const root = normalizeObject(metadata);
  const deviceProfile = normalizeObject(root.deviceProfile);
  return normalizeText(deviceProfile.hash) ?? computeDeviceProfileHash(metadata);
}

export function withDeviceProfileHash<T>(metadata: T): T {
  const root = normalizeObject(metadata);
  const hash = computeDeviceProfileHash(root);
  if (!hash) {
    return root as T;
  }

  const deviceProfile = normalizeObject(root.deviceProfile);
  return {
    ...root,
    deviceProfile: {
      ...deviceProfile,
      hash,
    },
  } as T;
}
