// App-owned metafields on the app installation (namespace "$app").
// This is the only place the app keeps its own data: no database.
// About 2 MB per value, and uninstalling the app deletes them (gotcha 10),
// so keep saved shapes backward compatible when they change.

import { adminGraphql, assertNoUserErrors } from "./admin";

const NAMESPACE = "$app";
const MAX_BYTES = 1_900_000;

type ReadResult = {
  currentAppInstallation: {
    id: string;
    metafield: { value: string } | null;
  };
};

const READ = `#graphql
  query ReadAppData($namespace: String!, $key: String!) {
    currentAppInstallation {
      id
      metafield(namespace: $namespace, key: $key) { value }
    }
  }`;

const WRITE = `#graphql
  mutation WriteAppData($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key }
      userErrors { field message }
    }
  }`;

/** Reads a JSON value saved by this app. Returns `fallback` when nothing is saved yet. */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const data = await adminGraphql<ReadResult>(READ, { namespace: NAMESPACE, key });
  const raw = data.currentAppInstallation.metafield?.value;
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`The saved data "${key}" could not be read. It may be damaged.`);
  }
}

/** Saves a JSON value. Throws if it is too large or Shopify refuses it. */
export async function writeJson(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  if (new Blob([json]).size > MAX_BYTES) {
    throw new Error(`The data for "${key}" is too large to save (limit about 2 MB).`);
  }
  const owner = await adminGraphql<ReadResult>(READ, { namespace: NAMESPACE, key });
  const res = await adminGraphql<{
    metafieldsSet: { userErrors: { field: string[] | null; message: string }[] };
  }>(WRITE, {
    metafields: [
      {
        ownerId: owner.currentAppInstallation.id,
        namespace: NAMESPACE,
        key,
        type: "json",
        value: json,
      },
    ],
  });
  assertNoUserErrors(res.metafieldsSet.userErrors, `Saving "${key}"`);
}
