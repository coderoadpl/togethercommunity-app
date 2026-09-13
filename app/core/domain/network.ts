const privateIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224;
};

export const privateNetworkAddress = (address: string): boolean => {
  if (/^\d+(?:\.\d+){3}$/.test(address)) return privateIpv4(address);
  if (!address.includes(':')) return false;
  const normalized = address.toLowerCase();
  return normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff');
};

export const privateNetworkHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname.endsWith('.localhost') || privateNetworkAddress(hostname);
