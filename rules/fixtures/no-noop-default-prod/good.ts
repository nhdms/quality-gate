// CLEAN equivalent: the provider is required. When EMAIL_PROVIDER is unset the
// code THROWS instead of silently falling back to a no-op stub. Non-stub
// defaults for genuinely optional config (PORT, LOG_LEVEL) are still fine.
export function resolveProvider() {
  const provider = process.env.EMAIL_PROVIDER;
  if (!provider) {
    throw new Error("EMAIL_PROVIDER must be set");
  }
  const port = process.env.PORT || 3000;
  const level = process.env.LOG_LEVEL ?? "info";
  return createTransport(provider, port, level);
}

declare function createTransport(name: string, port: number, level: string): unknown;
