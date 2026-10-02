/**
 * Shows what WS3's redaction does to a piece of text.
 *
 *   pnpm demo:pii                          # built-in sample
 *   pnpm demo:pii "Mail me at a@b.com"     # your own text
 *
 * Uses the real detectors and vault from lib/pii and lib/vault: the regex
 * layer, plus the GLiNER model for names and addresses when it has been
 * fetched (pnpm models:fetch).
 */
import { redactDomData } from "../lib/pii/redact.js";
import { loadNameFinderNode } from "../lib/pii/ner-node.ts";
import { TokenVault } from "../lib/vault/vault.js";

const SAMPLE =
  "Welcome back, Asha Rao. Deliveries go to 12 MG Road, Bengaluru 560001. " +
  "Email asha.rao@example.com, call +91 98765 43210, " +
  "card 4539 5787 6362 1486, PAN ABCDE1234F, UPI asha@okaxis, " +
  "Aadhaar 1234 5678 9012, account number 123456789012. " +
  "Order #4567890 ships Friday.";

const input = process.argv.slice(2).join(" ").trim() || SAMPLE;
const vault = new TokenVault();
const findNames = await loadNameFinderNode();
const [found = []] = findNames ? await findNames([input]) : [[]];
const { label: redacted, detections } = redactDomData({ label: input }, vault, (text) => (text === input ? found : []));

console.log(`\nName and address detection: ${findNames ? "on (GLiNER)" : "OFF - run pnpm models:fetch"}`);
console.log("\nWhat the server would see:\n");
console.log(`  ${redacted}\n`);

if (detections.length === 0) {
  console.log("No PII detected.\n");
} else {
  console.log("Detected:\n");
  for (const d of detections) {
    console.log(`  ${d.token.padEnd(18)} ${d.category.padEnd(8)} via ${d.source.padEnd(8)} confidence ${d.confidence.toFixed(2)}`);
  }
  // Referential, not destructive: every token must resolve back to exactly the
  // text it replaced. Checked here without printing the original values.
  const lossless = detections.every((d) => vault.resolve(d.token) === d.text);
  console.log(`\n  Every token resolves back to its original value: ${lossless ? "yes" : "NO - bug"}`);
  console.log(`  Vault holds: ${JSON.stringify(vault.stats())}\n`);
}

if (input === SAMPLE) {
  console.log('Note: "Order #4567890" and "Friday" are left alone on purpose: over-redaction is scored too.\n');
}
