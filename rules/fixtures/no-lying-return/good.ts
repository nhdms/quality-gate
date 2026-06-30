// CLEAN equivalent: a real transport whose result drives the return value.
// `emailSent` reflects what actually happened — no hardcoded success.
import { SmtpEmailTransport } from "./transports";

interface Message {
  id: string;
  to: string;
}

export async function dispatch(msg: Message) {
  const transport = new SmtpEmailTransport();
  const result = await transport.send(msg);
  return { emailSent: result.accepted.length > 0, id: msg.id };
}
