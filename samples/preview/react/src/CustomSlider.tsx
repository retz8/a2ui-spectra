/**
 * The sample catalog's custom component in React: a slider that binds a
 * number and writes it back to the data model as it is dragged, as
 * upstream's Lit and Angular explorers have it.
 */
import {createComponentImplementation} from '@a2ui/react/v0_9';
import {type ComponentApi, DynamicNumberSchema, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

export const CustomSliderApi = {
  name: 'CustomSlider',
  schema: z.object({
    label: DynamicStringSchema.optional(),
    value: DynamicNumberSchema.optional(),
    min: DynamicNumberSchema.optional(),
    max: DynamicNumberSchema.optional(),
  }),
} satisfies ComponentApi;

export const CustomSlider = createComponentImplementation(CustomSliderApi, ({props}) => {
  const value = props.value ?? 0;
  return (
    <div
      style={{
        padding: 10,
        border: '1px dashed #3b82f6',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <label style={{fontSize: '0.85rem', fontWeight: 500, color: '#3b82f6'}}>
        {props.label ?? 'Value'}: {value}
      </label>
      <input
        type="range"
        min={props.min ?? 0}
        max={props.max ?? 100}
        value={value}
        onChange={event => props.setValue?.(Number(event.target.value))}
        style={{width: '100%', cursor: 'pointer'}}
      />
    </div>
  );
});
