// KNOWN-BAD (from audit, variable-assignment form): dispatch.ts sets an
// `emailSent` flag to `true` after calling an UnimplementedEmailTransport, then
// returns that variable. Same lie as bad.ts — the success is hardcoded, not
// derived from the transport result — but expressed as an assignment rather
// than a literal in the returned object, so it slipped past the first shape.
import { UnimplementedEmailTransport } from "./transports";

interface Message {
  id: string;
  to: string;
  channels: string[];
}

export async function dispatch(input: Message) {
  const transport = new UnimplementedEmailTransport();
  let emailSent = false;
  if (input.channels.includes("EMAIL")) {
    await transport.send(input);
    // Lying assignment: set to true unconditionally, not from the send result.
    emailSent = true;
  }
  return { emailSent, id: input.id };
}
