/** @jsxImportSource hono/jsx */

export type BatteryIndicatorProps = {
  value: number | null | undefined;
  voltage?: number | null;
};

export function BatteryIndicator({ value, voltage }: BatteryIndicatorProps) {
  if (value == null) return null;
  // Spread title conditionally — hono/jsx renders `title={undefined}` as a stray attribute slot
  // (`<span class="ds-battery" >`), so omit the key entirely when voltage is absent.
  const titleAttr = voltage != null ? { title: `${voltage.toFixed(2)} V` } : {};
  return (
    <span class="ds-battery" {...titleAttr}>
      <span class="ds-battery__shell">
        <span class="ds-battery__fill" style={`width: ${value}%`} />
      </span>
      <span class="ds-battery__pct">{value}%</span>
    </span>
  );
}
