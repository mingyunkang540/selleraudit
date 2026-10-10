# Design

## Source of truth
- Status: Active. Last refreshed: 2026-10-09.
- Primary surface: SellerAudit V0.1 Foundation, Korean desktop SaaS at 1440px.
- Evidence: both user product specifications and two attached six-screen reference boards. The narrower Foundation request controls scope. Existing parent RetirePay is unrelated and preserved; no SellerAudit components or assets existed.

## Brand
- Calm, precise operational control. Navy navigation, blue actions, restrained green/amber/red statuses.
- Show demo provenance, real seed counts, and explicit pending features; no fabricated live activity.

## Product goals
- Find a product by Sabangnet code or SKU, inspect BOM and channels, resolve manual mapping and audit work.
- No SCM parsing, adapters, automated matching/auditing, API synchronization, orders, stock movements or financial settlement.
- Success: all seven acceptance scenarios work and edits survive refresh in local demo storage.

## Personas and jobs
- Korean brand/distributor MD teams managing many channels.
- Search, compare and investigate at a desk; dense tables with consistent navigation.

## Information architecture
- Sidebar: Dashboard; Product Master, SKU Master; Channel Matrix; Mapping Center, Audit Center; Channels, Workspace.
- Hash routes: /dashboard, /products, /products/:id, /skus, /channels, /mapping, /audit, /settings/channels, /settings/workspace.
- Page title and purpose → search/filters → metrics or table → details and actions. Product code always accompanies the name.

## Design principles
- Search first, direct product links, channel matrix cell details, status text plus color.
- Tables take priority over decorative cards. Dashboard cards summarize actionable records.
- References guide visual direction; no claim of exact image reproduction.

## Visual language
- Background #f5f7fb, white panels, navy #15213b, blue #4563ee, restrained semantic colors.
- System Korean fonts; body 13–14px, heading 26px; tabular numerals and generous row height.
- 4px spacing scale, panel radius 10–12px, subtle borders and minimal shadow.
- No required motion; respect reduced motion. Product thumbnails are simple local decorative container SVGs, not product photography.

## Components
- Shared PageHeader, SearchInput, FilterBar, DataTable, StatusBadge, IssueBadge, ChannelBadge, EmptyState, KpiCard, Drawer, ConfirmDialog.
- CSS tokens and shared components live in src/styles.css and src/components; no new UI dependency.
- Hover, focus, disabled, busy and error variants are explicit.

## Accessibility
- Target WCAG AA; visible keyboard focus, skip link, descriptive labels and semantic tables.
- Interactive rows include actual links/buttons; dialogs trap focus, close with Escape and restore focus.
- Status never depends on color alone. No flashing content or automatic motion.

## Responsive behavior
- 1440px desktop first, 1024px compact, mobile sidebar toggle below 800px.
- Wide tables scroll within their panel; content must not overflow the viewport.
- Accessible hit areas and no hover-only information.

## Interaction states
- Initial loading, repository failure with retry, empty datasets, no search results, unmapped offers and unregistered channels have dedicated text.
- Mapping confirmation names both source and target; save is atomic and failures remain visible.
- Demo writes persist in this browser; no background network calls. Storage failures are reported, not swallowed.

## Content voice
- Clear Korean operational language: 사방넷 품번, 판매상품, 실물 SKU, 구성(BOM), 매핑, 검수.
- Display '데모 워크스페이스' and mock suggestion provenance. Do not call a seeded metric real-time.

## Implementation constraints
- React + TypeScript + Vite, plain CSS, native React state. Existing toolchain versions reused.
- UI accesses repositories and selectors, not Supabase queries. SQL isolates workspaces and validates cross-entity relationships.
- Verify with domain tests, browser acceptance scenarios, responsive screenshots, typecheck, lint and production build.

## Open questions
- Actual SCM files and real Supabase project/member provisioning are future integration inputs; they do not block local Foundation.
