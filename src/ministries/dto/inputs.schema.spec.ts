import { createMinistrySchema, updateMinistrySchema } from './inputs.schema';

describe('createMinistrySchema', () => {
  it('accepts a valid kebab slug', () => {
    const result = createMinistrySchema.parse({ slug: 'acogida', name: 'Acogida' });
    expect(result.slug).toBe('acogida');
  });

  it('rejects non-kebab slug', () => {
    expect(() => createMinistrySchema.parse({ slug: 'Acogida Ministry', name: 'x' })).toThrow();
    expect(() => createMinistrySchema.parse({ slug: 'ACOGIDA', name: 'x' })).toThrow();
  });
});

describe('updateMinistrySchema', () => {
  it('accepts empty input', () => {
    expect(updateMinistrySchema.parse({})).toEqual({});
  });
});
