export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}

export class AuthzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthzError';
  }
}

/**
 * Exhaustiveness guard for discriminated unions consumed via switch. TypeScript refuses to
 * compile a call site that hasn't handled every member of the union (the `never` parameter
 * type), so adding a new variant without updating every switch is a build error, not a
 * silent fall-through. At runtime — e.g. if a value arrives from outside the type system's
 * guarantees — it fails closed by throwing rather than treating the unknown case as safe.
 */
export function assertNever(value: never, context?: string): never {
  throw new BusinessError(
    `Unhandled case${context ? ` in ${context}` : ''}: ${JSON.stringify(value)}`,
  );
}
