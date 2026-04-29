// Host-agent REST API client.
//
// All calls go to http://127.0.0.1:7420/api/v1 (localhost only — the API is
// never exposed to the network per docker-compose.yml).
//
// In browser/non-Tauri mode this module still works because the API is HTTP —
// calls will just fail with a network error if no stack is running, which the
// UI handles as a disconnected state.

import type {
  CreateAllocationRequest,
  HostAgentAllocation,
  HostAgentConfig,
  HostAgentError,
  HostAgentEvent,
  HostAgentHealth,
  HostAgentInfo,
  HostAgentInviteBundle,
  HostAgentOverlayStatus,
  HostAgentSftpStatus,
  HostAgentStatus,
  HostAgentStorageStatus,
  OwnerAccessResponse,
  PatchAllocationRequest,
} from './host-agent-types';

export class HostAgentApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = 'HostAgentApiError';
  }
}

// Known error codes from the API contract
export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'NOT_FOUND',
  'INVALID_STATE',
  'INVALID_KEY',
  'INVITE_EXPIRED',
  'QUOTA_STILL_CRITICAL',
  'ALLOC_ID_MISMATCH',
  'MATCH_ID_MISMATCH',
  'INTERNAL',
  'NETWORK_ERROR',
] as const;

export type ApiErrorCode = typeof API_ERROR_CODES[number] | string;

const DEFAULT_BASE = 'http://127.0.0.1:7420/api/v1';

function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
}

async function apiFetch<T>(
  baseUrl: string,
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  // In Tauri, route through Rust to avoid WebKit mixed-content blocking
  if (isTauri()) {
    return apiFetchTauri<T>(path, token, options);
  }

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...((options.headers ?? {}) as Record<string, string>) },
    });
  } catch (e) {
    throw new HostAgentApiError(
      'NETWORK_ERROR',
      `Cannot reach host agent: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!resp.ok) {
    let body: HostAgentError = { error: resp.statusText, code: 'UNKNOWN' };
    try {
      body = (await resp.json()) as HostAgentError;
    } catch {
      /* use default */
    }
    throw new HostAgentApiError(body.code || 'UNKNOWN', body.error || resp.statusText, resp.status);
  }

  if (resp.status === 204) return undefined as unknown as T;
  return resp.json() as Promise<T>;
}

async function apiFetchTauri<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  const method = (options.method ?? 'GET').toUpperCase();
  const body = typeof options.body === 'string' ? options.body : undefined;

  let result: { status: number; body: string; ok: boolean };
  try {
    result = await invoke<{ status: number; body: string; ok: boolean }>('host_agent_http', {
      args: { method, path, token: token ?? undefined, body },
    });
  } catch (e) {
    throw new HostAgentApiError(
      'NETWORK_ERROR',
      `Cannot reach host agent: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!result.ok) {
    let errorBody: HostAgentError = { error: `HTTP ${result.status}`, code: 'UNKNOWN' };
    try {
      errorBody = JSON.parse(result.body) as HostAgentError;
    } catch { /* use default */ }
    throw new HostAgentApiError(errorBody.code || 'UNKNOWN', errorBody.error || `HTTP ${result.status}`, result.status);
  }

  if (result.status === 204) return undefined as unknown as T;
  return JSON.parse(result.body) as T;
}

export function getInfo(baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentInfo>(baseUrl, '/info', null);
}

export function getStatus(token: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentStatus>(baseUrl, '/status', token);
}

export function getConfig(token: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentConfig>(baseUrl, '/config', token);
}

export function patchConfig(token: string, patch: Partial<HostAgentConfig>, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentConfig>(baseUrl, '/config', token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function getHealth(token: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentHealth>(baseUrl, '/health', token);
}

export function getOverlayStatus(token: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentOverlayStatus>(baseUrl, '/overlay/status', token);
}

export function getSftpStatus(token: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentSftpStatus>(baseUrl, '/sftp/status', token);
}

export function getStorageStatus(token: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentStorageStatus>(baseUrl, '/storage/status', token);
}

export async function listAllocations(token: string, baseUrl = DEFAULT_BASE) {
  const r = await apiFetch<{ allocations: HostAgentAllocation[] }>(baseUrl, '/allocations', token);
  return r.allocations ?? [];
}

export function createAllocation(
  token: string,
  request: CreateAllocationRequest,
  baseUrl = DEFAULT_BASE,
) {
  return apiFetch<HostAgentAllocation>(baseUrl, '/allocations', token, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getAllocation(token: string, allocId: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentAllocation>(baseUrl, `/allocations/${allocId}`, token);
}

export function patchAllocation(
  token: string,
  allocId: string,
  patch: PatchAllocationRequest,
  baseUrl = DEFAULT_BASE,
) {
  return apiFetch<HostAgentAllocation>(baseUrl, `/allocations/${allocId}`, token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function generateInvite(token: string, allocId: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentInviteBundle>(baseUrl, `/allocations/${allocId}/invite`, token, {
    method: 'POST',
  });
}

export function importOwnerResponse(
  token: string,
  allocId: string,
  response: OwnerAccessResponse,
  baseUrl = DEFAULT_BASE,
) {
  return apiFetch<HostAgentAllocation>(baseUrl, `/allocations/${allocId}/owner-response`, token, {
    method: 'POST',
    body: JSON.stringify(response),
  });
}

export function suspendAllocation(token: string, allocId: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentAllocation>(baseUrl, `/allocations/${allocId}/suspend`, token, {
    method: 'POST',
  });
}

export function resumeAllocation(token: string, allocId: string, baseUrl = DEFAULT_BASE) {
  return apiFetch<HostAgentAllocation>(baseUrl, `/allocations/${allocId}/resume`, token, {
    method: 'POST',
  });
}

export function retireAllocation(
  token: string,
  allocId: string,
  graceDays: number,
  baseUrl = DEFAULT_BASE,
) {
  return apiFetch<HostAgentAllocation>(baseUrl, `/allocations/${allocId}/retire`, token, {
    method: 'POST',
    body: JSON.stringify({ graceDays }),
  });
}

export async function getEvents(
  token: string,
  options: { limit?: number; after?: string } = {},
  baseUrl = DEFAULT_BASE,
) {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.after) params.set('after', options.after);
  const q = params.toString();
  const r = await apiFetch<{ events: HostAgentEvent[] }>(
    baseUrl,
    `/events${q ? `?${q}` : ''}`,
    token,
  );
  return r.events ?? [];
}

// ── Validation helpers ────────────────────────────────────────────────────────

export function validateOwnerResponseShape(raw: unknown): raw is OwnerAccessResponse {
  if (typeof raw !== 'object' || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj['kind'] === 'nasbb.owner_access_response' &&
    typeof obj['matchId'] === 'string' &&
    typeof obj['allocId'] === 'string' &&
    typeof obj['ownerPublicKey'] === 'string' &&
    typeof obj['requestedSftpUsername'] === 'string'
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof HostAgentApiError) {
    const codeLabel = err.code && err.code !== 'UNKNOWN' ? ` [${err.code}]` : '';
    return `${err.message}${codeLabel}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
