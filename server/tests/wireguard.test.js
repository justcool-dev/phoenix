const wireguardService = require('../src/services/wireguard');

describe('WireGuard Validation Unit Tests', () => {
  it('should validate correct WireGuard public keys', () => {
    const validKey = 'ab4V+Qx70000000000000000000000000000000000A=';
    expect(wireguardService.isValidPublicKey(validKey)).toBe(true);

    const invalidKey = 'not_a_valid_base64_key!';
    expect(wireguardService.isValidPublicKey(invalidKey)).toBe(false);
  });

  it('should validate IP and CIDR formats', () => {
    expect(wireguardService.isValidIP('10.66.66.2')).toBe(true);
    expect(wireguardService.isValidIP('10.66.66.2/32')).toBe(true);
    expect(wireguardService.isValidIP('10.66.66.0/24')).toBe(true);
    expect(wireguardService.isValidIP('999.999.999.999')).toBe(false);
    expect(wireguardService.isValidIP('invalid_ip')).toBe(false);
  });
});
