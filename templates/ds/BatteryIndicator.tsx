/** @jsxImportSource hono/jsx */

export type BatteryIndicatorProps = {
  value: number | null | undefined;
  voltage?: number | null;
};

export function BatteryIndicator({ value, voltage }: BatteryIndicatorProps) {
  if (value == null) return null;
  const title = voltage != null ? `${voltage.toFixed(2)} V` : undefined;
  return (
    <span class="ds-battery" title={title}>
      <span class="ds-battery__shell">
        <span class="ds-battery__fill" style={`width: ${value}%`} />
      </span>
      <span class="ds-battery__pct">{value}%</span>
    </span>
  );
}
