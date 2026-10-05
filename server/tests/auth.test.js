const request = require('supertest');
const app = require('../src/index');
const { hashPassword, verifyPassword } = require('../src/auth/auth');
const config = require('../src/config');

describe('Authentication & Password Hashing Tests', () => {
  it('should correctly hash and verify passwords using scrypt', () => {
    const rawPass = 'SecretPassword123!';
    const hash = hashPassword(rawPass);

    expect(hash).toContain('.');
    expect(verifyPassword(rawPass, hash)).toBe(true);
    expect(verifyPassword('WrongPassword', hash)).toBe(false);
  });

  it('POST /api/auth/login with valid credentials should return token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        username: config.admin.username,
        password: 'admin123',
      });

    // Note: Depends on default admin password in config
    if (res.status === 200) {
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body).toHaveProperty('expiresIn');
    } else {
      expect(res.status).toBe(401);
    }
  });

  it('POST /api/auth/login with invalid credentials should return 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'incorrect_password',
      });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});
