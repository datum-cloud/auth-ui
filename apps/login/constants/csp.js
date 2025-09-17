/**
 * Content Security Policy (CSP) Configuration
 *
 * This configuration defines the security policy for the application,
 * controlling which resources can be loaded and executed.
 */

// Highly permissive CSP - allows most external resources while maintaining basic security
const CSP_DIRECTIVES = {
  // Allow resources from anywhere but maintain some basic protections
  "default-src": [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "data:",
    "https:",
    "http:",
  ],

  // Allow scripts from anywhere
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https:",
    "http:",
    "data:",
  ],

  // Allow connections to anywhere
  "connect-src": ["'self'", "https:", "http:", "ws:", "wss:"],

  // Allow images from anywhere
  "img-src": ["'self'", "https:", "http:", "data:", "blob:"],

  // Allow styles from anywhere
  "style-src": ["'self'", "'unsafe-inline'", "https:", "http:"],

  // Allow fonts from anywhere
  "font-src": ["'self'", "https:", "http:", "data:"],

  // Still block object/embed for basic security
  "object-src": ["'none'"],

  // Allow frames from anywhere
  "frame-src": ["'self'", "https:", "http:"],

  // Allow child frames from anywhere
  "child-src": ["'self'", "https:", "http:"],
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
      return `${directive} ${sources.join(" ")};`;
    })
    .join(" ");
}

// Export the built CSP policy
export const DEFAULT_CSP = buildCSP();
