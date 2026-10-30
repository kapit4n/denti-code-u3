/**
 * Turning a refused inventory write into one sentence.
 *
 * The two writes answer different questions, so they have different sentences:
 * adding an item can be refused for a duplicate SKU, while a movement can be
 * refused because the item is gone or because the clinic does not have that much
 * stock. The wire collapses every rule refusal to `DOMAIN_RULE_VIOLATION`, so the
 * server's own message is the only place the reason survives — quoting it is the
 * point of the branch.
 */

import { ApiClientError } from '@denti-code-u3/api-client';

export interface InventoryFailureMessages {
  readonly notFound?: string;
  readonly network?: string;
}

function describe(
  error: unknown,
  fallback: string,
  notFound: string,
  messages?: InventoryFailureMessages,
): string | undefined {
  if (!error) {
    return undefined;
  }
  if (!(error instanceof ApiClientError)) {
    return fallback;
  }

  switch (error.code) {
    case 'VALIDATION_ERROR':
    case 'DOMAIN_RULE_VIOLATION':
      return error.message || fallback;
    case 'NOT_FOUND':
      return messages?.notFound ?? notFound;
    case 'NETWORK_ERROR':
      return messages?.network ?? 'Could not reach the server. Nothing was saved.';
    default:
      return error.message || fallback;
  }
}

export function describeAddItemFailure(
  error: unknown,
  fallback: string,
  messages?: InventoryFailureMessages,
): string | undefined {
  return describe(
    error,
    fallback,
    'This clinic is no longer available. The item was not added.',
    messages,
  );
}

export function describeMovementFailure(
  error: unknown,
  fallback: string,
  messages?: InventoryFailureMessages,
): string | undefined {
  return describe(error, fallback, 'That item is no longer in the inventory.', messages);
}
