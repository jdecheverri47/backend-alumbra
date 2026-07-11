// Corre antes de cargar cualquier módulo en cada worker de jest (setupFiles).
// Apunta las suites a la DB de test para no tocar los datos de desarrollo.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://alumbra:password@localhost:5432/alumbra_test?schema=public';
