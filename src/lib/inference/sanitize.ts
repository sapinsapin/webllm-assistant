const CONTROL_TOKEN_PATTERNS: RegExp[] = [
  /<end_of_turn>/g,
  /<start_of_turn>(?:user|model|assistant)?\n?/g,
  /<eos>/g,
  /<bos>/g,
  /<\|im_start\|>(?:user|assistant|system)?\n?/g,
  /<\|im_end\|>/g,
  /<\|endoftext\|>/g,
];

export function stripControlTokens(text: string): string {
  let cleaned = text;
  for (const pattern of CONTROL_TOKEN_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned;
}
