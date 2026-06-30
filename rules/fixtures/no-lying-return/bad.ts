// KNOWN-BAD (from audit): dispatch.ts returns emailSent:true over an
// UnimplementedEmailTransport — the email is never sent, yet the caller is
// told it was. This is the "optimistic success signaling" defect class.
import { UnimplementedEmailTransport } from "./transports";

interface Message {
  id: string;
  to: string;
}

export async function dispatch(msg: Message) {
  const transport = new UnimplementedEmailTransport();
  await transport.send(msg);
  // Lying return: hardcoded success over a transport that does nothing.
  return { emailSent: true, id: msg.id };
}
