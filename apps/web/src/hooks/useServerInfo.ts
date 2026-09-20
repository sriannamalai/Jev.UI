// Loads the three pieces of server-side state the top bar needs — health,
// the model list, and the set list — each independently so that one
// resource failing (e.g. `/api/models` erroring) never blocks the others
// from rendering. Failures are kept per-resource in `error`, never thrown.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelInfo, SetSummary } from '@jev-ui/core/browser';
import type { createApi } from '../api.js';

type Api = ReturnType<typeof createApi>;
type Health = Awaited<ReturnType<Api['health']>>;

export interface ServerInfoError {
  health?: string;
  models?: string;
  sets?: string;
}

export interface ServerInfo {
  health: Health | undefined;
  models: ModelInfo[];
  sets: SetSummary[];
  refreshSets: () => void;
  error: ServerInfoError;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useServerInfo(api: Api): ServerInfo {
  const [health, setHealth] = useState<Health | undefined>(undefined);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [error, setError] = useState<ServerInfoError>({});
  const mountedRef = useRef(true);

  const refreshSets = useCallback(() => {
    async function load() {
      try {
        const result = await api.listSets();
        if (!mountedRef.current) return;
        setSets(result);
        setError((e) => (e.sets === undefined ? e : { ...e, sets: undefined }));
      } catch (err) {
        if (!mountedRef.current) return;
        setError((e) => ({ ...e, sets: errorMessage(err) }));
      }
    }
    void load();
  }, [api]);

  useEffect(() => {
    mountedRef.current = true;

    async function loadHealth() {
      try {
        const result = await api.health();
        if (mountedRef.current) setHealth(result);
      } catch (err) {
        if (mountedRef.current) setError((e) => ({ ...e, health: errorMessage(err) }));
      }
    }

    async function loadModels() {
      try {
        const result = await api.models();
        if (mountedRef.current) setModels(result);
      } catch (err) {
        if (mountedRef.current) setError((e) => ({ ...e, models: errorMessage(err) }));
      }
    }

    void loadHealth();
    void loadModels();
    refreshSets();

    return () => {
      mountedRef.current = false;
    };
  }, [api, refreshSets]);

  return { health, models, sets, refreshSets, error };
}
