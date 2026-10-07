/**
 * The accent-folding pair, as `fold-accents.ts` always was.
 *
 * Kept at this path so the PostgreSQL repositories and their tests keep importing
 * the one module they did; the implementation now lives one directory up, next to
 * the SQLite twin that shares it (ADR 0025).
 */

export * from '../fold-accents.js';
