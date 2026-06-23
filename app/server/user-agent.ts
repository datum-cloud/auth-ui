// app/server/user-agent.ts
//
// Builds the Zitadel UserAgent shape from a Web API Request.
// Ported from the old app's getUserAgent() in apps/login/src/lib/fingerprint.ts
// (commit d78f91a101), adapted for the rebuilt server (no Next.js dependency).
//
// Shape produced (Zitadel v2 UserAgent):
//   { fingerprintId?, ip?, description?, header?: { 'user-agent': { values: string[] } } }
//
// IP extraction reuses the same last-hop XFF strategy as rate-limit.ts:
//   xff.split(',').at(-1)?.trim()
// This is the single source of truth for proxy trust.

export interface ZitadelUserAgent {
  fingerprintId?: string;
  ip?: string;
  description?: string;
  header?: Record<string, { values: string[] }>;
}

// ── Internal UA description builder ─────────────────────────────────────────
//
// Emits a clean, deterministic description from the parsed parts. The OLD
// getUserAgent() format interpolated empty segments, producing dangling commas
// and stray whitespace (`"Chrome, 124,  ,  Blink, 537.36,  macOS, 10.15, "`).
// 755-M1: instead, build only the segments that have content and join them with
// a single separator so the rendered Active-Sessions row reads cleanly.

interface UAParts {
  browserName: string;
  browserVersion: string;
  osName: string;
  osVersion: string;
  engineName: string;
  engineVersion: string;
  deviceType: string;
  deviceVendor: string;
  deviceModel: string;
}

/** Lightweight regex-based UA parser — no external dependency required. */
function parseUA(ua: string): UAParts {
  const parts: UAParts = {
    browserName: '',
    browserVersion: '',
    osName: '',
    osVersion: '',
    engineName: '',
    engineVersion: '',
    deviceType: '',
    deviceVendor: '',
    deviceModel: '',
  };

  // ── Engine ─────────────────────────────────────────────────────────────────
  const edgeHtml = ua.match(/EdgHTML\/([\d.]+)/i);
  const gecko = ua.match(/Gecko\/([\d.]+)/i);
  const webkit = ua.match(/AppleWebKit\/([\d.]+)/i);
  const presto = ua.match(/Presto\/([\d.]+)/i);
  const trident = ua.match(/Trident\/([\d.]+)/i);
  const blink = webkit && ua.includes('Chrome');

  if (blink) {
    parts.engineName = 'Blink';
    parts.engineVersion = webkit[1];
  } else if (edgeHtml) {
    parts.engineName = 'EdgeHTML';
    parts.engineVersion = edgeHtml[1];
  } else if (webkit) {
    parts.engineName = 'WebKit';
    parts.engineVersion = webkit[1];
  } else if (gecko) {
    parts.engineName = 'Gecko';
    parts.engineVersion = gecko[1];
  } else if (presto) {
    parts.engineName = 'Presto';
    parts.engineVersion = presto[1];
  } else if (trident) {
    parts.engineName = 'Trident';
    parts.engineVersion = trident[1];
  }

  // ── OS ─────────────────────────────────────────────────────────────────────
  if (/Windows NT/i.test(ua)) {
    parts.osName = 'Windows';
    const m = ua.match(/Windows NT ([\d.]+)/i);
    parts.osVersion = m ? m[1] : '';
  } else if (/Android/i.test(ua)) {
    parts.osName = 'Android';
    const m = ua.match(/Android ([\d.]+)/i);
    parts.osVersion = m ? m[1] : '';
  } else if (/iPhone OS|CPU OS/i.test(ua)) {
    parts.osName = 'iOS';
    const m = ua.match(/(?:iPhone OS|CPU OS) ([\d_]+)/i);
    parts.osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/Mac OS X/i.test(ua)) {
    parts.osName = 'Mac OS';
    const m = ua.match(/Mac OS X ([\d_.]+)/i);
    parts.osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/Linux/i.test(ua)) {
    parts.osName = 'Linux';
  } else if (/CrOS/i.test(ua)) {
    parts.osName = 'Chrome OS';
  }

  // ── Browser ────────────────────────────────────────────────────────────────
  // Order matters: check specific browsers before generic ones.
  const edgM = ua.match(/Edg\/([\d.]+)/i);
  const opr = ua.match(/OPR\/([\d.]+)/i) || ua.match(/Opera\/([\d.]+)/i);
  const samsung = ua.match(/SamsungBrowser\/([\d.]+)/i);
  const firefox = ua.match(/Firefox\/([\d.]+)/i);
  const safari = ua.match(/Version\/([\d.]+).*Safari/i);
  const chrome = ua.match(/Chrome\/([\d.]+)/i);

  if (edgM) {
    parts.browserName = 'Edge';
    parts.browserVersion = edgM[1];
  } else if (samsung) {
    parts.browserName = 'Samsung Browser';
    parts.browserVersion = samsung[1];
  } else if (opr) {
    parts.browserName = 'Opera';
    parts.browserVersion = opr[1];
  } else if (firefox) {
    parts.browserName = 'Firefox';
    parts.browserVersion = firefox[1];
  } else if (safari && !ua.includes('Chrome')) {
    parts.browserName = 'Safari';
    parts.browserVersion = safari[1];
  } else if (chrome) {
    parts.browserName = 'Chrome';
    parts.browserVersion = chrome[1];
  }

  // ── Device type / vendor / model ──────────────────────────────────────────
  if (/Mobile/i.test(ua)) {
    parts.deviceType = 'mobile';
    if (/iPhone/i.test(ua)) {
      parts.deviceVendor = 'Apple';
      parts.deviceModel = 'iPhone';
    } else if (/iPad/i.test(ua)) {
      // Some iPads report as Mobile
      parts.deviceType = 'tablet';
      parts.deviceVendor = 'Apple';
      parts.deviceModel = 'iPad';
    } else if (/Samsung/i.test(ua)) {
      parts.deviceVendor = 'Samsung';
    }
  } else if (/Tablet|iPad/i.test(ua)) {
    parts.deviceType = 'tablet';
    if (/iPad/i.test(ua)) {
      parts.deviceVendor = 'Apple';
      parts.deviceModel = 'iPad';
    }
  }

  return parts;
}

