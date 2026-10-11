import { sql, type SQLWrapper } from "drizzle-orm";

/** Match resolveActor's jobs.start role defaults and explicit permission overrides. */
export function fieldWorkerSql(roleId: SQLWrapper, roleKey: SQLWrapper) {
  return sql<boolean>`coalesce((select p.allowed from role_permissions p where p.role_template_id=${roleId} and p.permission_key='jobs.start'), ${roleKey} in ('owner','office','technician'))`;
}
