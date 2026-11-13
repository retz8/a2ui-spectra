/**
 * The sample catalog's custom component in React: a slider that binds a
 * number and writes it back to the data model as it is dragged, as
 * upstream's Lit and Angular explorers have it. Its API and its binding to
 * the catalog are here; its markup is `SliderBody.tsx`.
 */
import {createComponentImplementation} from '@a2ui/react/v0_9';
import {type ComponentApi, DynamicNumberSchema, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

import {SliderBody} from './SliderBody.tsx';

export const CustomSliderApi = {
  name: 'CustomSlider',
  schema: z.object({
    label: DynamicStringSchema.optional(),
    value: DynamicNumberSchema.optional(),
    min: DynamicNumberSchema.optional(),
    max: DynamicNumberSchema.optional(),
  }),
} satisfies ComponentApi;

export const CustomSlider = createComponentImplementation(CustomSliderApi, ({props}) => (
  <SliderBody
    label={props.label ?? 'Value'}
    value={props.value ?? 0}
    min={props.min ?? 0}
    max={props.max ?? 100}
    onValue={value => props.setValue?.(value)}
  />
));
