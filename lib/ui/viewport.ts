export type AppViewport = 'phone' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

export function classifyAppViewport(width: number, shortestScreenSide: number): AppViewport {
  // Keep genuinely narrow split-screen layouts in phone mode, while allowing Android tablets
  // that report a scaled 600px visual viewport to use the tablet rail and camera layout.
  if (width < 560) return 'phone';

  if (shortestScreenSide >= 560 && width <= 1100) {
    return width <= 900 ? 'tablet-portrait' : 'tablet-landscape';
  }

  if (width <= 760) return 'phone';

  return 'desktop';
}
