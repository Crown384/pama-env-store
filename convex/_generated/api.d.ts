/* eslint-disable */
/** Generated API references. Run convex codegen after connecting the deployment. */
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as store from "../store.js";
import type * as vault from "../vault.js";
declare const fullApi: ApiFromModules<{ store: typeof store; vault: typeof vault }>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;