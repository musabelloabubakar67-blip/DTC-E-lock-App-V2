# 001 - Add physical press feedback

- **Status**: DONE
- **Commit**: bdfdecb
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 2 files, small CSS-only change

## Problem

Pressable controls currently darken with a filter instead of physically responding to the pointer. In a field operations app, buttons and nav items are touched constantly; they need immediate pointer-down feedback without looking decorative.

```css
/* app/globals.css:128 - current */
button:active,
.btn:active {
  filter: brightness(0.96);
}
```

The motion standards call for `transform: scale(0.97)` on press with a `160ms ease-out` transform transition. The current `filter` also risks reintroducing the icon halo/shadow feeling the dark theme recently tried to remove.

## Target

Add shared motion tokens and replace brightness-only feedback with a subtle physical press. Use transform and opacity-friendly motion only.

```css
/* tokens.css - target additions/replacements */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--dur-press: 160ms;
```

```css
/* app/globals.css - target */
button,
.btn,
.nav__link,
.nav__more,
.dd-quick__grid a,
.action-tile,
.settings-icon-button,
.export-card__actions .btn {
  transition:
    transform var(--dur-press) var(--ease-out),
    background-color 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    opacity 180ms ease;
}

button:active,
.btn:active,
.nav__link:active,
.nav__more:active,
.dd-quick__grid a:active,
.action-tile:active,
.settings-icon-button:active {
  filter: none;
  transform: scale(0.97);
}
```

## Repo conventions to follow

- Motion tokens already live in `tokens.css`, alongside `--dur-short` and `--dur-med`.
- Visual overrides live at the end of `app/globals.css`; add the final press-feedback override there so it wins against older layers.
- Do not introduce a motion dependency. This app is CSS-first.

## Steps

1. Update `tokens.css` so `--ease-out` is exactly `cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out` is exactly `cubic-bezier(0.77, 0, 0.175, 1)`, and add `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);` plus `--dur-press: 160ms;`.
2. Append the target transition block to the end of `app/globals.css`.
3. Keep `filter: none` in the active rule so the old brightness effect cannot stack with the scale feedback.
4. Do not add hover scale here. This plan is press feedback only.

## Boundaries

- Do NOT change React/TSX files.
- Do NOT add new dependencies.
- Do NOT animate layout properties like width, height, margin, padding, top, or left.
- If the cited button rule has moved substantially, stop and report instead of improvising.

## Verification

- **Mechanical**: run `npm run typecheck`; it should pass.
- **Feel check**: run the app, press dashboard quick actions, settings icon buttons, export buttons, and the mobile bottom nav.
- Confirm press response is visible on pointer-down, not only after click.
- In Chrome DevTools Animations, slow playback to 10% and confirm only `transform` changes on press.
- Toggle `prefers-reduced-motion`; press feedback may remain subtle, but should not move across the screen.
- **Done when**: pressing a control feels immediate and physical, and the dark theme shows no brightness halo around icons.
