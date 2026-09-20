export interface Stub {
  readonly port: number;
  readonly requests: unknown[];
  readonly badAuth: number;
  close(): Promise<void>;
}

export function startStub(): Promise<Stub>;
