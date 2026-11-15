// Response headers set on every page and API response by the middleware
// (the CSP is separate: src/lib/csp.ts). Static assets get nosniff from
// next.config.ts, which the middleware's matcher skips.
import {
  HSTS_HEADER,
  HSTS_VALUE,
  HTTPS_URL_PREFIX,
  NOSNIFF_HEADER,
  NOSNIFF_VALUE,
  PERMISSIONS_POLICY_HEADER,
  PERMISSIONS_POLICY_VALUE,
  REFERRER_POLICY_HEADER,
  REFERRER_POLICY_VALUE,
} from "@/constants";

// `authUrl` is AUTH_URL, the app's public origin. HSTS only when that is
// https:// — browsers ignore it over http anyway, and a plain-http demo or
// localhost deployment shouldn't pin anything.
export function securityHeaders(authUrl: string | undefined): [string, string][] {
  const headers: [string, string][] = [
    [NOSNIFF_HEADER, NOSNIFF_VALUE],
    [REFERRER_POLICY_HEADER, REFERRER_POLICY_VALUE],
    [PERMISSIONS_POLICY_HEADER, PERMISSIONS_POLICY_VALUE],
  ];
  if (authUrl?.startsWith(HTTPS_URL_PREFIX)) headers.push([HSTS_HEADER, HSTS_VALUE]);
  return headers;
}
