import type { NextRequest } from 'next/server';
import { jsonError } from './errors';

export type AuthMode = 'disabled' | 'dev_headers';

export type AuthRole = 'owner' | 'editor' | 'viewer';

export type AuthContext = {
  mode: AuthMode;
  user: string;
  role: AuthRole;
};

const ROLE_ORDER: Record<AuthRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

function parseAuthMode(value: string | undefined): AuthMode {
  const trimmed = (value || '').trim();
  if (trimmed === 'disabled') return 'disabled';
  if (trimmed === 'dev_headers') return 'dev_headers';
  return 'dev_headers';
}

function parseRole(value: string | null): AuthRole | null {
  const trimmed = (value || '').trim();
  if (trimmed === 'owner' || trimmed === 'editor' || trimmed === 'viewer') return trimmed;
  return null;
}

export function getAuthContext(request: NextRequest): AuthContext {
  const mode = parseAuthMode(process.env.OMNI_AUTH_MODE);
  if (mode === 'disabled') {
    return {
      mode,
      user: 'system',
      role: 'owner',
    };
  }

  const user = request.headers.get('x-dev-user');
  const role = parseRole(request.headers.get('x-dev-role'));
  return {
    mode,
    user: (user || '').trim(),
    role: role || 'viewer',
  };
}

export function requireRole(request: NextRequest, required: AuthRole) {
  const auth = getAuthContext(request);
  if (auth.mode === 'disabled') return null;

  if (!auth.user) {
    return jsonError(401, 'UNAUTHENTICATED', 'Missing x-dev-user');
  }

  const requiredRank = ROLE_ORDER[required];
  const currentRank = ROLE_ORDER[auth.role];
  if (currentRank < requiredRank) {
    return jsonError(403, 'FORBIDDEN', `Requires role ${required}`);
  }

  return null;
}
