import type { PiiCategory } from "@skrim/schema";

import type { PageObservationMessage } from "../messages.ts";
import type { NameFinder } from "../pii/gliner.js";
import { fieldCategory, type NameLookup } from "../pii/redact.js";
import { findRegexCandidates, type PiiCandidate } from "../pii/regex.js";
import { labelBefore } from "./redact.ts";

/**
 * Which names and addresses are hidden, and which go to the server as written.
 *
 * GLiNER finds names but cannot tell the user's from anyone else's: it hid 52
 * names on Wikipedia's main page, and "search for alan turing" reached the
 * server as "search for <PII:NAME:1>". Asking it for "famous
 * person" too did not help: it called Asha Rao and Rahul famous as well. So
 * the rule comes from where a name appears. Hidden:
 *
 * - every name and address on a personal page: one that shows the user's
 *   data (an email address, a phone, card, account or ID number, or a
 *   filled-in personal form field). An inbox, an order, an account page.
 * - anywhere, a name right after words that address the user ("Welcome
 *   back", "Signed in as", "Hi", "Deliver to"), and an address right after it.
 * - every name and address in the goal, public or not. The goal is the
 *   user's own words, and no rule tells "find Rahul Sharma's profile" from
 *   "search for Alan Turing" (a rule on words like "email" or "call" let the
 *   first through). Privacy wins that trade: a public name hidden costs the
 *   planner a little context, a private one sent cannot be taken back.
 * - anywhere, a name or address already hidden in this task, however it is
 *   written: the header's "Asha Rao" stays hidden in the profile card, and
 *   the goal's "Rahul Sharma" on every page. Otherwise the server could match
 *   a hidden name in one place to the same name readable in another.
 *
 * Everything else is public and stays readable: names in articles, news and
 * search results, unless the goal named them. The model runs only where its
 * answer matters: the goal, every text on a personal page, and elsewhere only
 * texts with those words in them, so a public page like Wikipedia costs no
 * model time at all.
 */

const PAGE_CUES = String.raw`hello|hi|hey|dear|welcome(?: back)?|good (?:morning|afternoon|evening)|signed in as|logged in as|my name is|i am|i'm|deliver(?:ing)? to|ship(?:ping)? to|bill(?:ing)? to`;

/** Cue words at the end of what comes before a name: "Welcome back, " then "Asha". */
const PAGE_CUE_BEFORE = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])(?:${PAGE_CUES})[\s,:!-]*$`, "iu");
/** A text worth running the model on, on a public page. */
const MENTIONS_PAGE_CUE = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])(?:${PAGE_CUES})(?![\p{L}\p{N}])`, "iu");

/** Shorter known values would match inside ordinary words. */
const MIN_KNOWN_LENGTH = 3;

type Mode = "all" | "page";

const normalise = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** Whether a page shows the user's own data. Regex and field hints only: no model. */
export function isPersonalPage(observation: PageObservationMessage, texts: readonly string[], faces: number = 0): boolean {
  if (texts.some((text) => findRegexCandidates(text).length > 0)) return true;
  const elements = observation.elements ?? [];
  return elements.some((element, index) => {
    // A value labelled by the element before it: "Aadhaar", then "2345 6789 0123".
    const context = labelBefore(elements, index);
    if (context && findRegexCandidates(`${context}: ${element.label}`).length > 0) return true;
    const field = observation.fields?.[element.id];
    if (!field || !element.value?.trim()) return false;
    return field.inputType === "password" || fieldCategory(field.inputType, field.autocomplete) !== undefined;
  });
}

/**
 * The candidates right after cue words, and any that continue straight on
 * from one: "Deliver to Rahul Sharma, 12 MG Road" keeps the name and the address.
 */
function afterCues(text: string, candidates: readonly PiiCandidate[], cueBefore: RegExp): PiiCandidate[] {
  const kept: PiiCandidate[] = [];
  let runEnd = -1;
  for (const candidate of [...candidates].sort((left, right) => left.start - right.start)) {
    const continues = runEnd >= 0 && /^[\s,;:()-]*$/.test(text.slice(runEnd, candidate.start));
    if (continues || cueBefore.test(text.slice(0, candidate.start))) {
      kept.push(candidate);
      runEnd = candidate.end;
    }
  }
  return kept;
}

export class PrivateNames {
  /** What the model found in each text it has read, by the exact text. */
  private readonly found = new Map<string, PiiCandidate[]>();
  /** Private names and addresses seen in this task, normalised. */
  private readonly known = new Map<string, PiiCategory>();
  private knownPattern: RegExp | null = null;
  private mode: Mode = "page";

