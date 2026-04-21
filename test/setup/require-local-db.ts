export function requireLocalDb(): void {
  const url = process.env.DATABASE_URL ?? '';
  const looksLocal = /localhost(:\d+)?\//.test(url) || /127\.0\.0\.1(:\d+)?\//.test(url);
  const looksLikeTestDb = /_test\b/i.test(url);
  if (!looksLocal && !looksLikeTestDb) {
    throw new Error(
      `Refusing to run destructive test suite against DATABASE_URL that does not look local or _test: ${url}. ` +
        `Set DATABASE_URL to a localhost DB or one whose database name ends in _test.`,
    );
  }
}
