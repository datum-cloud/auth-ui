describe('health endpoints', () => {
  it('healthz returns ok', () => {
    cy.request('/healthz').its('body.status').should('eq', 'ok');
  });
  it('readyz returns ready', () => {
    cy.request('/readyz').its('body.status').should('eq', 'ready');
  });
  it('metrics exposes the auth_events_total series', () => {
    cy.request('/metrics').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body).to.contain('auth_events_total');
    });
  });
});
