// A simple guard so nobody changes the store by accident. Every write asks for
// the password first. This is NOT security: the hash is in the page code.
//
// Two layers:
//  1. The screen asks for the password (PasswordGate) and runs the action with
//     runUnlocked().
//  2. adminGraphql refuses any GraphQL mutation unless it runs inside
//     runUnlocked(), so a write added later cannot skip the password.

/** SHA-256 of the password. */
export const PASSWORD_SHA256 = "c954bc71484992e72e66edbe1fd9ca28e7878c945011bff8ff5988a58bcc5c1f";

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkPassword(input: string): Promise<boolean> {
  if (!input) return false;
  return (await sha256Hex(input)) === PASSWORD_SHA256;
}

let unlockDepth = 0;

/** Runs `action` with writes allowed. Writes are blocked again when it ends. */
export async function runUnlocked<T>(action: () => Promise<T> | T): Promise<T> {
  unlockDepth++;
  try {
    return await action();
  } finally {
    unlockDepth--;
  }
}

export function isUnlocked(): boolean {
  return unlockDepth > 0;
}

/** True when the GraphQL text is a mutation (a write). Comments and spaces are skipped. */
export function isMutation(query: string): boolean {
  const body = query
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .trimStart();
  return /^mutation\b/.test(body);
}

export function assertUnlocked(): void {
  if (!isUnlocked()) {
    throw new Error("This change needs the password. Nothing was changed.");
  }
}
