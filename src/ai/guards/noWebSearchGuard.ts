export class ExternalSearchToolForbiddenError extends Error {
  readonly offendingPath: string;

  constructor(offendingPath: string, reason: string) {
    super(
      `External web search / grounding tools are strictly forbidden (${offendingPath}): ${reason}`,
    );
    this.name = 'ExternalSearchToolForbiddenError';
    this.offendingPath = offendingPath;
  }
}

const FORBIDDEN_KEYS_LOWER = new Set([
  'googlesearch',
  'google_search',
  'google_search_retrieval',
  'googlesearchretrieval',
  'web_search',
  'websearch',
  'web_search_preview',
  'websearchpreview',
  'web_search_options',
  'websearchoptions',
  'search_grounding',
  'searchgrounding',
  'grounding',
  'groundingmetadata',
  'grounding_metadata',
  'tools',
  'tool_choice',
  'toolchoice',
  'functions',
  'function_call',
  'functioncall',
]);

const FORBIDDEN_PLUGIN_MARKERS = ['web', 'search', 'online', 'grounding'];

const MODEL_KEYS_LOWER = new Set(['model', 'modelid', 'model_id']);

function containsWebPluginMarker(value: unknown, visited: WeakSet<object>): boolean {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return FORBIDDEN_PLUGIN_MARKERS.some((marker) => lower.includes(marker));
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsWebPluginMarker(item, visited));
  }
  if (value !== null && typeof value === 'object') {
    if (visited.has(value)) {
      return false;
    }
    visited.add(value);
    return Object.entries(value as Record<string, unknown>).some(([k, v]) => {
      const keyLower = k.toLowerCase();
      if (FORBIDDEN_PLUGIN_MARKERS.some((marker) => keyLower.includes(marker))) {
        return true;
      }
      return containsWebPluginMarker(v, visited);
    });
  }
  return false;
}

function inspectNode(
  node: unknown,
  path: string,
  visited: WeakSet<object>,
  parentKeyLower?: string,
): void {
  if (node === null || node === undefined) {
    return;
  }

  if (typeof node === 'string') {
    if (parentKeyLower && MODEL_KEYS_LOWER.has(parentKeyLower)) {
      if (node.toLowerCase().includes(':online')) {
        throw new ExternalSearchToolForbiddenError(
          path,
          `Model identifier "${node}" enables forbidden ":online" web search suffix.`,
        );
      }
    }
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  if (visited.has(node)) {
    return;
  }
  visited.add(node);

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      inspectNode(node[i], `${path}[${i}]`, visited);
    }
    return;
  }

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue;
    }
    const keyLower = key.toLowerCase();
    const nextPath = `${path}.${key}`;

    if (FORBIDDEN_KEYS_LOWER.has(keyLower)) {
      throw new ExternalSearchToolForbiddenError(
        nextPath,
        `Forbidden key "${key}" is not allowed in AI request payloads.`,
      );
    }

    if (keyLower === 'plugins') {
      if (containsWebPluginMarker(value, new WeakSet<object>())) {
        throw new ExternalSearchToolForbiddenError(
          nextPath,
          'Web/search plugin configuration is forbidden in "plugins".',
        );
      }
    }

    inspectNode(value, nextPath, visited, keyLower);
  }
}

/**
 * Recursively inspects an outgoing LLM/embedding payload and throws
 * ExternalSearchToolForbiddenError if any web-search, grounding,
 * tool-calling, or `:online` model suffix is present.
 */
export function assertNoExternalSearchTools(payload: unknown): void {
  inspectNode(payload, '$', new WeakSet<object>());
}
