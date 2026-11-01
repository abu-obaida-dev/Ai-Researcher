/** Enforces provider input budgets while preserving system instructions and the latest user prompt. */

/** Estimated characters per token, calibrated for Arabic prompts. */
export const CHARS_PER_TOKEN = 2.1;
/** Leaves headroom for provider rate-based token limits. */
export const INPUT_BUDGETS = {
  groq: 4000
};

/** Per-model budgets stay below known provider limits. */
export const MODEL_INPUT_BUDGETS = {
  'openai/gpt-oss-20b': 4000,
  'qwen/qwen3.8-27b': 3600,
  'allam-2-7b': 2800
};

/** Uses the narrowest known budget for unknown models. */
export function budgetForModel(model, providerKey = 'groq') {
  const exact = MODEL_INPUT_BUDGETS[String(model || '').trim()];
  if (exact) return exact;
  const provider = INPUT_BUDGETS[providerKey] ?? INPUT_BUDGETS.groq;
  // Apply a conservative budget to unknown models.
  return Math.max(2000, Math.floor(provider * 0.8));
}


/** Minimum text retained from each file. */
export const MIN_FILE_CHARS = 600;

/** Marker appended within the file's character budget when truncated. */
const TRUNCATION_MARKER = '\n[… نُقص بقية الملف لضيق حدّ النموذج …]';

/** Estimates token count for text. */
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

/** Estimates token count for messages. */
export function estimateMessagesTokens(messages = []) {
  return messages.reduce((sum, message) => sum + estimateTokens(message?.content), 0);
}

/** Estimates total system and message tokens. */
export function measurePayloadTokens(system, messages = []) {
  return estimateTokens(system) + estimateMessagesTokens(messages);
}

/** Converts a token budget to an approximate character limit. */
export function tokensToChars(tokens) {
  return Math.floor(Number(tokens || 0) * CHARS_PER_TOKEN);
}

/** Truncates a file tail while retaining a minimum amount of context. */
function capFileText(text, maxChars) {
  const body = String(text || '');
  if (body.length <= maxChars) return body;
  const keep = Math.max(MIN_FILE_CHARS, maxChars);
  // Count the truncation marker within the file budget.
  const room = Math.max(0, keep - TRUNCATION_MARKER.length);
  return `${body.slice(0, room)}${TRUNCATION_MARKER}`;
}

/** Truncates tagged file blocks to a character budget. */
export function trimFilesInSystem(system, maxFileChars) {
  const text = String(system || '');
  const open = text.indexOf('<files>');
  const close = text.indexOf('</files>');
  if (open === -1 || close === -1 || close < open) {
    return { system: text, filesChars: 0 };
  }

  const before = text.slice(0, open);
  const block = text.slice(open, close + '</files>'.length);
  const after = text.slice(close + '</files>'.length);

  // Apply the budget to each tagged file block.
  const filePattern = /<file name="[^"]*">[\s\S]*?<\/file>/g;
  const parts = block.match(filePattern) || [];
  if (!parts.length) return { system: text, filesChars: 0 };

  const perFile = Math.max(MIN_FILE_CHARS, Math.floor(maxFileChars / parts.length));
  let filesChars = 0;
  const trimmed = parts.map((part) => {
    const head = part.slice(0, part.indexOf('>') + 1);
    const inner = part.slice(head.length, part.lastIndexOf('</file>'));
    const capped = capFileText(inner, perFile);
    filesChars += capped.length;
    return `${head}${capped}</file>`;
  });

  const newBlock = block.replace(filePattern, () => trimmed.shift());
  return { system: `${before}${newBlock}${after}`, filesChars };
}

