export type EnvEntry = { key: string; value: string };
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseDotenv(source: string): EnvEntry[] {
  const items: EnvEntry[] = [];
  const seen = new Set<string>();
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const pair = line.replace(/^export\s+/, "");
    const separator = pair.indexOf("=");
    if (separator <= 0) throw new Error("Line " + (index + 1) + " is not KEY=VALUE");
    const key = pair.slice(0, separator).trim();
    if (!KEY.test(key) || key.length > 128) throw new Error("Invalid key on line " + (index + 1));
    if (seen.has(key)) throw new Error("Duplicate key in import: " + key);
    seen.add(key);
    let value = pair.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else if (value.includes(" #")) {
      value = value.split(" #")[0].trimEnd();
    }
    if (value.length > 16_384) throw new Error("Value too large for " + key);
    items.push({ key, value });
  }
  if (items.length > 100) throw new Error("Import up to 100 keys at once");
  return items;
}

export function downloadEnv(name: string, values: Record<string, string>) {
  const escaped = Object.entries(values).map(([key, value]) => key + '="' + value
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n") + '"').join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([escaped], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name + ".env";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}