/**
 * 755-M1 (revised — byte-match the OLD auth-ui): reproduce the OLD `lib/fingerprint.ts`
 * `description` shape so cloud-portal's session gateway (which parsed the OLD payload to populate
 * the Active-Sessions browser/OS columns) behaves identically. The OLD emitted four comma-joined
 * `"name, version, "` groups in browser/device/engine/OS order, with EMPTY segments preserved.
 * The cleaner `" · "` form regressed the portal's OS column (FINDINGS Run-4 / FIX-REGISTER 755-M1).
 * NOTE: the field the gateway actually parses is the raw `header['user-agent']` values (also
 * restored to the OLD comma-split in `userAgentFromRequest`); this description is matched for parity.
 */
function buildDescription(p: UAParts): string {
  const browser = `${p.browserName ? `${p.browserName},` : ''} ${p.browserVersion ? `${p.browserVersion},` : ''} `;
  const device = `${p.deviceType ? `${p.deviceType},` : ''} ${p.deviceVendor ? `${p.deviceVendor},` : ''} ${p.deviceModel ? `${p.deviceModel},` : ''} `;
  const engine = `${p.engineName ? `${p.engineName},` : ''} ${p.engineVersion ? `${p.engineVersion},` : ''} `;
  const os = `${p.osName ? `${p.osName},` : ''} ${p.osVersion ? `${p.osVersion},` : ''} `;
  return `${browser}, ${device}, ${engine}, ${os}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a Zitadel v2 UserAgent object from a Web API Request.
 *
 * - header: maps `user-agent` → `{ values: [ua] }` (Zitadel proto format)
 * - ip: last-hop from `x-forwarded-for` (same proxy-trust model as rate-limit.ts)
 * - description: browser/device/engine/OS parsed from the UA string
 * - fingerprintId: passed through as-is
 *
 * Empty fields are omitted from the returned object.
 */
export function userAgentFromRequest(request: Request, fingerprintId?: string): ZitadelUserAgent {
  const result: ZitadelUserAgent = {};

  // fingerprintId passthrough
  if (fingerprintId) {
    result.fingerprintId = fingerprintId;
  }

  // IP: last-hop XFF — mirrors the rate-limit middleware strategy exactly.
  const xff = request.headers.get('x-forwarded-for') ?? '';
  const ip = xff.split(',').at(-1)?.trim() || '';
  if (ip) {
    result.ip = ip;
  }

  // UA header → header shape + description
  const ua = request.headers.get('user-agent');
  if (ua) {
    // 755-M1: byte-match the OLD payload. The OLD lib/fingerprint.ts sent the raw UA
    // comma-SPLIT (`userAgentHeader.split(',')`), and cloud-portal's session gateway parses
    // THIS field (not `description`) into the Active-Sessions browser/OS columns. The rebuild's
    // single-value `[ua]` shape regressed that column — restore the comma-split.
    result.header = { 'user-agent': { values: ua.split(',') } };

    result.description = buildDescription(parseUA(ua));
  }

  return result;
}
