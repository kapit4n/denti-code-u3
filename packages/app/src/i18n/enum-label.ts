/**
 * Domain values reach the catalogue through one narrow door.
 *
 * `t()` is typed against known literals, while an API payload's status is a
 * `string`. This helper is the single assertion between the two, so a missing
 * value falls back to the raw code in one predictable place instead of every
 * component inventing its own label map.
 */

import type { TranslationKey } from './catalog.js';
import type { Translate } from './i18n-provider.js';

export type EnumKeyPrefix =
  'common.status' | 'common.condition' | 'common.surface' | 'common.dentition';

export function enumLabel(t: Translate, prefix: EnumKeyPrefix, value: string): string {
  return t(`${prefix}.${value}` as TranslationKey);
}
