/**
 * Refuses clicks that commit the user to something the goal did not ask for:
 * placing an order, paying, deleting, creating an account.
 *
 * The provider study (docs/provider-study.md) asked Qwen3-VL 4B,
 * the offline planner, to change a coupon code: it placed the order, 3 runs
 * of 3. Asked to fill in a sign-up form, it created the account. A rule in
 * the prompt did not stop it. A planner may misread a goal; it must not be
 * able to spend the user's money because of it. So the loop checks the
 * button's words against the goal's, whatever the model.
 *
 * Words, not sites: no selectors (brief §4.6). English only, like the other cue
 * lists. A goal that means it says so ("buy", "place the order", "delete"),
 * and a refused click costs one step: the planner is told why.
 */

interface Commitment {
  /** What the button would do, for the planner's note. */
  does: string;
  /** Button words that commit to it. */
  button: RegExp;
  /** Goal words that ask for it. */
  goal: RegExp;
}

const COMMITMENTS: Commitment[] = [
  {
    does: "place an order or pay",
    button: /\b(place (?:your |the )?order|order now|buy now|buy|purchase|pay(?: now)?|checkout|check out|proceed to (?:pay|payment|checkout)|confirm (?:order|payment|purchase))\b/i,
    goal: /\b(order|buy|purchase|pay|payment|checkout|check out)\b/i,
  },
  {
    does: "delete or remove something",
    // "Remove filter" is harmless; removing a card or an address is not.
    button: /\b(delete|erase|discard)\b|\bremove (?:account|card|address|payment|item|from)\b/i,
    goal: /\b(delete|remove|erase|discard|clear)\b/i,
  },
  {
    does: "create an account",
    button: /\b(create (?:an |my |your )?account|sign[- ]?up|register|join now)\b/i,
    // "Fill in the sign-up form" names the form; it does not ask to sign up.
    goal: /\b(create (?:an |my |a new )?account|sign[- ]?up(?![- ]?(?:form|page))|sign me up|register)\b/i,
  },
  {
    does: "subscribe, cancel or transfer money",
    button: /\b(subscribe|unsubscribe|cancel (?:order|subscription|booking|plan)|transfer|send money)\b/i,
    goal: /\b(subscribe|unsubscribe|cancel|transfer|send money)\b/i,
  },
  // TASK_04: additional high-risk categories not covered by the original four.
  {
    does: "change a password or credentials",
    button: /\b(change password|update password|reset password|save (?:new )?password|confirm (?:new )?password|set password)\b/i,
    goal: /\b(change|update|reset|set)\b.{0,20}\bpassword\b/i,
  },
  {
    does: "share, forward or send data to others",
    button: /\b(share (?:with|to|publicly)|forward(?: to)?|send to (?:others|contacts|email)|publish(?: publicly)?|make public|export (?:and )?share)\b/i,
    goal: /\b(share|forward|publish|send to|make public)\b/i,
  },
  {
    does: "upload or submit a file or attachment",
    button: /\b(upload (?:and )?submit|send (?:file|attachment|document)|submit (?:form|application|document)|attach (?:and )?send)\b/i,
    goal: /\b(upload|attach|send (?:file|document)|submit (?:form|application))\b/i,
  },
];

/**
 * What a click on this element would commit to, when the goal does not ask
 * for it; undefined when the click is fine. Both texts are the user's own:
 * the goal as typed, the element's name and visible text.
 */
export function unaskedCommitment(elementText: string, goal: string): string | undefined {
  for (const commitment of COMMITMENTS) {
    if (commitment.button.test(elementText) && !commitment.goal.test(goal)) return commitment.does;
  }
  return undefined;
}
