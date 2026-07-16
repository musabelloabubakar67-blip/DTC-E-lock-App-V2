# Design - DTC E-Lock

A locked Hallmark design system for the DTC E-Lock operations app. App pages share this system; page-specific styling should extend these rules instead of inventing new local chrome.

## Genre
modern-minimal

## Macrostructure family
- App pages: Workbench cockpit with command bar, role-aware navigation, KPI strip, alert rail, and dense operational panels.
- Content pages: Focused console with one primary work surface and one supporting status column.
- Auth pages: Split operations briefing with compact sign-in surface.

## Theme
- `--color-paper` oklch(99% 0.004 255)
- `--color-paper-2` oklch(96.5% 0.012 255)
- `--color-panel` oklch(100% 0 0)
- `--color-ink` oklch(19% 0.045 258)
- `--color-ink-2` oklch(46% 0.035 258)
- `--color-rule` oklch(88% 0.018 255)
- `--color-accent` oklch(54% 0.22 260)
- `--color-navy` oklch(22% 0.09 260)
- `--color-danger` oklch(57% 0.22 25)
- `--color-warning` oklch(67% 0.18 58)
- `--color-ok` oklch(55% 0.16 150)

## Typography
- Display: system UI, weight 760, style normal.
- Body: system UI, weight 400-700.
- Mono: ui-monospace, weight 600.
- Numerals: tabular on metrics, tables, status rows, and export rows.

## Spacing
4-point named scale. New page CSS should use `tokens.css` variables and avoid raw spacing values where practical.

## Motion
- Easings: `--ease-out`, `--ease-in`, `--ease-in-out`.
- Reveal pattern: none for app pages.
- Reduced-motion fallback: opacity-only, <= 150 ms.

## Microinteractions stance
- Silent success; no celebratory toasts.
- Hover is subtle transform or tonal shift only.
- Focus rings appear instantly.

## CTA Voice
- Primary CTA: compact filled operational button.
- Secondary CTA: hairline button on panel/paper.
- Danger CTA: red only when action or state is destructive/critical.

## Per-page Allowances
- App pages must not use hero imagery or decorative backgrounds.
- Dashboard may use the widest KPI strip.
- Settings may use summary strips, but not decorative icon cards.
- Data management must read as a table/list, not card-in-card.

## What Pages Must Share
- DTC logo and deep navy command bar.
- Accent blue at <= 5% of each viewport.
- Radius 6px or less for operational surfaces.
- Lucide-style outlined icons.
- Tabular numerals for operational counts.

## What Pages May Differ On
- Panel grid proportions.
- Primary action placement.
- Empty-state copy and density.