/** Trims file text, older history, and finally nonessential system content to fit the budget. */
export function trimPayloadToBudget(system, messages = [], budget = INPUT_BUDGETS.groq) {
  // Preserve an explicit zero budget instead of using the default.
  const requested = Number(budget);
  const limit = Math.max(500, Number.isFinite(requested) ? requested : INPUT_BUDGETS.groq);
  const original = measurePayloadTokens(system, messages);
  if (original <= limit) {
    return { system, messages, tokens: original, trimmed: false, fileChars: 0 };
  }

  let nextSystem = String(system || '');
  let nextMessages = messages.map((message) => ({ ...message }));

  // First reserve budget for non-file content, then trim file text.
  const messagesTokens = estimateMessagesTokens(nextMessages);
  const nonFileSystemChars = nextSystem
    .replace(/<file name="[^"]*">[\s\S]*?<\/file>/g, '')
    .length;
  const nonFileTokens = estimateTokens('ا'.repeat(nonFileSystemChars)) + messagesTokens;
  const fileBudgetChars = tokensToChars(Math.max(0, limit - nonFileTokens));
  if (fileBudgetChars > 0) {
    nextSystem = trimFilesInSystem(nextSystem, fileBudgetChars).system;
  }

  // Next remove older history while preserving the latest user message.
  let guard = 0;
  while (measurePayloadTokens(nextSystem, nextMessages) > limit && guard < 100) {
    guard += 1;
    const index = nextMessages.findIndex(
      (message, position) => position < nextMessages.length - 1 && String(message?.content || '').length > 0
    );
    if (index === -1) break;
    const target = nextMessages[index];
    const content = String(target.content || '');
    target.content = content.slice(0, Math.floor(content.length / 2));
    if (!target.content.trim()) nextMessages.splice(index, 1);
  }

  // Last resort: remove complete file blocks, then trim the middle of system text.
  if (measurePayloadTokens(nextSystem, nextMessages) > limit) {
    // Retry with a tighter file budget before removing whole blocks.
    let guardFiles = 0;
    while (measurePayloadTokens(nextSystem, nextMessages) > limit && guardFiles < 12) {
      guardFiles += 1;
      const blocks = nextSystem.match(/<file name="[^"]*">[\s\S]*?<\/file>/g) || [];
      if (!blocks.length) break;
      const overflow = measurePayloadTokens(nextSystem, nextMessages) - limit;
      const currentFilesChars = blocks.join('').length;
      // Scale file text to the remaining overage with a safety margin.
      const cutChars = Math.max(200, Math.ceil((overflow * 2.1) + 100));
      const newPerFile = Math.max(0, Math.floor((currentFilesChars - cutChars) / blocks.length));
      if (newPerFile < MIN_FILE_CHARS) break;
      nextSystem = trimFilesInSystem(nextSystem, newPerFile * blocks.length).system;
    }

    // Remove complete file blocks only when no file text can fit.
    while (measurePayloadTokens(nextSystem, nextMessages) > limit) {
      const blocks = nextSystem.match(/<file name="[^"]*">[\s\S]*?<\/file>/g) || [];
      if (!blocks.length) break;
      const last = blocks[blocks.length - 1];
      nextSystem = nextSystem.replace(last, '');
    }

    if (measurePayloadTokens(nextSystem, nextMessages) > limit) {
      const overflow = measurePayloadTokens(nextSystem, nextMessages) - limit;
      const cutChars = tokensToChars(overflow) + 200;
      // Preserve the prompt prefix and suffix while trimming the middle.
      const head = nextSystem.slice(0, Math.floor(nextSystem.length * 0.35));
      const tail = nextSystem.slice(Math.max(0, nextSystem.length - Math.floor(nextSystem.length * 0.35)));
      const middle = nextSystem.slice(Math.floor(nextSystem.length * 0.35), Math.max(0, nextSystem.length - Math.floor(nextSystem.length * 0.35)));
      nextSystem = `${head}${middle.slice(0, Math.max(0, middle.length - cutChars))}${tail}`;
    }
  }

  const fileChars = (nextSystem.match(/<file name="[^"]*">[\s\S]*?<\/file>/g) || []).join('').length;
  return {
    system: nextSystem,
    messages: nextMessages,
    tokens: measurePayloadTokens(nextSystem, nextMessages),
    trimmed: true,
    fileChars
  };
}
