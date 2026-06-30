// KNOWN-BAD (from audit): fillr lib/email/client.ts. When EMAIL_PROVIDER is
// unset the provider silently resolves to a "test" no-op that drops every
// email while reporting success. No NODE_ENV guard, no throw.
export function resolveProvider() {
  const provider = process.env.EMAIL_PROVIDER ?? "test";
  return createTransport(provider);
}

declare function createTransport(name: string): unknown;
