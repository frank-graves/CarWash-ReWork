// src/infra/tests/wordlist.test.ts
// La wordlist es material criptográfico aunque parezca una lista de palabras.
// 256 entradas únicas y ordenadas ⇒ 8 bits exactos por palabra, y el mapeo
// byte→palabra deja de tener zonas muertas.

import { describe, expect, it } from 'vitest';
import { RECOVERY_WORDS, wordAt } from '@core/wordlist';

describe('RECOVERY_WORDS', () => {
  it('tiene 256 entradas: un byte por palabra', () => {
    expect(RECOVERY_WORDS).toHaveLength(256);
  });

  it('está en orden ASCII estricto, sin duplicados ni entradas fuera de sitio', () => {
    const desordenadas = RECOVERY_WORDS.filter(
      (word, index) => index > 0 && (RECOVERY_WORDS[index - 1] ?? '') >= word,
    );

    // El orden estricto implica unicidad. Sin este test, alguien "limpia" la lista,
    // duplica una palabra y el generador pierde entropía sin que nadie se entere.
    expect(desordenadas).toEqual([]);
  });

  it('solo contiene letras ASCII sin tildes (se teclea a mano, una vez)', () => {
    const sospechosas = RECOVERY_WORDS.filter((word) => !/^[a-z]+$/.test(word));
    expect(sospechosas).toEqual([]);
  });
});

describe('wordAt', () => {
  it('mapea los extremos del rango a su palabra', () => {
    expect(wordAt(0)).toBe(RECOVERY_WORDS[0]);
    expect(wordAt(255)).toBe(RECOVERY_WORDS[255]);
  });

  it('revienta fuera de rango en vez de devolver undefined', () => {
    expect(() => wordAt(256)).toThrow('fuera de rango');
    expect(() => wordAt(-1)).toThrow('fuera de rango');
  });
});
