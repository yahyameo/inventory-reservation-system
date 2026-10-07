/** Source of the current time. Injected so expiry logic can be tested without sleeping. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
