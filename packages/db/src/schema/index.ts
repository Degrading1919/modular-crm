export * from "./identity.ts";
export * from "./crm.ts";
export * from "./operations.ts";
export * from "./finance.ts";
export * from "./systems.ts";
export * from "./platform.ts";
export * from "./capabilities.ts";

import * as identity from "./identity.ts";
import * as crm from "./crm.ts";
import * as operations from "./operations.ts";
import * as finance from "./finance.ts";
import * as systems from "./systems.ts";
import * as platform from "./platform.ts";
import * as capabilities from "./capabilities.ts";

export const schema = { ...identity, ...crm, ...operations, ...finance, ...systems, ...platform, ...capabilities };
