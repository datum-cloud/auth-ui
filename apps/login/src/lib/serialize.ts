/**
 * Converts protobuf message objects into plain JSON-serializable objects
 * suitable for passing across the React Server Component → Client Component
 * boundary. Protobuf-ES v2 messages can contain bigint values and
 * null-prototype objects that RSC serialization rejects.
 */
export function toPlainObject<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? Number(v) : v)),
  );
}
