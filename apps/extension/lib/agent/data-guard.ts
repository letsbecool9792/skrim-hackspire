import type { PiiCategory, PiiToken } from "@skrim/schema";

/**
 * Decides whether a step may type one of the user's personal values, before
 * the vault is asked for it.
 *
 * The planner never holds a real value, but it can point at one: "type
 * <PII:PHONE:1> into Comments". A planner tricked by text planted on a page,
 * or simply wrong, could put the user's data where they never meant it to go.
 * Typing is the only way a value leaves the vault onto a page (navigate and
 * select never resolve placeholders, and the server never gets a value), so
 * this one check covers every route. It runs on the device, whatever the model
 * or its prompt say.
 *
 * A value may be typed without asking when all three hold:
 *   - purpose: the goal asks for this kind of data ("my name and email"), or
 *     the value is in the goal itself;
 *   - place: the site is one the value was seen on, or, for a value from the
 *     goal, the site the task started on;
 *   - kind: it is not an ID, card or account number. Those are always checked
 *     with the user, even when the goal asks for them.
 * Otherwise the user is asked, once per value and site; with no one to ask
 * (the test harness), the step is refused.
 *
 * Words, not sites, like the commit guard: English only.
 */

export type Concern = "not-asked" | "other-site" | "sensitive";

/** Goal words that ask for each kind of data. FACE has no text; OTHER is never asked for by kind. */
const ASKS_FOR: Partial<Record<PiiCategory, RegExp>> = {
  NAME: /\bnames?\b/i,
  EMAIL: /\be-?mails?\b/i,
  PHONE: /\b(?:phone|mobile|cell|whatsapp|telephone|contact number|my number)\b/i,
  // "email address" asks for an email, not an address.
  ADDRESS: /(?<!e-?mail\s)\baddress(?:es)?\b|\b(?:street|city|town|pin ?code|post ?code|postal code|zip)\b/i,
  CARD: /\b(?:card|credit|debit)\b/i,
  GOV_ID: /\b(?:pan|aadhaa?r|passport|ssn|social security|national id|voter id|driving licen[cs]e|licen[cs]e number|id number|identity)\b/i,
  ACCOUNT: /\b(?:account (?:number|no)|bank account|a\/c|ifsc|iban|customer (?:id|number))\b/i,
  DOB: /\b(?:birth|birthday|dob|born)\b/i,
};

/** Checked with the user every time, asked for or not: what fraud is made of. */
const SENSITIVE = new Set<PiiCategory>(["GOV_ID", "CARD", "ACCOUNT"]);

export function categoryOf(token: PiiToken): PiiCategory {
  return token.slice(5, token.lastIndexOf(":")) as PiiCategory;
}

export function goalAsksFor(goal: string, category: PiiCategory): boolean {
  return ASKS_FOR[category]?.test(goal) ?? false;
}

/** One task's record of where each value came from, and what the user decided. */
export class DataGuard {
  private readonly fromGoal = new Set<PiiToken>();
  private readonly seenOn = new Map<PiiToken, Set<string>>();
  private readonly decisions = new Map<string, boolean>();
  private startSite: string | undefined;

  /** `goal` is the user's own words, before redaction. */
  constructor(private readonly goal: string) {}

  sawGoal(tokens: readonly PiiToken[]): void {
    for (const token of tokens) this.fromGoal.add(token);
  }

  /** Every view: the tokens on this page, and the site it is on. The first view's site is where the task started. */
  sawPage(site: string, tokens: readonly PiiToken[]): void {
    this.startSite ??= site;
    for (const token of tokens) {
      const sites = this.seenOn.get(token) ?? new Set<string>();
      sites.add(site);
      this.seenOn.set(token, sites);
    }
  }

  /**
   * For typing `tokens` on `site`: those the user must be asked about, with
   * why, and those the user already refused here.
   */
  check(tokens: readonly PiiToken[], site: string): { ask: Array<{ token: PiiToken; concern: Concern }>; refused: PiiToken[] } {
    const ask: Array<{ token: PiiToken; concern: Concern }> = [];
    const refused: PiiToken[] = [];
    for (const token of new Set(tokens)) {
      const decided = this.decisions.get(decisionKey(token, site));
      if (decided === false) refused.push(token);
      if (decided !== undefined) continue;
      const concern = this.concern(token, site);
      if (concern) ask.push({ token, concern });
    }
    return { ask, refused };
  }

  /** The user's answer, kept for the rest of the task so they are asked once. */
  decide(tokens: readonly PiiToken[], site: string, allowed: boolean): void {
    for (const token of tokens) this.decisions.set(decisionKey(token, site), allowed);
  }

  private concern(token: PiiToken, site: string): Concern | undefined {
    const category = categoryOf(token);
    const inGoal = this.fromGoal.has(token);
    if (!inGoal && !goalAsksFor(this.goal, category)) return "not-asked";
    const placed = this.seenOn.get(token)?.has(site) || (inGoal && site === this.startSite);
    if (!placed) return "other-site";
    if (SENSITIVE.has(category)) return "sensitive";
    return undefined;
  }
}

function decisionKey(token: PiiToken, site: string): string {
  return `${token}\u0000${site}`;
}
