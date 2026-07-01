// CLEAN equivalent of the variable-assignment form: the `emailSent` flag is
// initialised from the real transport's result via a `const` declarator, then
// returned. There is no bare `emailSent = true` reassignment, so shape 2 does
// not match — the flag genuinely reflects what the real transport reported.
import { SmtpEmailTransport } from "./transports";

interface Message {
  id: string;
  to: string;
  channels: string[];
}

export async function dispatch(input: Message) {
  const transport = new SmtpEmailTransport();
  const result = await transport.send(input);
  const emailSent = result.accepted.length > 0;
  return { emailSent, id: input.id };
}
