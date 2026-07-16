# 002 - Materialize the mobile More panel

- **Status**: DONE
- **Commit**: bdfdecb
- **Severity**: MEDIUM
- **Category**: Interruptibility & timing
- **Estimated scope**: 1 file, CSS-only change

## Problem

The mobile More panel is currently hidden with `display: none` and appears with `display: grid`. That makes the panel teleport instead of arriving from the bottom nav trigger, which weakens spatial consistency on the app's most important mobile navigation surface.

```css
/* app/globals.css:4766 - current */
.nav__more-panel {
  position: fixed;
  left: 10px;
  right: 10px;
  bottom: 76px;
  z-index: 49;
  display: none;
  max-height: min(56vh, 430px);
  overflow: auto;
  padding: 8px;
  background: var(--color-panel);
  border: var(--rule-hairline);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-strong);
}

/* app/globals.css:4782 - current */
.nav[data-more-open="true"] .nav__more-panel {
  display: grid;
  gap: 4px;
}
```

Because `display` cannot transition, repeated open/close feels abrupt. This is an occasional drawer-like UI, so a standard under-300ms materialization is appropriate.

## Target

Keep the panel in the layout layer and animate compositor-friendly properties only.

```css
/* app/globals.css - target inside the existing max-width: 900px block */
.nav__more-panel {
  display: grid;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(10px) scale(0.98);
  transform-origin: bottom right;
  transition:
    opacity 180ms var(--ease-out),
    transform 220ms var(--ease-drawer);
  will-change: opacity, transform;
}

.nav[data-more-open="true"] .nav__more-panel {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .nav__more-panel {
    transform: none;
    transition: opacity 120ms ease;
  }
}
```

## Repo conventions to follow

- Mobile nav CSS already lives in `app/globals.css` under `@media (max-width: 900px)`.
- Use the repo token from plan 001: `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);`.
- The panel already has a material surface, border, and shadow. Do not redesign it in this plan.

## Steps

1. In `app/globals.css`, find the `@media (max-width: 900px)` `.nav__more-panel` block.
2. Replace `display: none;` with `display: grid; gap: 4px; opacity: 0; pointer-events: none; transform: translateY(10px) scale(0.98); transform-origin: bottom right; transition: opacity 180ms var(--ease-out), transform 220ms var(--ease-drawer); will-change: opacity, transform;`.
3. Replace the open state so it no longer sets `display`; it should set `opacity: 1; pointer-events: auto; transform: translateY(0) scale(1);`.
4. Add the reduced-motion override shown above near the existing reduced-motion section or inside the mobile media block.

## Boundaries

- Do NOT change `app/(app)/_components/Nav.tsx` unless CSS cannot solve the issue.
- Do NOT animate height, bottom, max-height, padding, or display.
- Do NOT add bounce; this is a professional operations dashboard.

## Verification

- **Mechanical**: run `npm run typecheck`; it should pass.
- **Feel check**: open the app below 900px width, tap More, tap a link, reopen More quickly.
- Confirm the panel appears from the bottom-right/nav source and can be rapidly toggled without jumping from zero.
- In DevTools at 10% animation speed, confirm opacity and transform move together.
- Toggle `prefers-reduced-motion` and confirm the panel fades without vertical movement.
- **Done when**: the mobile More panel feels app-native and spatially connected to the bottom nav.
