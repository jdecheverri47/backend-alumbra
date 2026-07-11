const { execSync } = require('node:child_process');

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://alumbra:password@localhost:5432/alumbra_test?schema=public';

// Aplica las migraciones a la DB de test antes de correr las suites.
module.exports = async () => {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
};
