function normalizeIp(ip) {
  if (!ip) {
    return '';
  }
  return ip.toString().trim().toLowerCase().replace(/^::ffff:/, '');
}

function isIpAllowed(ip, allowedList) {
  if (!allowedList || allowedList.length === 0) {
    return true;
  }
  const normalized = normalizeIp(ip);
  return allowedList.includes(normalized);
}

function isSenderDomainAllowed(senderAddress, allowedDomains) {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true;
  }
  const domain = senderAddress?.split('@')?.[1]?.toLowerCase();
  return !!domain && allowedDomains.includes(domain);
}

function getAuthenticationResultsHeader(parsedEmail) {
  if (!parsedEmail?.headers || typeof parsedEmail.headers.get !== 'function') {
    return '';
  }

  const value = parsedEmail.headers.get('authentication-results');
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join('; ');
  }
  return value ? String(value) : '';
}

function hasRequiredAuthResults(parsedEmail, requiredResults) {
  if (!requiredResults || requiredResults.length === 0) {
    return true;
  }

  const header = getAuthenticationResultsHeader(parsedEmail).toLowerCase();
  return requiredResults.every((requiredResult) => header.includes(requiredResult));
}

module.exports = {
  normalizeIp,
  isIpAllowed,
  isSenderDomainAllowed,
  hasRequiredAuthResults
};
