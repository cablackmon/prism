export type SpeechLanguage = Readonly<{ tag: string; label: string }>;

export type SpeechLanguageConfiguration =
  | { ok: true; language: string; languages: SpeechLanguage[] }
  | { ok: false; message: string };

const CONFIGURATION_ERROR = 'Speech languages are not configured correctly.';

/** Validate only explicit caller preferences, without reading a browser locale. */
export function normalizeSpeechLanguages(
  language: unknown,
  options: unknown,
): SpeechLanguageConfiguration {
  const invalid = (): SpeechLanguageConfiguration => ({ ok: false, message: CONFIGURATION_ERROR });
  const canonical = (value: unknown): string | null => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 64) return null;
    try {
      return Intl.getCanonicalLocales(value)[0] ?? null;
    } catch {
      return null;
    }
  };
  const selected = canonical(language);
  if (!selected || !Array.isArray(options) || options.length < 1 || options.length > 100) return invalid();
  const languages: SpeechLanguage[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    if (typeof option !== 'object' || option === null) return invalid();
    const { tag, label } = option as { tag?: unknown; label?: unknown };
    const normalized = canonical(tag);
    if (!normalized || seen.has(normalized) || typeof label !== 'string') return invalid();
    const trimmed = label.trim();
    if (!trimmed || Array.from(trimmed).length > 80 || /[\u0000-\u001f\u007f]/u.test(trimmed)) return invalid();
    seen.add(normalized);
    languages.push({ tag: normalized, label: trimmed });
  }
  return seen.has(selected) ? { ok: true, language: selected, languages } : invalid();
}

export function isSpeechSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

/** Bound displayed partials without splitting surrogate pairs or storing hidden text. */
export function clipSpeechInterim(value: unknown): string {
  if (typeof value !== 'string') return '';
  let result = '';
  let count = 0;
  for (const character of value) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(character)) continue;
    if (count === 2000) return `${result}…`;
    result += character;
    count += 1;
  }
  return result;
}

/** A supplied logical target is distinct from current focus while using panel controls. */
export function isSpeechTarget(target: Element | null): target is HTMLElement {
  if (!target || !target.isConnected) return false;
  if (target.closest('[hidden], [inert], [aria-disabled="true"], [aria-readonly="true"]')) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input') {
    const input = target as HTMLInputElement;
    return ['text', 'search', 'email'].includes(input.type) && !input.matches(':disabled') && !input.readOnly;
  }
  if (tag === 'textarea') {
    const textarea = target as HTMLTextAreaElement;
    return !textarea.matches(':disabled') && !textarea.readOnly;
  }
  const editable = target.closest('[contenteditable]');
  const attribute = editable?.getAttribute('contenteditable')?.toLowerCase();
  return (attribute === '' || attribute === 'true' || attribute === 'plaintext-only') &&
    target.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export type SpeechAnchorRect = Readonly<{ left: number; top: number; width: number; height: number }>;
export type SpeechPanelPosition = Readonly<{
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
}>;

/** Fixed viewport coordinates. All geometry is explicit and independently testable. */
export function positionSpeechPanel(
  anchor: SpeechAnchorRect,
  panel: Readonly<{ width: number; height: number }>,
  viewport: Readonly<{ width: number; height: number }>,
): SpeechPanelPosition | null {
  const values = [anchor.left, anchor.top, anchor.width, anchor.height, panel.width, panel.height, viewport.width, viewport.height];
  if (!values.every(Number.isFinite) || anchor.width <= 0 || anchor.height <= 0 ||
      panel.width <= 0 || panel.height <= 0 || viewport.width <= 16 || viewport.height <= 16) return null;
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  if (!Number.isFinite(right) || !Number.isFinite(bottom) || right <= 0 || bottom <= 0 ||
      anchor.left >= viewport.width || anchor.top >= viewport.height) return null;
  const width = Math.min(360, panel.width, viewport.width - 16);
  const above = Math.max(0, Math.min(viewport.height - 16, anchor.top - 16));
  const below = Math.max(0, Math.min(viewport.height - 16, viewport.height - bottom - 16));
  const placement = above >= panel.height ? 'above' : below >= panel.height ? 'below' : above >= below ? 'above' : 'below';
  const maxHeight = placement === 'above' ? above : below;
  if (maxHeight <= 0) return null;
  const height = Math.min(panel.height, maxHeight);
  const desiredTop = placement === 'above' ? anchor.top - 8 - height : bottom + 8;
  return {
    left: Math.max(8, Math.min(anchor.left, viewport.width - width - 8)),
    top: Math.max(8, Math.min(desiredTop, viewport.height - height - 8)),
    width,
    maxHeight,
    placement,
  };
}
