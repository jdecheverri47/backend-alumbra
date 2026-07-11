import { ttlToSeconds, validateEnv } from './env.schema';

const BASE = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/alumbra',
  JWT_SECRET: 'a-test-secret-that-is-32-chars-long!',
};

describe('validateEnv', () => {
  it('parses a valid environment', () => {
    const result = validateEnv({ ...BASE, PORT: '3000' });
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/alumbra');
  });

  it('defaults PORT to 3000 when missing', () => {
    const result = validateEnv(BASE);
    expect(result.PORT).toBe(3000);
  });

  it('defaults auth TTLs and CORS origin', () => {
    const result = validateEnv(BASE);
    expect(result.JWT_ACCESS_TTL).toBe('15m');
    expect(result.REFRESH_TTL_DAYS).toBe(30);
    expect(result.CORS_ORIGIN).toBe('http://localhost:3000');
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => validateEnv({ NODE_ENV: BASE.NODE_ENV, JWT_SECRET: BASE.JWT_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws when DATABASE_URL is not a URL', () => {
    expect(() => validateEnv({ ...BASE, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('throws when NODE_ENV is invalid', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('throws when JWT_SECRET is missing or too short', () => {
    expect(() => validateEnv({ NODE_ENV: BASE.NODE_ENV, DATABASE_URL: BASE.DATABASE_URL })).toThrow(
      /JWT_SECRET/,
    );
    expect(() => validateEnv({ ...BASE, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_ACCESS_TTL has an unexpected format', () => {
    expect(() => validateEnv({ ...BASE, JWT_ACCESS_TTL: 'quince minutos' })).toThrow(
      /JWT_ACCESS_TTL/,
    );
  });
});

describe('ttlToSeconds', () => {
  it('converts each supported unit', () => {
    expect(ttlToSeconds('90s')).toBe(90);
    expect(ttlToSeconds('15m')).toBe(900);
    expect(ttlToSeconds('2h')).toBe(7200);
    expect(ttlToSeconds('1d')).toBe(86400);
  });

  it('throws on malformed input', () => {
    expect(() => ttlToSeconds('15')).toThrow(/Invalid TTL/);
  });
});
