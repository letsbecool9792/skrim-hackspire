/**
 * Shows what WS3's redaction does to a piece of text.
 *
 *   pnpm demo:pii                          # built-in sample
 *   pnpm demo:pii "Mail me at a@b.com"     # your own text
 *
 * Uses the real detectors and vault from lib/pii and lib/vault, i.e. the regex
 * layer. Names and addresses need the GLiNER model, which is not wired in yet,
 * so the sample deliberately shows a name staying visible.
 */
import { redactDomData } from "../lib/pii/redact.js";
import { TokenVault } from "../lib/vault/vault.js";

const SAMPLE =
  "Hi, I'm Suparno. Email suparno@example.com, call +91 98765 43210, " +
  "card 4539 5787 6362 1486, PAN ABCDE1234F, UPI suparno@okaxis, " +
  "Aadhaar 1234 5678 9012, account number 123456789012. " +
  "Order #4567890 ships Friday.";

const input = process.argv.slice(2).join(" ").trim() || SAMPLE;
const vault = new TokenVault();
const { label: redacted, detections } = redactDomData({ label: input }, vault);

console.log("\nWhat the server would see:\n");
console.log(`  ${redacted}\n`);

if (detections.length === 0) {
  console.log("No PII detected.\n");
} else {
  console.log("Detected:\n");
  for (const d of detections) {
    console.log(`  ${d.token.padEnd(18)} ${d.category.padEnd(8)} via ${d.source.padEnd(8)} confidence ${d.confidence}`);
  }
  // Referential, not destructive: every token must resolve back to exactly the
  // text it replaced. Checked here without printing the original values.
  const lossless = detections.every((d) => vault.resolve(d.token) === d.text);
  console.log(`\n  Every token resolves back to its original value: ${lossless ? "yes" : "NO - bug"}`);
  console.log(`  Vault holds: ${JSON.stringify(vault.stats())}\n`);
}

if (input === SAMPLE) {
  console.log('Note: "Suparno" is not caught. Names need the GLiNER model, which is not wired in yet.');
  console.log('      "Order #4567890" is left alone on purpose: numbers without context are not PII.\n');
}
