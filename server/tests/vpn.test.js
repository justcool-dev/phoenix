const request = require('supertest');
const app = require('../src/index');
const clientService = require('../src/services/clients');

describe('VPN & Client Management API Tests', () => {
  it('GET /api/server/health should return status ok', async () => {
    const res = await request(app).get('/api/server/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/server/info should return VPN metadata', async () => {
    const res = await request(app).get('/api/server/info');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('vpnEndpoint');
    expect(res.body).toHaveProperty('vpnPort');
  });

  it('should compute next available IP in 10.66.66.0/24 range', () => {
    const nextIp = clientService.getNextAvailableIp();
    expect(nextIp).toMatch(/^10\.66\.66\.\d+\/32$/);
  });
});
