/** Shared, strict validation for machine API lookups. Pure for unit testing. */
export type MachineLookup = {
  slug?: string;
  environment?: "staging" | "production";
  key?: string;
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function validSlug(slug: string): boolean {
  return slug.length <= 64 && SLUG.test(slug);
}
export function validKey(key: string): boolean {
  return key.length <= 128 && KEY.test(key);
}
export function parseMachineLookup(params: URLSearchParams): MachineLookup {
  const fields = ["slug", "environment", "key"];
  for (const name of params.keys()) {
    if (!fields.includes(name) || params.getAll(name).length !== 1) throw new Error("Invalid request");
  }
  const slug = params.get("slug");
  const environment = params.get("environment");
  const key = params.get("key");
  if (slug !== null && !validSlug(slug)) throw new Error("Invalid request");
  if (environment !== null && environment !== "staging" && environment !== "production") throw new Error("Invalid request");
  if (environment !== null && !slug) throw new Error("Invalid request");
  if (key !== null && (!validKey(key) || !environment || !slug)) throw new Error("Invalid request");
  return {
    ...(slug !== null ? { slug } : {}),
    ...(environment !== null ? { environment } : {}),
    ...(key !== null ? { key } : {}),
  };
}
export function dotenvExport(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => {
    if (!validKey(key)) throw new Error("Invalid environment key");
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    return key + '="' + escaped + '"';
  }).join("\n") + "\n";
}
