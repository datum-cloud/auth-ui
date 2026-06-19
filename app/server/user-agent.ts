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
// This is the single source of truth for proxy trust (CODE-MAJ-13 constraint).

export interface ZitadelUserAgent {
  fingerprintId?: string;
  ip?: string;
  description?: string;
  header?: Record<string, { values: string[] }>;
}

// ── Internal UA description builder ─────────────────────────────────────────
//
// Mirrors the old getUserAgent() shape:
//   `${browserDescription}, ${deviceDescription}, ${engineDescription}, ${osDescription}`
//
// Each segment is built as the old code built it:
//   `${name ? `${name},` : ''} ${version ? `${version},` : ''} `
// Empty segments still produce whitespace — this preserves the old format exactly.

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
    parts.osName = 'macOS';
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
 * Builds the description string matching the old getUserAgent() format:
 *   `${browserDescription}, ${deviceDescription}, ${engineDescription}, ${osDescription}`
 *
 * Each sub-description follows the original pattern:
 *   `${name ? `${name},` : ''} ${version ? `${version},` : ''} `
 */
function buildDescription(p: UAParts): string {
  const browserDescription = `${p.browserName ? `${p.browserName},` : ''} ${p.browserVersion ? `${p.browserVersion},` : ''} `;
  const deviceDescription = `${p.deviceType ? `${p.deviceType},` : ''} ${p.deviceVendor ? `${p.deviceVendor},` : ''} ${p.deviceModel ? `${p.deviceModel},` : ''} `;
  const engineDescription = `${p.engineName ? `${p.engineName},` : ''} ${p.engineVersion ? `${p.engineVersion},` : ''} `;
  const osDescription = `${p.osName ? `${p.osName},` : ''} ${p.osVersion ? `${p.osVersion},` : ''} `;

  return `${browserDescription}, ${deviceDescription}, ${engineDescription}, ${osDescription}`;
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
    result.header = { 'user-agent': { values: [ua] } };

    const parts = parseUA(ua);
    const description = buildDescription(parts);
    // Only attach description if it contains something beyond whitespace/commas.
    if (description.replace(/[\s,]/g, '').length > 0) {
      result.description = description;
    }
  }

  return result;
}
