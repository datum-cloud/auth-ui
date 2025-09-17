/**
 * Content Security Policy (CSP) Configuration
 * 
 * This configuration defines the security policy for the application,
 * controlling which resources can be loaded and executed.
 */

// Third-party services domains
const THIRD_PARTY_DOMAINS = {
  // Analytics
  FATHOM_CDN: 'https://*.usefathom.com',
  FATHOM_API: 'https://*.usefathom.com',
  
  // User feedback and support
  MARKER_CDN: 'https://*.marker.io',
  MARKER_API: 'https://*.marker.io',
  
  // General
  VERCEL_IMAGES: 'https://vercel.com',
};

// CSP directive configuration
const CSP_DIRECTIVES = {
  // Default policy for all resources
  'default-src': ["'self'"],
  
  // JavaScript sources
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Required for Next.js
    "'unsafe-eval'",   // Required for development
    THIRD_PARTY_DOMAINS.FATHOM_CDN,
    THIRD_PARTY_DOMAINS.MARKER_CDN,
  ],
  
  // Network connections (fetch, XHR, WebSocket, etc.)
  'connect-src': [
    "'self'",
    THIRD_PARTY_DOMAINS.FATHOM_API,
    THIRD_PARTY_DOMAINS.MARKER_CDN,
    THIRD_PARTY_DOMAINS.MARKER_API,
  ],
  
  // Image sources
  'img-src': [
    "'self'",
    THIRD_PARTY_DOMAINS.VERCEL_IMAGES,
    THIRD_PARTY_DOMAINS.FATHOM_CDN,
  ],
  
  // CSS sources
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Required for styled-components and inline styles
  ],
  
  // Font sources
  'font-src': ["'self'"],
  
  // Object sources (plugins)
  'object-src': ["'none'"],
  
  // Child frames (empty means no restrictions)
  'child-src': [],
};

/**
 * Builds the CSP string from the directive configuration
 * @returns {string} Complete CSP policy string
 */
function buildCSP() {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => {
      if (sources.length === 0) {
        return `${directive};`;
      }
      return `${directive} ${sources.join(' ')};`;
    })
    .join(' ');
}

// Export the built CSP policy
export const DEFAULT_CSP = buildCSP();
