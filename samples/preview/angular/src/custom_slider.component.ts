/**
 * The sample catalog's custom component in Angular: a slider that binds a
 * number and writes it back to the data model as it is dragged, as
 * upstream's Angular explorer has it.
 */
import {CatalogComponent, createComponentImplementation} from '@a2ui/angular/v0_9';
import {type ComponentApi, DynamicNumberSchema, DynamicStringSchema} from '@a2ui/web_core/v0_9';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {z} from 'zod';

const customSliderApi = {
  name: 'CustomSlider',
  schema: z.object({
    label: DynamicStringSchema.optional(),
    value: DynamicNumberSchema.optional(),
    min: DynamicNumberSchema.optional(),
    max: DynamicNumberSchema.optional(),
  }),
} satisfies ComponentApi;

@Component({
  selector: 'sample-custom-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="custom-slider">
      <label
        >{{ props()['label']?.value() ?? 'Value' }}: {{ props()['value']?.value() ?? 0 }}</label
      >
      <input
        type="range"
        [min]="props()['min']?.value() ?? 0"
        [max]="props()['max']?.value() ?? 100"
        [value]="props()['value']?.value() ?? 0"
        (input)="onInput($event)"
      />
    </div>
  `,
  styles: `
    .custom-slider {
      padding: 10px;
      border: 1px dashed #3b82f6;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 0.85rem;
      font-weight: 500;
      color: #3b82f6;
    }
    input {
      width: 100%;
      cursor: pointer;
    }
  `,
})
export class CustomSliderComponent extends CatalogComponent<typeof customSliderApi> {
  protected onInput(event: Event): void {
    this.props()['value']?.onUpdate(Number((event.target as HTMLInputElement).value));
  }
}

export const customSlider = createComponentImplementation(customSliderApi, CustomSliderComponent);
