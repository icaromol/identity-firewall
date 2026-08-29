import type { FormDetectedMessage } from '../../shared/messages';
import { normalizeOrigin } from '../../shared/origin';
import { classifyForm } from '../firewall/classifier';
import { recordFormDetection } from '../session/state';

export async function handleFormDetected(
  message: FormDetectedMessage,
): Promise<{ recorded: true }> {
  const { origin, forms, detectedAt } = message.payload;
  await recordFormDetection(normalizeOrigin(origin), forms.map(classifyForm), detectedAt);
  return { recorded: true };
}
