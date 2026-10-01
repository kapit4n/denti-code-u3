/**
 * Denti-Code U3 — Domain.
 *
 * Framework-independent dental clinic business rules, value objects and ports.
 * This package must never import React, browser APIs, Tauri, PostgreSQL,
 * Drizzle, TanStack Query, Zustand or any UI library
 * (see docs/decisions/0004-framework-independent-domain.md).
 */
export * from './appointment/index.js';
export * from './billing/index.js';
export * from './inventory/index.js';
export * from './odontogram/index.js';
export * from './organization/index.js';
export * from './patient/index.js';
export * from './ports/index.js';
export * from './prescription/index.js';
export * from './shared/index.js';
export * from './treatment/index.js';
export * from './visit/index.js';
