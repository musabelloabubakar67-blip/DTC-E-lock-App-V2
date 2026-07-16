# 003 - Gate hover motion and tighten dashboard micro-interactions

- **Status**: DONE
- **Commit**: bdfdecb
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, CSS-only change

## Problem

The dashboard CTA hover uses movement outside a pointer-capability media query, and touch devices can trigger hover-like states on tap. This is especially risky on the mobile-heavy DTC app because hover motion can feel like a delayed or accidental tap response.

```css
/* app/globals.css:5000 - current */
.dd-alert > a:hover {
  text-decoration: none;
  transform: translateY(-1px);
}
```

```css
/* app/globals.css:5080 - current */
.dd-quick__grid a:hover {
  transform: none;
}
```

The standards require hover motion to be gated behind `@media (hover: hover) and (pointer: fine)`. Frequently used hover effects should be reduced or tonal; this operations dashboard should stay crisp and restrained.

## Target

Move hover transform into a desktop-pointer media query, keep mobile/touch interaction to press feedback from plan 001, and use short color/background transitions.

```css
/* app/globals.css - target */
.dd-alert > a:hover {
  text-decoration: none;
}

@media (hover: hover) and (pointer: fine) {
  .dd-alert > a:hover {
    transform: translateY(-1px);
  }

  .nav__link:hover,
  .dd-quick__grid a:hover,
  .action-tile:hover,
  .settings-icon-button:hover,
  .export-card__actions .btn:hover {
    transition-duration: 180ms;
  }
}

@media (hover: none), (pointer: coarse) {
  .dd-alert > a:hover,
  .nav__link:hover,
  .dd-quick__grid a:hover,
  .action-tile:hover,
  .settings-icon-button:hover,
  .export-card__actions .btn:hover {
    transform: none;
  }
}
```

## Repo conventions to follow

- Final visual correction rules live at the bottom of `app/globals.css`.
- Press feedback should come from plan 001, not hover.
- The design direction is restrained: no bounce, no decorative lift on dense operational controls.

## Steps

1. Append the target hover-gating block to the end of `app/globals.css`.
2. Do not remove existing hover color/background rules; let them remain as tonal feedback.
3. Ensure any transform-based hover is inside `@media (hover: hover) and (pointer: fine)`.
4. Ensure coarse pointer devices explicitly reset transform to `none`.

## Boundaries

- Do NOT add JavaScript.
- Do NOT animate keyboard focus. Focus must remain immediate and visible.
- Do NOT create new hover transforms for every card. This plan is only to constrain existing hover motion.

## Verification

- **Mechanical**: run `npm run typecheck`; it should pass.
- **Feel check**: on desktop, hover the dashboard alert CTA and quick actions; movement should be subtle and instant.
- In mobile emulation, tap quick actions and the alert CTA; hover transform should not linger after tap.
- Toggle keyboard navigation with Tab; focus rings should appear without animated delay.
- **Done when**: pointer users get restrained hover polish, while touch users get clean press feedback with no sticky hover movement.
