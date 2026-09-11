// src/core/wordlist.ts
// Wordlist curada de 256 palabras en español neutro, en orden ASCII estricto.
//
// 12 palabras sobre 256 opciones = 96 bits de entropía. Es un trade-off consciente:
// de sobra para el negocio de un lavadero, y sin arrastrar los 16 KB de la BIP39
// completa (que además está en inglés). Un byte por palabra, sin aritmética modular:
// el mapeo byte→palabra se audita a ojo.
//
// Todas ASCII y sin tildes ('dia', 'atun', 'guion') porque esta frase se teclea
// una sola vez en la vida del negocio, a mano, desde un papel y en un teclado de
// móvil. Un acento olvidado no puede ser la diferencia entre entrar y no entrar.

export const RECOVERY_WORDS: readonly string[] = [
  'agua', 'aire', 'ala', 'alba', 'alma', 'alta', 'arco', 'area', 'arte', 'asal',
  'atun', 'ave', 'azul', 'baja', 'bala', 'banco', 'bar', 'base', 'bello', 'beso',
  'bien', 'blanco', 'boca', 'boda', 'bola', 'bolsa', 'bomba', 'borda', 'bosque', 'brazo',
  'brisa', 'bronce', 'bueno', 'cabo', 'cada', 'cafe', 'caja', 'calor', 'cama', 'campo',
  'cancion', 'cara', 'carne', 'carro', 'casa', 'causa', 'cena', 'cerca', 'cerdo', 'cero',
  'chino', 'chiste', 'cielo', 'cinco', 'cine', 'cinta', 'circo', 'claro', 'clave', 'clima',
  'cobro', 'cocer', 'cocina', 'codo', 'color', 'como', 'conde', 'cono', 'corte', 'cosa',
  'crema', 'cruce', 'cuadro', 'cuatro', 'cubo', 'cuello', 'cuenta', 'cuero', 'cueva', 'cumbre',
  'cuna', 'cuota', 'cura', 'dado', 'danza', 'datos', 'dedo', 'delta', 'denso', 'dental',
  'derecho', 'despacio', 'dia', 'diente', 'diez', 'dinero', 'dique', 'disco', 'doble', 'doler',
  'domingo', 'donde', 'dormir', 'dosis', 'duda', 'duelo', 'dulce', 'duplicar', 'duro', 'echar',
  'eco', 'eje', 'ejemplo', 'ella', 'empleo', 'enano', 'enero', 'enfado', 'enlace', 'enojo',
  'ensayo', 'entero', 'envio', 'epoca', 'equipo', 'error', 'escala', 'escudo', 'espacio', 'espada',
  'espejo', 'esquiar', 'estado', 'estilo', 'etapa', 'etica', 'europa', 'exacto', 'examen', 'exito',
  'experto', 'falso', 'familia', 'famoso', 'fase', 'fatal', 'favor', 'fecha', 'feliz', 'feria',
  'fibra', 'ficha', 'fiebre', 'fiel', 'fiesta', 'figura', 'fijo', 'fila', 'filo', 'filtro',
  'final', 'finca', 'firma', 'flaco', 'flor', 'flota', 'fluir', 'foca', 'fogata', 'folio',
  'fondo', 'forma', 'foro', 'frase', 'freno', 'frente', 'fresa', 'frio', 'fruta', 'fuego',
  'fuente', 'fuera', 'fuerza', 'funda', 'furia', 'gallo', 'gana', 'gancho', 'ganga', 'garaje',
  'gasto', 'gato', 'genio', 'gente', 'gesto', 'gigante', 'gimnasio', 'girar', 'globo', 'golfo',
  'golpe', 'goma', 'gordo', 'gota', 'grano', 'grave', 'gripe', 'gris', 'grito', 'guapo',
  'guardia', 'guerra', 'guia', 'guion', 'guitarra', 'gusto', 'hielo', 'hierro', 'higado', 'hijo',
  'himno', 'historia', 'hoja', 'hombre', 'honor', 'hora', 'hormiga', 'horno', 'hotel', 'hoyo',
  'hueso', 'huevo', 'humo', 'humor', 'idea', 'idioma', 'iglesia', 'igual', 'imagen', 'iman',
  'impar', 'indio', 'inicio', 'insecto', 'invierno', 'isla', 'jardin', 'jefe', 'joven', 'juego',
  'jugo', 'junio', 'juntar', 'jurar', 'justo', 'juvenil',
];

// Un byte aleatorio por palabra ⇒ la lista DEBE tener exactamente 256 entradas.
// Si alguien recorta la lista, los índices altos quedan vacíos y el generador
// empezaría a fallbackear a una palabra fija: entropía sesgada sin avisar a nadie.
// Prefiero que reviente en el import, ruidosamente, y no dentro de dos años.
if (RECOVERY_WORDS.length !== 256) {
  throw new Error(`wordlist.ts: ${RECOVERY_WORDS.length} palabras, se esperan 256`);
}

/**
 * Traduce un byte (0..255) a su palabra.
 *
 * El `undefined` es inalcanzable con un byte, pero `noUncheckedIndexedAccess` no
 * sabe contar y prefiero un throw explícito a un `!` que silencia el problema.
 */
export function wordAt(byte: number): string {
  const word = RECOVERY_WORDS[byte];
  if (word === undefined) {
    throw new Error(`wordlist.ts: índice ${byte} fuera de rango`);
  }
  return word;
}
