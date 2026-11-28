/**
 * The test catalog's id, and the API of its one component of its own, the
 * thrower: it draws its text, and throws while drawing when `fail` is true.
 * Each test page implements it in its own framework.
 */
import {
  type ComponentApi,
  DynamicBooleanSchema,
  DynamicStringSchema,
  type MessageProcessorOptions,
} from '@a2ui/web_core/v0_9';
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

/** With this in a page's address, the page gives its adapter the host's processor options. */
export const OPTIONS_PARAMETER = 'options';

/**
 * Processor options a host could give: messages other than surfaces and
 * components refused, errors reported without a throw, and the host's own
 * channel to its agent, which records what it is sent.
 */
export function hostProcessorOptions(sent: unknown[]): MessageProcessorOptions {
  return {
    validationConfig: {allowedMessages: ['createSurface', 'updateComponents']},
    reportErrorsOnly: true,
    errorHandler: error => sent.push(error),
    outboundListener: message => {
      sent.push(message);
    },
    unifiedOutbound: true,
  };
}
