/**
 * Attaching a file to a visit.
 *
 * **Nothing is written optimistically, and the files list is what refetches — not
 * the visit.** A file does not change the visit's row (its status, its times and
 * its summary are untouched), so invalidating `['visits']` as the closures do
 * would refetch the visit and the patient's profile for pixels that cannot
 * differ. The key this mutation invalidates is exactly the one the read used,
 * and the server's own answer is what appears in the list.
 *
 * The body is the *reference*, nothing else: the visit is the path, the clinic is
 * the request scope and the time is the server's. `contentType` and `sizeBytes`
 * travel only when the form has them, for the same reason the charges draft does
 * not send zeros: a reference that claims a type or a size it does not know is a
 * reference that lies.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { VisitAttachment } from '@denti-code-u3/domain';

import { useApiClient } from '../../../query/api-client-provider.js';

export interface CreateVisitAttachmentVariables {
  readonly visitId: string;
  readonly fileName: string;
  readonly contentType?: string;
  readonly sizeBytes?: number;
}

export function useCreateVisitAttachment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ visitId, fileName, contentType, sizeBytes }: CreateVisitAttachmentVariables) =>
      client.post<VisitAttachment, { fileName: string; contentType?: string; sizeBytes?: number }>(
        `/visits/${visitId}/attachments`,
        {
          fileName,
          ...(contentType != null ? { contentType } : {}),
          ...(sizeBytes != null ? { sizeBytes } : {}),
        },
      ),
    onSuccess: async (_attachment, { visitId }) => {
      await queryClient.invalidateQueries({ queryKey: ['visits', 'attachments', visitId] });
    },
  });
}
