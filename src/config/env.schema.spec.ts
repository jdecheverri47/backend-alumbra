import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('parses a valid environment', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      PORT: '3000',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/alumbra',
    });
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/alumbra');
  });

  it('defaults PORT to 3000 when missing', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/alumbra',
    });
    expect(result.PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'development' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a URL', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'not-a-url',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when NODE_ENV is invalid', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/alumbra',
      }),
    ).toThrow(/NODE_ENV/);
  });
});
