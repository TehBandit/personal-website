import path from "path";

export const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

export function isValidWorkspaceSlug(workspace) {
  return typeof workspace === "string" && /^[a-z0-9-]+$/.test(workspace);
}

export function resolveWorkspaceDirs(workspace) {
  if (!isValidWorkspaceSlug(workspace)) return null;
  const wsDir = path.join(WORKSPACES_DIR, workspace);
  return {
    wsDir,
    notesDir: path.join(wsDir, "notes"),
  };
}
