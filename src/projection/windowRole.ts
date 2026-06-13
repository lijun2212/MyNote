export type WindowRole = "main" | "projection-preview";

const VALID_WINDOW_ROLES: ReadonlySet<WindowRole> = new Set(["main", "projection-preview"]);

function readWindowRoleFromLocation(): unknown {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URLSearchParams(window.location.search).get("windowRole") ?? undefined;
}

function formatInvalidRole(role: unknown) {
  if (typeof role === "string") {
    return `"${role}"`;
  }

  try {
    return JSON.stringify(role);
  } catch {
    return String(role);
  }
}

export function resolveWindowRole(role: unknown, mode = import.meta.env.MODE): WindowRole {
  if (role === undefined) {
    return "main";
  }

  if (typeof role === "string" && VALID_WINDOW_ROLES.has(role as WindowRole)) {
    return role as WindowRole;
  }

  const message = `Invalid MyNote window role ${formatInvalidRole(role)}. Expected "main" or "projection-preview".`;

  if (mode === "production") {
    console.warn(message);
    return "main";
  }

  throw new Error(message);
}

export function getCurrentWindowRole(): WindowRole {
  const injectedRole = (globalThis as { __MYNOTE_WINDOW_ROLE__?: unknown }).__MYNOTE_WINDOW_ROLE__;
  const role = injectedRole ?? readWindowRoleFromLocation();

  return resolveWindowRole(role);
}