  constructor(
    private finder: NameFinder | undefined,
    /** Called once if the model cannot run. Known names are still hidden. */
    private readonly onFailure: (error: unknown) => void,
  ) {}

  /** Before redacting a page view: decides whether it is personal, runs the model where needed, and learns its private names. */
  async preparePage(observation: PageObservationMessage, texts: readonly string[], faces: number = 0): Promise<{ personal: boolean; lookup: NameLookup }> {
    const personal = isPersonalPage(observation, texts, faces);
    this.mode = personal ? "all" : "page";
    for (const element of observation.elements ?? []) {
      const field = observation.fields?.[element.id];
      const category = field ? fieldCategory(field.inputType, field.autocomplete) : undefined;
      if ((category === "NAME" || category === "ADDRESS") && element.value) this.remember(element.value, category);
    }
    for (const text of texts) {
      for (const candidate of findRegexCandidates(text)) {
        if (candidate.category === "EMAIL") {
          const local = candidate.text.split("@")[0].replace(/[._+-]/g, " ");
          if (local.length >= MIN_KNOWN_LENGTH) this.remember(local, "NAME");
        }
      }
    }
    await this.scan(personal ? texts : texts.filter((text) => MENTIONS_PAGE_CUE.test(text)));
    // Learn first, redact after: a name hidden in the header must be hidden
    // in the text above it too.
    this.learn(texts, this.lookup);
    return { personal, lookup: this.lookup };
  }

  /**
   * The goal, once, before the first page view: every name in it is hidden,
   * there and on every page after.
   */
  async prepareGoal(goal: string): Promise<NameLookup> {
    await this.scan([goal]);
    const lookup = this.lookupFor("all");
    this.learn([goal], lookup);
    return lookup;
  }

  /** Texts seen after an action (what its target shows, an extracted value), under the current page's rule. */
  async prepareTexts(texts: readonly (string | undefined)[]): Promise<void> {
    const present = texts.filter((text): text is string => Boolean(text?.trim()));
    await this.scan(this.mode === "all" ? present : present.filter((text) => MENTIONS_PAGE_CUE.test(text)));
    this.learn(present, this.lookup);
  }

  /** The current page's rule. */
  readonly lookup: NameLookup = (text) => this.lookupFor(this.mode)(text);

  private lookupFor(mode: Mode): NameLookup {
    return (text) => {
      const model = this.found.get(text) ?? [];
      const chosen = mode === "all" ? model : afterCues(text, model, PAGE_CUE_BEFORE);
      const known = this.knownIn(text).filter((candidate) => !chosen.some((other) => candidate.start < other.end && candidate.end > other.start));
      return [...chosen, ...known];
    };
  }

  private async scan(texts: readonly string[]): Promise<void> {
    const fresh = [...new Set(texts)].filter((text) => text.trim() && !this.found.has(text));
    if (!this.finder || fresh.length === 0) return;
    try {
      const results = await this.finder(fresh);
      fresh.forEach((text, index) => this.found.set(text, results[index] ?? []));
    } catch (error) {
      this.finder = undefined;
      this.onFailure(error);
    }
  }

  private learn(texts: readonly string[], lookup: NameLookup): void {
    for (const text of texts) for (const candidate of lookup(text)) this.remember(candidate.text, candidate.category);
  }

  private remember(value: string, category: PiiCategory): void {
    const key = normalise(value);
    if (key.length < MIN_KNOWN_LENGTH || this.known.has(key)) return;
    this.known.set(key, category);
    this.knownPattern = null;
  }

  /** Where a known private value appears in a text, whatever its case or spacing. */
  private knownIn(text: string): PiiCandidate[] {
    if (this.known.size === 0) return [];
    this.knownPattern ??= new RegExp(
      String.raw`(?<![\p{L}\p{N}])(?:${[...this.known.keys()]
        .sort((left, right) => right.length - left.length)
        .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, String.raw`\s+`))
        .join("|")})(?![\p{L}\p{N}])`,
      "giu",
    );
    const candidates: PiiCandidate[] = [];
    for (const match of text.matchAll(this.knownPattern)) {
      const category = this.known.get(normalise(match[0]));
      if (!category) continue;
      const start = match.index ?? 0;
      candidates.push({ category, source: "ner", confidence: 0.9, text: match[0], start, end: start + match[0].length });
    }
    return candidates;
  }
}
