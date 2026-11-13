/**
 * The custom slider's markup: a labelled range input. It is the module's
 * only export, so the dev server swaps a saved edit into the page in place.
 */
export function SliderBody({
  label,
  value,
  min,
  max,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Called with the value as the slider is dragged. */
  onValue: (value: number) => void;
}) {
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
        {label}: {value}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={event => onValue(Number(event.target.value))}
        style={{width: '100%', cursor: 'pointer'}}
      />
    </div>
  );
}
