function toArrayBuffer(input: string | ArrayBuffer | Uint8Array): ArrayBuffer {
  if (typeof input === 'string') {
    const encoded = new TextEncoder().encode(input);
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  }
  if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    return copy.buffer;
  }
  return input;
}

/**
 * Computes the lowercase hexadecimal SHA-256 digest of a string or binary buffer
 * using the Web Crypto API.
 */
export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = toArrayBuffer(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry !== undefined) {
      sorted[key] = canonicalizeValue(entry);
    }
  }
  return sorted;
}

/**
 * Computes a deterministic SHA-256 hash of a JSON-serializable value by
 * recursively sorting all object keys.
 */
export async function hashJsonStable(value: unknown): Promise<string> {
  const canonical = canonicalizeValue(value);
  return sha256Hex(JSON.stringify(canonical));
}
