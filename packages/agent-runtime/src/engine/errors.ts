/** The fence failed: another worker holds the actor now. Nothing this process writes can land. */
export class LeaseLostError extends Error {
  constructor(readonly actorId: string) {
    super(`lease lost on actor ${actorId}`);
    this.name = 'LeaseLostError';
  }
}

/** New input arrived; the turn stopped at a step boundary and the next one answers everything. */
export class SupersededSignal extends Error {
  constructor(readonly turnId: string) {
    super(`turn ${turnId} superseded`);
    this.name = 'SupersededSignal';
  }
}
