// app/shared/custom-request-headers.ts
//
// Parser for ZITADEL_CUSTOM_REQUEST_HEADERS: comma-separated `Name:Value` pairs.
// Lives in the shared leaf so the env schema (app/server/infra) and the Zitadel transport
// (app/modules/auth/providers/zitadel) validate and apply the value with the SAME rules.
//
// Format limits: entries are separated by ',', so a header value cannot contain a comma.
// A value may contain ':' (a URL, a host:port) because only the FIRST ':' separates the name.

export type RequestHeaderPair = readonly [name: string, value: string];

export interface ParsedRequestHeaders {
  headers: RequestHeaderPair[];
  /** Entries that are not a usable `Name:Value` pair, trimmed, in input order. */
  malformed: string[];
}

// RFC 9110 field-name token.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// No control characters in a field value (CR/LF would be header injection).
// eslint-disable-next-line no-control-regex
const HEADER_VALUE_FORBIDDEN = /[\u0000-\u001f\u007f]/;

/**
 * Split a raw `Name:Value,Name:Value` string into header pairs. Blank entries (a trailing or
 * doubled comma) are ignored. An entry with no ':', an empty or invalid name, or an empty
 * value is reported in `malformed` instead of being dropped silently.
 */
export function parseCustomRequestHeaders(raw: string | undefined): ParsedRequestHeaders {
  const headers: RequestHeaderPair[] = [];
  const malformed: string[] = [];
  for (const segment of (raw ?? '').split(',')) {
    const entry = segment.trim();
    if (!entry) continue;
    const separator = entry.indexOf(':');
    const name = separator === -1 ? '' : entry.slice(0, separator).trim();
    const value = separator === -1 ? '' : entry.slice(separator + 1).trim();
    if (!HEADER_NAME.test(name) || !value || HEADER_VALUE_FORBIDDEN.test(value)) {
      malformed.push(entry);
      continue;
    }
    headers.push([name, value]);
  }
  return { headers, malformed };
}
