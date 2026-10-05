const { hashPassword } = require('../src/auth/auth');

const password = process.argv[2] || 'admin123';

console.log('==================================================');
console.log('Phoenix - Admin Password Hash Generator');
console.log('==================================================');
console.log(`Plaintext Password: ${password}`);

const hash = hashPassword(password);
console.log(`Generated Hash:     ${hash}`);
console.log('\nCopy this value into your server .env file as:');
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log('==================================================');
