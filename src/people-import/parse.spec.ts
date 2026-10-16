import { normalize, parseDate, parseMinistries, parseType } from './parse';

const MINISTRIES = [
  { id: '1', slug: 'alabanza', name: 'Alabanza' },
  { id: '2', slug: 'multimedia', name: 'Multimedia' },
  { id: '3', slug: 'alcance-mision', name: 'Alcance y Misión' },
];

describe('people import parsing', () => {
  it('normaliza tildes, mayúsculas y espacios', () => {
    expect(normalize('  Alcance  y MISIÓN ')).toBe('alcance y mision');
  });

  it('entiende el tipo', () => {
    expect(parseType('Miembro')).toBe('MIEMBRO');
    expect(parseType('ASISTENTES')).toBe('ASISTENTE');
    expect(parseType('pastor')).toBeNull();
    expect(parseType('')).toBeNull();
  });

  it('lee fechas dd/mm/aaaa e ISO, y rechaza las que no existen', () => {
    expect(parseDate('05/03/2019')?.toISOString()).toBe('2019-03-05T12:00:00.000Z');
    expect(parseDate('2019-03-05')?.toISOString()).toBe('2019-03-05T12:00:00.000Z');
    expect(parseDate('5-3-19')?.toISOString()).toBe('2019-03-05T12:00:00.000Z');
    expect(parseDate('')).toBeNull();
    expect(() => parseDate('31/02/2020')).toThrow(/no es una fecha válida/);
    expect(() => parseDate('marzo 2019')).toThrow(/dd\/mm\/aaaa/);
  });

  it('lee ministerios con rol y nombres parciales', () => {
    const parsed = parseMinistries('alabanza, Multimedia (coordinador); alcance', MINISTRIES);
    expect(parsed.map((p) => [p.ministry.slug, p.role])).toEqual([
      ['alabanza', 'MEMBER'],
      ['multimedia', 'LEADER'],
      ['alcance-mision', 'MEMBER'],
    ]);
    expect(() => parseMinistries('Danza', MINISTRIES)).toThrow(/Danza/);
  });
});
