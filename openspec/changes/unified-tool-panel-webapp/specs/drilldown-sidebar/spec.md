## REMOVED Requirements

### Requirement: Sidebar displays filtered transactions for selected Dashboard cell
**Reason**: Superseded by the `tool-panel` 類別 tab, which is self-contained (no Dashboard cell selection).
**Migration**: Open `交易工具 → 開啟面板` and use the 類別 tab; pick a category row to drill into its transactions.

### Requirement: Sidebar header shows summary stats
**Reason**: Stats are now shown in the `tool-panel` item-detail view.
**Migration**: Drill into a category (or TAG) in the panel to see total / count / largest stats.

### Requirement: Transaction list displays card-style entries
**Reason**: The card-style list is reused inside the `tool-panel` detail view.
**Migration**: No action — the same card presentation appears in the panel.

### Requirement: Sidebar styling
**Reason**: The sidebar is replaced by the full-page Web App panel.
**Migration**: No action — styling is carried into `ToolPanel.html`.
