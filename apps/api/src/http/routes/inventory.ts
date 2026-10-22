/**
 * Inventory: the clinic's consumable stock, and the ledger that moves it.
 *
 * `GET /api/v1/inventory/items` is the read the inventory page draws, including
 * the cached stock level and the minimum. Low stock is not a server filter: the
 * domain's `isLowStock` compares two columns the item already carries, and a page
 * that asked again with `?lowStock=true` would be a second answer that could
 * disagree with the row beside it. Every item is returned in name order; the
 * client decides how to call out the low ones.
 *
 * `POST /api/v1/inventory/items` adds an item; its opening stock is written as an
 * adjustment by the use case, in one transaction. A duplicate SKU is refused by
 * the `(clinic_id, sku)` index and arrives as `DOMAIN_RULE_VIOLATION` (409).
 *
 * The movement endpoints are item-scoped. `GET .../movements` answers the item's
 * newest-first history, and `POST .../movements` applies one movement and returns
 * the updated item beside it, so the page never has to guess the new level. The
 * item is read in the request's clinic first: a foreign item is a 404, the same as
 * one that does not exist (ADR 0014), rather than an empty history.
 */

import type { FastifyInstance } from 'fastify';

import type { Clock, IdGenerator, InventoryRepository, UnitOfWork } from '@denti-code-u3/domain';
import { addInventoryItem, DomainError, recordStockMovement } from '@denti-code-u3/domain';
import { createInventoryItemSchema, recordStockMovementSchema } from '@denti-code-u3/validation';
import { asInventoryItemId, type ClinicId } from '@denti-code-u3/types';

import { sendProblem } from '../problem.js';

export interface InventoryDependencies {
  readonly inventory: InventoryRepository;
  readonly unitOfWork: UnitOfWork;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  { inventory, unitOfWork, ids, clock }: InventoryDependencies,
): Promise<void> {
  app.get('/api/v1/inventory/items', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;

    try {
      const items = await inventory.listByClinic(clinicId);
      return { items };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to list inventory');
    }
  });

  app.post('/api/v1/inventory/items', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const parsed = createInventoryItemSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The inventory item could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    try {
      const item = await addInventoryItem(clinicId, parsed.data, {
        unitOfWork,
        newItemId: () => asInventoryItemId(ids.nextId()),
        newMovementId: () => ids.nextId(),
        clock,
      });

      return reply.status(201).send({ item });
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });

  app.get('/api/v1/inventory/items/:itemId/movements', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { itemId } = request.params as { itemId: string };

    try {
      const item = await inventory.findById(clinicId, asInventoryItemId(itemId));

      if (!item) {
        throw new DomainError('NOT_FOUND', `Item ${itemId} was not found`, {
          entity: 'InventoryItem',
          id: itemId,
        });
      }

      const items = await inventory.listMovements(clinicId, item.id);
      return { items };
    } catch (error) {
      return sendProblem(reply, request, error, 'Failed to read stock movements');
    }
  });

  app.post('/api/v1/inventory/items/:itemId/movements', async (request, reply) => {
    const clinicId = request.clinicId as ClinicId;
    const { itemId } = request.params as { itemId: string };
    const parsed = recordStockMovementSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The stock movement could not be accepted',
          details: { issues: parsed.error.issues },
          requestId: request.id,
        },
      });
    }

    try {
      const result = await recordStockMovement(clinicId, asInventoryItemId(itemId), parsed.data, {
        unitOfWork,
        newMovementId: () => ids.nextId(),
        clock,
      });

      return reply.status(201).send(result);
    } catch (error) {
      return sendProblem(reply, request, error);
    }
  });
}
