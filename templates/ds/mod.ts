// DesignSystem — consolidated barrel. A Plugin can pull any component from
// here (`import { Page, Layout, Title } from "@ds"`). The barrel is an
// additional front door, not a replacement: every component stays importable
// directly via the `@ds/` prefix (e.g. `"@ds/page/Page.tsx"`) — see ADR-0008.

// Foundation
export * from "./styles/Styles.tsx";
export * from "./page/Page.tsx";

// Layout
export * from "./layout/Layout.tsx";
export * from "./layout/Content.tsx";
export * from "./layout/Grid.tsx";
export * from "./layout/Flex.tsx";
export * from "./layout/Columns.tsx";

// Typography
export * from "./typography/Title.tsx";
export * from "./typography/Value.tsx";
export * from "./typography/Label.tsx";
export * from "./typography/Description.tsx";

// Item
export * from "./item/Item.tsx";

// Chrome
export * from "./chrome/StatusBar.tsx";
export * from "./chrome/BatteryIndicator.tsx";
export * from "./chrome/EmptyState.tsx";
