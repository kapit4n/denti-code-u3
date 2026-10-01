/**
 * Denti-Code U3 database schema — the only place Drizzle is declared.
 *
 * One file per bounded area. Every table carries `clinic_id` so multi-clinic
 * works from day one, and every money column is an integer in minor units.
 *
 * Import order matters only for readability: the `enums` module has no
 * dependencies, and each area imports the areas it references.
 */

export * from './enums.js';
export * from './organization.js';
export * from './patient.js';
export * from './appointment.js';
export * from './visit.js';
export * from './treatment.js';
export * from './billing.js';
export * from './inventory.js';
