const SENSITIVE_INPUT_TYPES = new Set(['password']);

const SENSITIVE_NAME_PATTERNS = [
  /passw/i,
  /credit.?card/i,
  /card.?number/i,
  /cvv/i,
  /cvc/i,
  /ssn/i,
  /social.?security/i,
  /bank.?account/i,
  /routing.?number/i,
];

export function isSensitiveElement(element: Element): boolean {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    return false;
  }

  const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : 'textarea';
  if (SENSITIVE_INPUT_TYPES.has(type)) {
    return true;
  }

  const autocomplete = element.getAttribute('autocomplete') ?? '';
  if (autocomplete && /(cc-|password)/i.test(autocomplete)) {
    return true;
  }

  const haystack = `${element.getAttribute('name') ?? ''} ${element.id} ${element.className}`.trim();
  return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function sanitizePromptText(text: string, maxLength = 1500): string {
  const trimmed = text.trim();
  const escaped = trimmed
    .replace(/```/g, '\\`\\`\\`')
    .replace(/[<>{}\[\]]/g, (ch) => `\\${ch}`);
  return escaped.slice(0, maxLength);
}
