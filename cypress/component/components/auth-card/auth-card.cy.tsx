// cypress/component/components/auth-card/auth-card.cy.tsx
//
// AuthCard does not theme itself from org branding: auth pages render in Datum's own
// colours whatever the org's label policy says (every org inherits a primaryColor from the
// provider's instance default, so applying it would recolour the page for everyone). These
// specs pin that, replacing the spec of the removed `brandingToStyle` helper.
import { AuthCard } from '@/components/auth-card/auth-card';
import type { BrandingTheme } from '@/modules/auth/types';

const THEME_VARS = ['--primary', '--background'] as const;

function mountCard(branding?: BrandingTheme | null) {
  cy.mount(
    <AuthCard title="Sign in" description="Welcome back" branding={branding}>
      <button type="button">Continue</button>
    </AuthCard>
  );
}

/** The theme variables as they resolve on the card's primary action. */
function resolvedThemeVars() {
  return cy.contains('button', 'Continue').then(($button) => {
    const computed = getComputedStyle($button[0]);
    return THEME_VARS.map((name) => computed.getPropertyValue(name).trim());
  });
}

describe('AuthCard: org branding does not re-theme the card', () => {
  it('sets no inline theme variables when the org has colours', () => {
    mountCard({ primaryColor: '#ff0000', backgroundColor: '#00ff00' });
    cy.contains('h1', 'Sign in').should('be.visible');
    cy.get('[data-cy-root] *').each(($el) => {
      for (const name of THEME_VARS) {
        expect($el[0].style.getPropertyValue(name), `${name} on <${$el[0].localName}>`).to.equal(
          ''
        );
      }
    });
  });

  it('resolves the same theme variables with and without org colours', () => {
    mountCard(null);
    resolvedThemeVars().then((defaults) => {
      expect(defaults[0], 'datum-ui defines --primary').to.not.equal('');
      mountCard({ primaryColor: '#ff0000', backgroundColor: '#00ff00' });
      resolvedThemeVars().should('deep.equal', defaults);
    });
  });
});
