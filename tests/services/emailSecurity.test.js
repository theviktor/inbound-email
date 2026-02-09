const {
  normalizeIp,
  isIpAllowed,
  isSenderDomainAllowed,
  hasRequiredAuthResults
} = require('../../services/emailSecurity');

describe('emailSecurity', () => {
  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
  });

  it('checks allowed client IPs', () => {
    expect(isIpAllowed('10.0.0.1', ['10.0.0.1'])).toBe(true);
    expect(isIpAllowed('10.0.0.2', ['10.0.0.1'])).toBe(false);
  });

  it('checks sender domain allowlist', () => {
    expect(isSenderDomainAllowed('sender@example.com', ['example.com'])).toBe(true);
    expect(isSenderDomainAllowed('sender@evil.com', ['example.com'])).toBe(false);
  });

  it('checks required authentication results tokens', () => {
    const parsedEmail = {
      headers: new Map([
        ['authentication-results', 'mx.example; spf=pass smtp.mailfrom=example.com; dkim=pass; dmarc=pass']
      ])
    };

    expect(hasRequiredAuthResults(parsedEmail, ['spf=pass', 'dmarc=pass'])).toBe(true);
    expect(hasRequiredAuthResults(parsedEmail, ['spf=pass', 'dmarc=fail'])).toBe(false);
  });
});
