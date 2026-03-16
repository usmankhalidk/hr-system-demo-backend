import type { TFunction } from 'i18next';

/**
 * Extracts the backend error `code` from an Axios error response and returns
 * the corresponding i18n string. Falls back to `fallback` (if provided) or
 * the generic `errors.DEFAULT` key.
 *
 * Usage:
 *   catch (err) {
 *     setError(translateApiError(err, t));
 *   }
 */
/**
 * Returns `null` for request cancellations (ERR_CANCELED) so callers can
 * skip state updates entirely: `const msg = translateApiError(...); if (msg) setError(msg);`
 */
export function translateApiError(
  err: unknown,
  t: TFunction,
  fallback?: string,
): string | null {
  const axiosErr = err as {
    response?: { data?: { code?: string } };
    code?: string;
    message?: string;
  };

  // Silently swallow request cancellations (AbortController / Axios cancel)
  if (axiosErr?.code === 'ERR_CANCELED') {
    return null;
  }

  // Network error — no response from server
  const isNetworkError =
    !axiosErr?.response &&
    (axiosErr?.code === 'ERR_NETWORK' ||
      axiosErr?.code === 'ECONNABORTED' ||
      axiosErr?.message === 'Network Error');

  if (isNetworkError) {
    return (t as (key: string) => string)('errors.NETWORK_ERROR');
  }

  const code = axiosErr?.response?.data?.code;

  if (code && typeof code === 'string') {
    // Use defaultValue so i18next returns the fallback when the key is absent
    // rather than the key string itself — works regardless of fallbackLng config.
    const translated = (t as (key: string, opts: { defaultValue: string }) => string)(
      `errors.${code}`,
      { defaultValue: '' },
    );
    if (translated) return translated;
  }

  return fallback ?? (t as (key: string) => string)('errors.DEFAULT');
}
