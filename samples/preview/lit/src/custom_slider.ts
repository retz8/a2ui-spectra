/**
 * The sample catalog's custom component in Lit: a slider that binds a number
 * and writes it back to the data model as it is dragged, as upstream's Lit
 * explorer has it.
 */
import {A2uiLitElement} from '@a2ui/lit/v0_9';
import {type ComponentApi, DynamicNumberSchema, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {html, nothing} from 'lit';
import {z} from 'zod';

export const customSliderApi = {
  name: 'CustomSlider',
  schema: z.object({
    label: DynamicStringSchema.optional(),
    value: DynamicNumberSchema.optional(),
    min: DynamicNumberSchema.optional(),
    max: DynamicNumberSchema.optional(),
  }),
} satisfies ComponentApi;

export class CustomSlider extends A2uiLitElement<typeof customSliderApi> {
  protected override readonly api = customSliderApi;

  override createRenderRoot(): this {
    return this;
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const value = props.value ?? 0;
    return html`
      <div
        style="padding: 10px; border: 1px dashed #3b82f6; border-radius: 6px; display: flex; flex-direction: column; gap: 6px"
      >
        <label style="font-size: 0.85rem; font-weight: 500; color: #3b82f6">
          ${props.label ?? 'Value'}: ${value}
        </label>
        <input
          type="range"
          min=${props.min ?? 0}
          max=${props.max ?? 100}
          .value=${String(value)}
          @input=${(event: Event) =>
            props.setValue?.(Number((event.target as HTMLInputElement).value))}
          style="width: 100%; cursor: pointer"
        />
      </div>
    `;
  }
}

customElements.define('sample-custom-slider', CustomSlider);

export const customSlider: WebComponentImplementation<typeof customSliderApi.schema> = {
  ...customSliderApi,
  tagName: 'sample-custom-slider',
  element: CustomSlider,
};
