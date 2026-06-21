/** Base class for all errors thrown by the Jetpack protocol. */
export class JetpackError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = "JetpackError";
  }
}

/** The cap's expiry timestamp has passed. */
export class CapExpiredError extends JetpackError {
  constructor() { super("Spending cap has expired", 0); }
}

/** The cap's spend limit has been reached. */
export class CapExhaustedError extends JetpackError {
  constructor() { super("Spending cap limit reached", 1); }
}

/** The payee address is not on the cap's allowlist. */
export class UnauthorizedPayeeError extends JetpackError {
  constructor() { super("Payee is not on the cap's allowlist", 2); }
}

/** The caller is not the cap's owner. */
export class NotOwnerError extends JetpackError {
  constructor() { super("Caller is not the cap owner", 3); }
}

/** The caller is not the cap's authorised agent. */
export class NotAgentError extends JetpackError {
  constructor() { super("Caller is not the cap agent", 4); }
}

/** The cap has been revoked by its owner. */
export class CapRevokedError extends JetpackError {
  constructor() { super("Spending cap has been revoked", 5); }
}

const ERROR_MAP: Record<number, () => JetpackError> = {
  0: () => new CapExpiredError(),
  1: () => new CapExhaustedError(),
  2: () => new UnauthorizedPayeeError(),
  3: () => new NotOwnerError(),
  4: () => new NotAgentError(),
  5: () => new CapRevokedError(),
};

/**
 * Parses a Sui transaction error and returns a typed JetpackError if the
 * error originates from the Jetpack Move module. Returns null otherwise.
 */
export function parseError(err: unknown): JetpackError | null {
  const msg = String(err);
  const match = msg.match(/MoveAbort\(.+?,\s*(\d+)\)/);
  if (!match) return null;
  const code = parseInt(match[1], 10);
  const factory = ERROR_MAP[code];
  return factory ? factory() : new JetpackError(`Unexpected error code: ${code}`, code);
}
