/**
 * Integration test: the inventory endpoints on PostgreSQL.
 *
 * The domain suite proves the ledger rules and the SQLite smoke proves the same
 * endpoints on the engine that always runs. This file exists for the half neither
 * can: the PostgreSQL repository's tenant scoping and its unique-SKU translation
 * behind a real request, and the route's promise that a movement answers **one
 * transaction** — the ledger row and the cached level together, even when the
 * domain refuses halfway.
 *
 * It goes through `app.inject` so the observations are the client's: 201 with the
 * item the database now holds, 409 when the shelf is short or the SKU is taken, and
 * the same 404 for another clinic's item as for one that never existed.
 *
 * Run it with:
 *
 *   pnpm run db:up
 *   pnpm run test:integration
 *
 * It uses `TEST_DATABASE_URL` so it can never touch development data.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as schema from '@denti-code-u3/database/schema';
import { registerInventoryRoutes } from '../src/http/routes/inventory.js';
import { DrizzleInventoryRepository } from '../src/infrastructure/persistence/repositories/inventory-repository.js';
import { DrizzleUnitOfWork } from '../src/infrastructure/persistence/postgres/unit-of-work.js';
import type { DentiDatabase } from '../src/infrastructure/persistence/postgres/connection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.TEST_DATABASE_URL;

const describeIntegration = databaseUrl ? describe : describe.skip;

describeIntegration('inventory endpoints (PostgreSQL)', () => {
  const sql = postgres(databaseUrl as string, { max: 4 });
  const db = drizzle(sql, { casing: 'snake_case', schema }) as unknown as DentiDatabase;

  const clinicId = '8a8a1111-1111-4111-8111-111111111111';
  const otherClinicId = '8a8a2222-2222-4222-8222-222222222222';
  const foreignItemId = '8b8b2222-2222-4222-8222-222222222222';
  const missingItemId = '8b8b9999-9999-4999-8999-999999999999';

  const NOW = '2026-10-22T15:00:00.000Z';

  let app: FastifyInstance;

  const getItems = () =>
    app.inject({
      method: 'GET',
      url: '/api/v1/inventory/items',
      headers: { 'x-clinic-id': clinicId },
    });

  const addItem = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/inventory/items',
      headers: { 'x-clinic-id': clinicId },
      payload: payload as object,
    });

  const addMovement = (itemId: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/inventory/items/${itemId}/movements`,
      headers: { 'x-clinic-id': clinicId },
      payload: payload as object,
    });

  const getMovements = (itemId: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/inventory/items/${itemId}/movements`,
      headers: { 'x-clinic-id': clinicId },
    });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: path.join(here, '../../../database/migrations') });

    app = Fastify();
    app.decorateRequest('clinicId', '');
    app.addHook('onRequest', async (request: FastifyRequest) => {
      const named = request.headers['x-clinic-id'];
      (request as FastifyRequest & { clinicId: string }).clinicId =
        typeof named === 'string' ? named : clinicId;
    });

    await registerInventoryRoutes(app, {
      inventory: new DrizzleInventoryRepository(db),
      unitOfWork: new DrizzleUnitOfWork(db),
      ids: { nextId: () => crypto.randomUUID() },
      clock: { now: () => NOW },
    });

    await sql`
      insert into clinics (id, name, time_zone, currency_code)
      values
        (${clinicId}, 'Inventory Route', 'UTC', 'USD'),
        (${otherClinicId}, 'Inventory Route Other', 'UTC', 'USD')
      on conflict (id) do nothing
    `;
    await sql`
      insert into inventory_items (id, clinic_id, name, unit, stock, min_stock, cost_minor)
      values (${foreignItemId}, ${otherClinicId}, 'Foreign gauze', 'pack', 5, 1, 100)
      on conflict (id) do nothing
    `;
  });

  beforeEach(async () => {
    // Keep the foreign fixture; clear only this clinic's items, whose movements
    // cascade. The duplicate-SKU test would otherwise inherit the earlier item.
    await sql`delete from inventory_items where clinic_id = ${clinicId}`;
  });

  afterAll(async () => {
    await sql`delete from clinics where id in (${clinicId}, ${otherClinicId})`;
    await app?.close();
    await sql.end();
  });

  it('adds an item with its opening stock as one transaction, and lists it', async () => {
    const created = await addItem({
      name: '  Composite resin A2  ',
      sku: 'COMP-A2',
      unit: 'syringe',
      openingStock: 10,
      minStock: 4,
      costMinor: 4_500,
    });

    expect(created.statusCode).toBe(201);
    const item = created.json().item as { id: string; stock: number; sku: string };
    expect(item).toMatchObject({
      clinicId,
      name: 'Composite resin A2',
      sku: 'COMP-A2',
      unit: 'syringe',
      stock: 10,
      minStock: 4,
      costMinor: 4_500,
    });

    // The cached level and the ledger agree from the first read: the opening stock
    // was not written as a bare number.
    const movements = await getMovements(item.id);
    expect(movements.statusCode).toBe(200);
    expect(movements.json().items).toEqual([
      expect.objectContaining({
        itemId: item.id,
        type: 'ADJUSTMENT',
        quantity: 10,
        reference: 'Opening stock',
        performedAt: NOW,
      }),
    ]);

    const listed = await getItems();
    expect(listed.json().items).toEqual([
      expect.objectContaining({ id: item.id, name: 'Composite resin A2', stock: 10 }),
    ]);
  });

  it('applies usage atomically and refuses a shortage without writing', async () => {
    const created = await addItem({ name: 'Gauze', unit: 'pack', openingStock: 2, minStock: 5 });
    const itemId = created.json().item.id as string;

    const used = await addMovement(itemId, {
      type: 'USAGE',
      quantity: 2,
      reference: '  Visit 42  ',
    });
    expect(used.statusCode).toBe(201);
    expect(used.json().item).toMatchObject({ id: itemId, stock: 0 });
    expect(used.json().movement).toMatchObject({
      itemId,
      type: 'USAGE',
      quantity: 2,
      reference: 'Visit 42',
    });

    const short = await addMovement(itemId, { type: 'USAGE', quantity: 1 });
    expect(short.statusCode).toBe(409);
    expect(short.json().error.code).toBe('DOMAIN_RULE_VIOLATION');

    // The refusal rolled the whole thing back: no third movement, level still zero.
    const history = await getMovements(itemId);
    expect(history.json().items).toHaveLength(2);
    expect((await getItems()).json().items[0].stock).toBe(0);
  });

  it('refuses a duplicate SKU through the clinic unique index', async () => {
    const first = await addItem({ name: 'Resin A2', sku: 'COMP-A2' });
    expect(first.statusCode).toBe(201);

    const duplicate = await addItem({ name: 'Another resin', sku: 'COMP-A2' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('DOMAIN_RULE_VIOLATION');
    expect((await getItems()).json().items).toHaveLength(1);
  });

  it('treats another clinic’s item as unknown, for reads and writes', async () => {
    const foreignRead = await getMovements(foreignItemId);
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignRead.json().error.code).toBe('NOT_FOUND');

    const foreignWrite = await addMovement(foreignItemId, { type: 'USAGE', quantity: 1 });
    expect(foreignWrite.statusCode).toBe(404);
    expect(foreignWrite.json().error.code).toBe('NOT_FOUND');

    // Nothing was written against the other clinic's row.
    expect((await getMovements(foreignItemId)).statusCode).toBe(404);
    const [row] = await sql`
      select stock from inventory_items where id = ${foreignItemId}
    `;
    expect((row as { stock: number }).stock).toBe(5);

    const unknown = await addMovement(missingItemId, { type: 'USAGE', quantity: 1 });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses a zero quantity and an unnamed item at the boundary', async () => {
    const created = await addItem({ name: 'Gauze' });
    const itemId = created.json().item.id as string;

    const zero = await addMovement(itemId, { type: 'USAGE', quantity: 0 });
    expect(zero.statusCode).toBe(422);
    expect(zero.json().error.code).toBe('VALIDATION_ERROR');

    const unnamed = await addItem({ name: '   ' });
    expect(unnamed.statusCode).toBe(422);
    expect(unnamed.json().error.code).toBe('VALIDATION_ERROR');

    const unknownType = await addMovement(itemId, { type: 'STOLEN', quantity: 1 });
    expect(unknownType.statusCode).toBe(422);
  });
});
