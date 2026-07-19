export type AppViewport = 'phone' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

export function classifyAppViewport(width: number, shortestScreenSide: number): AppViewport {
  // Visible width wins so tablet split-screen and narrow desktop windows keep usable phone navigation.
  if (width <= 760) return 'phone';

  if (shortestScreenSide >= 560 && width <= 1100) {
    return width <= 900 ? 'tablet-portrait' : 'tablet-landscape';
  }

  return 'desktop';
}
