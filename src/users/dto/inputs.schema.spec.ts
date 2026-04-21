import { createUserSchema, updateUserSchema } from './inputs.schema';

describe('createUserSchema', () => {
  it('accepts a valid input and lowercases the email', () => {
    const result = createUserSchema.parse({
      email: 'JANE@EXAMPLE.COM',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(result.email).toBe('jane@example.com');
  });

  it('rejects an invalid email', () => {
    expect(() =>
      createUserSchema.parse({ email: 'not-email', firstName: 'J', lastName: 'D' }),
    ).toThrow();
  });

  it('rejects empty firstName', () => {
    expect(() =>
      createUserSchema.parse({ email: 'a@b.com', firstName: '', lastName: 'D' }),
    ).toThrow();
  });
});

describe('updateUserSchema', () => {
  it('allows all fields to be absent', () => {
    const result = updateUserSchema.parse({});
    expect(result).toEqual({});
  });

  it('allows nulling phone', () => {
    const result = updateUserSchema.parse({ phone: null });
    expect(result.phone).toBeNull();
  });
});
