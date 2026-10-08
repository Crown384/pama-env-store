// Only import this module from Convex server-side actions. The key never enters the browser or DB.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}
function unbase64(input: string): Uint8Array {
  return Uint8Array.from(atob(input), (character) => character.charCodeAt(0));
}

export async function sha256(text: string): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}

export function token(): string {
  return base64(crypto.getRandomValues(new Uint8Array(36))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function equalsSecret(a: string, b: string): Promise<boolean> {
  const left = unbase64(await sha256(a));
  const right = unbase64(await sha256(b));
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = process.env.SECRET_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Encryption is not configured");
  const bytes = unbase64(encoded);
  if (bytes.length !== 32) throw new Error("Encryption key must be 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(plaintext));
  return "v1:" + base64(iv) + ":" + base64(new Uint8Array(result));
}

export async function decrypt(value: string): Promise<string> {
  const [version, iv, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("Unsupported encrypted data");
  return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv) }, await encryptionKey(), unbase64(ciphertext)));
}