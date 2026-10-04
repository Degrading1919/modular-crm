"use client";

import NextLink from "next/link";
import { createContext, useContext, type ComponentProps } from "react";
import type { Permission } from "@modular-crm/domain";
import { canUseAction, canUseSurface, createPermissions, type WorkspaceAccess } from "../lib/workspace-access";

export const WorkspaceAccessContext = createContext<WorkspaceAccess>({ role: "", permissions: [], features: {} });
export const useWorkspaceAccess = () => useContext(WorkspaceAccessContext);

/** Workspace links share the same destination decision as sidebar and routes. */
export function WorkspaceLink({ permission, feature, ...props }: ComponentProps<typeof NextLink> & { permission?: Permission; feature?: string }) {
  const access = useWorkspaceAccess();
  const href = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
  if (href.startsWith("/app/")) {
    const surface = href.slice(5).split(/[/?#]/)[0];
    const action = permission ?? (href.includes("new=1") ? createPermissions[surface] : undefined);
    if (!canUseSurface(access, href) || (action && !canUseAction(access, surface, [action], feature))) return null;
  }
  return <NextLink {...props}/>;
}
