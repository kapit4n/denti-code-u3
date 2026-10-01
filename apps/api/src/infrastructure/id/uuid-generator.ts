import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '@denti-code-u3/domain';

export const uuidGenerator: IdGenerator = {
  nextId: () => randomUUID(),
};
