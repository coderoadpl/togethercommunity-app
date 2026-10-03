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

const parseIpv6 = (address: string): number[] | null => {
  if (address.includes('%')) return null;
  let text = address;
  if (text.includes('.')) {
    const separator = text.lastIndexOf(':');
    const quad = text.slice(separator + 1);
    if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(quad)) return null;
    const octets = quad.split('.').map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${text.slice(0, separator + 1)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }
  const parts = text.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] === '' ? [] : (parts[0] ?? '').split(':');
  const right = parts[1] === undefined || parts[1] === '' ? [] : parts[1].split(':');
  const groups = [...left, ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  if (parts.length === 1) return groups.length === 8 ? groups.map((group) => parseInt(group, 16)) : null;
  if (groups.length >= 8) return null;
  return [
    ...left.map((group) => parseInt(group, 16)),
    ...Array<number>(8 - groups.length).fill(0),
    ...right.map((group) => parseInt(group, 16)),
  ];
};

const embeddedPrivateIpv4 = (high: number, low: number): boolean =>
  privateIpv4(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);

export const privateNetworkAddress = (address: string): boolean => {
  if (/^\d+(?:\.\d+){3}$/.test(address)) return privateIpv4(address);
  if (!address.includes(':')) return false;
  const groups = parseIpv6(address);
  if (groups === null) return true;
  const [first = 0, second = 0, third = 0, , , sixth = 0, seventh = 0, eighth = 0] = groups;
  return groups.slice(0, 6).every((group) => group === 0) ||
    (groups.slice(0, 5).every((group) => group === 0) && sixth === 0xffff) ||
    (first >= 0xfc00 && first <= 0xfdff) ||
    (first >= 0xfe80 && first <= 0xfebf) ||
    (first >= 0xfec0 && first <= 0xfeff) ||
    first >= 0xff00 ||
    (first === 0x64 && second === 0xff9b && groups.slice(2, 6).every((group) => group === 0)
      && embeddedPrivateIpv4(seventh, eighth)) ||
    (first === 0x2002 && embeddedPrivateIpv4(second, third));
};

export const privateNetworkHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname.endsWith('.localhost') || privateNetworkAddress(hostname);
