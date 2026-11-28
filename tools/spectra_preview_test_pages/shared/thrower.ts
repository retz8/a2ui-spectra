/**
 * The test catalog's id, and the API of its one component of its own, the
 * thrower: it draws its text, and throws while drawing when `fail` is true.
 * Each test page implements it in its own framework.
 */
import {type ComponentApi, DynamicBooleanSchema, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

/** The test catalog: the v0.9 basic catalog's components and functions, and the thrower. */
export const TEST_CATALOG_ID = 'https://example.com/a2ui-spectra/preview-test-pages/catalog.json';

/** The error the thrower throws. */
export const THROWER_FAILURE = 'The thrower was told to fail.';

export const throwerApi = {
  name: 'Thrower',
  schema: z.object({
    text: DynamicStringSchema.optional(),
    fail: DynamicBooleanSchema.optional(),
  }),
} satisfies ComponentApi;
