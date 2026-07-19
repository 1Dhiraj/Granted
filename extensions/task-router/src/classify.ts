export type TaskKind = "browser" | "desktop" | "chat" | "unknown";

const MAX_SCAN_CHARS = 2000;

// Gateway-injected timestamp prefix, e.g. "[Thu 2026-06-12 10:00 IST] open notepad".
const LEADING_BRACKET_PREFIX = /^\s*\[[^\]]{0,80}\]\s*/;

// Informational openers: "how do I open notepad" is a question, not a command.
const QUESTION_PREFIX =
  /^(?:how|what|what's|whats|why|when|where|who|which|is|are|does|do you|can you explain|could you explain|explain|tell me|describe|define|difference between)\b/i;

const URL_SIGNAL =
  /\bhttps?:\/\/|\bwww\.[a-z0-9-]+|\b[a-z0-9][a-z0-9-]*\.(?:com|org|net|io|ai|dev|co|in|gov|edu|me|app)\b/i;

const BROWSER_STRONG: RegExp[] = [
  URL_SIGNAL,
  /\b(?:website|web ?page|web ?site|browser|web search|online form|web app)\b/i,
  /\b(?:google|youtube|amazon|flipkart|gmail|github|linkedin|twitter|facebook|instagram|reddit|wikipedia|stack ?overflow|chatgpt)\b/i,
  /\b(?:log ?in|log ?into|sign ?in|sign ?up)\b/i,
  /\bfill\b[\s\S]{0,40}\bform\b/i,
  /\b(?:add to cart|checkout|place (?:an |the |my )?order|track (?:my |the )?order)\b/i,
  /\bbook (?:a |an |the |me )?(?:ticket|flight|hotel|cab|taxi|train|bus|movie|appointment)\b/i,
  /\b(?:search|look (?:it |this |that )?up|find)\b[\s\S]{0,60}\b(?:online|on the web|on the internet|on google)\b/i,
  /\b(?:navigate to|go to|visit)\b[\s\S]{0,40}\b(?:site|page|url|website|link)\b/i,
  /\bdownload\b[\s\S]{0,60}\bfrom\b/i,
];

const BROWSER_WEAK: RegExp[] = [
  /\b(?:tab|url|link|webpage|homepage|search results?)\b/i,
  /\bsearch (?:for|about)\b/i,
  /\bbrowse\b/i,
  /\bscroll\b/i,
];

const DESKTOP_STRONG: RegExp[] = [
  /\b(?:notepad|calculator|wordpad|ms ?paint|mspaint|file explorer|windows explorer|task manager|control panel|device manager|regedit|registry editor|command prompt|cmd|powershell|terminal|onenote|vlc|spotify|visual studio|vs ?code|vscode)\b/i,
  // Office apps and "paint"/"word" only with app-like context — the bare words
  // are common English ("one word", "you excel at", "paint a picture").
  /\b(?:ms |microsoft )(?:word|excel|powerpoint|outlook|paint)\b|\bexcel\b(?!\s+(?:at|in)\b)|\b(?:word|powerpoint|outlook) (?:document|doc|file|presentation|email|app)\b|\b(?:open|launch|start|close|use|switch to) (?:word|excel|powerpoint|outlook|paint)\b/i,
  /\b(?:taskbar|start menu|system tray|recycle bin|wallpaper|screen ?saver|this pc|my computer|context menu)\b/i,
  /\b(?:minimize|maximize|restore|resize|drag)\b[\s\S]{0,30}\bwindow\b|\bwindow\b[\s\S]{0,30}\b(?:minimize|maximize|close)\b/i,
  /\b(?:install|uninstall)\b[\s\S]{0,40}\b(?:app|application|program|software)\b/i,
  /\b(?:set|turn|increase|decrease|raise|lower|adjust|change|max)\b[\s\S]{0,24}\b(?:volume|brightness)\b|\b(?:mute|unmute)\b/i,
  /\b(?:create|make|new)\b[\s\S]{0,30}\b(?:file|folder|directory)\b/i,
  /\b(?:rename|move|copy|delete)\b[\s\S]{0,40}\b(?:file|folder|directory)\b/i,
  /\b(?:on|in|of) (?:my|this|the) (?:pc|computer|laptop|machine|system|desktop)\b/i,
  /\bdesktop app(?:lication)?s?\b/i,
  /\b(?:notification center|action center|settings app|windows settings|system settings)\b/i,
];

const DESKTOP_WEAK: RegExp[] = [
  /\b(?:app|application|program|window|folder|shortcut)\b/i,
  /\b(?:launch|start up)\b/i,
  /\bscreenshot\b/i,
  /\btype\b[\s\S]{0,30}\b(?:in|into)\b/i,
  /\bdesktop\b/i,
];

function scoreSignals(text: string, strong: RegExp[], weak: RegExp[]): number {
  let score = 0;
  for (const re of strong) {
    if (re.test(text)) {
      score += 2;
    }
  }
  for (const re of weak) {
    if (re.test(text)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Keyword/regex classification of a user message.
 *
 * Returns "browser"/"desktop" only on confident signals (score >= 2),
 * "chat" when the message reads as an informational question, and
 * "unknown" when there is no confident signal either way — callers may
 * escalate "unknown" to an LLM classifier.
 */
export function classifyTaskHeuristic(prompt: string): TaskKind {
  const text = prompt.replace(LEADING_BRACKET_PREFIX, "").trim().slice(0, MAX_SCAN_CHARS);
  if (!text) {
    return "unknown";
  }

  const browserScore = scoreSignals(text, BROWSER_STRONG, BROWSER_WEAK);
  const desktopScore = scoreSignals(text, DESKTOP_STRONG, DESKTOP_WEAK);
  const best = Math.max(browserScore, desktopScore);

  if (QUESTION_PREFIX.test(text)) {
    // "how do I rename a folder" is a question about automation, not a request
    // to perform it. Very strong signals (e.g. an explicit URL plus actions)
    // still win so "how about you open https://… and fill the form" routes.
    return best >= 5 ? pickAutomationKind(browserScore, desktopScore) : "chat";
  }

  if (best === 0) {
    return "unknown";
  }
  if (best < 2) {
    // A single weak signal ("open…", "this app…") is not enough to commit.
    return "unknown";
  }
  return pickAutomationKind(browserScore, desktopScore);
}

function pickAutomationKind(browserScore: number, desktopScore: number): TaskKind {
  if (desktopScore > browserScore) {
    return "desktop";
  }
  return "browser";
}

const TRIVIAL_MAX_CHARS = 60;

// Messages that never carry task intent: greetings, thanks, farewells, pings.
// Deliberately EXCLUDES bare acknowledgements ("ok", "yes", "done", "sure") —
// those are often answers to a question the agent just asked mid-task, and a
// canned lite reply would hijack the flow.
const TRIVIAL_PATTERNS: RegExp[] = [
  /^(?:hi+|hello+|hey+|yo|hola|namaste|sup|wh?as+up|what'?s up)(?: there| granted| bot)?[!.😊🙂👋 ]*$/iu,
  /^good (?:morning|afternoon|evening)(?: granted| bot)?[!,. ]*$/i,
  /^(?:how are you|how'?s it going|how r u|hru)[?!. ]*$/i,
  /^(?:thanks|thank you|thank u|thx|ty|tysm)(?: a lot| so much| bro| man| granted)?[!,.😊🙏 ]*$/iu,
  /^(?:bye+|goodbye|see ya|see you|cya|good ?night|gn)[!,. ]*$/i,
  /^(?:ping|test|testing)[!,. ]*$/i,
];

/**
 * True only for short, standalone social messages (greetings, thanks, pings)
 * that can be answered by a tiny model with no tools, no history, and no
 * system prompt. Anything uncertain returns false so the full agent handles it.
 */
export function isTrivialMessage(prompt: string): boolean {
  const text = prompt.replace(LEADING_BRACKET_PREFIX, "").trim();
  if (!text || text.length > TRIVIAL_MAX_CHARS || text.includes("\n")) {
    return false;
  }
  return TRIVIAL_PATTERNS.some((re) => re.test(text));
}
