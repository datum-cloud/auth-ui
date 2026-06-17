import {
  resolveFathomSiteId,
  FathomAnalytics,
  TrackOnMount,
  trackAuthEvent,
} from '@/modules/analytics/fathom';
import { render } from '@testing-library/react';
import { load, trackPageview, trackEvent } from 'fathom-client';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

vi.mock('fathom-client', () => ({
  load: vi.fn(),
  trackPageview: vi.fn(),
  trackEvent: vi.fn(),
}));

describe('resolveFathomSiteId', () => {
  it('returns the id in production when set', () => {
    expect(resolveFathomSiteId('production', 'SITE123')).toBe('SITE123');
  });

  it('returns undefined in production when the id is unset', () => {
    expect(resolveFathomSiteId('production', undefined)).toBeUndefined();
  });

  it('returns undefined outside production even when the id is set', () => {
    expect(resolveFathomSiteId('development', 'SITE123')).toBeUndefined();
    expect(resolveFathomSiteId('test', 'SITE123')).toBeUndefined();
  });
});

describe('FathomAnalytics', () => {
  it('does not load or track when siteId is absent', () => {
    const Stub = createRoutesStub([{ path: '*', Component: () => <FathomAnalytics /> }]);
    render(<Stub initialEntries={['/login']} />);
    expect(load).not.toHaveBeenCalled();
    expect(trackPageview).not.toHaveBeenCalled();
  });

  it('loads once with auto:false and fires a pageview on first render when siteId is set', () => {
    const Stub = createRoutesStub([
      { path: '*', Component: () => <FathomAnalytics siteId="SITE123" /> },
    ]);
    render(<Stub initialEntries={['/login']} />);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('SITE123', { auto: false });
    expect(trackPageview).toHaveBeenCalledTimes(1);
  });
});

describe('trackAuthEvent', () => {
  it('forwards the event name to fathom-client trackEvent', () => {
    trackAuthEvent('email_verified');
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('email_verified');
  });
});

describe('TrackOnMount', () => {
  it('fires the conversion event exactly once on mount', () => {
    const Stub = createRoutesStub([
      { path: '*', Component: () => <TrackOnMount event="signup_submitted" /> },
    ]);
    render(<Stub initialEntries={['/signup']} />);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('signup_submitted');
  });
});
