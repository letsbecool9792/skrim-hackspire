import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TokenVault } from "../vault/vault.js";
import {
  detectCards,
  detectAadhaarNumbers,
  detectAccountNumbers,
  detectEmails,
  detectIfscCodes,
  detectPanNumbers,
  detectPhones,
  detectPasswordValue,
  redactDomData,
  redactMatches,
  tokeniseGlinerEntities,
  detectUpiIds,
} from "./detector.js";

describe("email detection", () => {
  test("detects an email and creates a vault token", () => {
    const vault = new TokenVault();

    const matches = detectEmails("Contact user@example.com for help.", vault);

    assert.deepEqual(matches, [
      {
        token: "<PII:EMAIL:1>",
        category: "EMAIL",
        source: "regex",
        confidence: 1,
        text: "user@example.com",
        start: 8,
        end: 24,
      },
    ]);
    const [match] = matches;
    assert.ok(match);
    assert.equal(vault.resolve(match.token), "user@example.com");
  });

  test("reuses the same token when an email appears twice", () => {
    const vault = new TokenVault();

    const matches = detectEmails("user@example.com and user@example.com", vault);

    assert.equal(matches.length, 2);
    const [firstMatch, secondMatch] = matches;
    assert.ok(firstMatch);
    assert.ok(secondMatch);
    assert.equal(firstMatch.token, secondMatch.token);
    assert.deepEqual(vault.stats(), { EMAIL: 1 });
  });

  test("detects multiple distinct emails", () => {
    const vault = new TokenVault();

    const matches = detectEmails("user@example.com, admin@example.org", vault);

    assert.deepEqual(
      matches.map(({ token, text }) => ({ token, text })),
      [
        { token: "<PII:EMAIL:1>", text: "user@example.com" },
        { token: "<PII:EMAIL:2>", text: "admin@example.org" },
      ]
    );
  });

  test("ignores text without a valid email", () => {
    const vault = new TokenVault();

    assert.deepEqual(detectEmails("user@localhost and @example.com", vault), []);
    assert.deepEqual(vault.stats(), {});
  });
});

describe("phone detection", () => {
  test("detects an international phone number and creates a vault token", () => {
    const vault = new TokenVault();

    const matches = detectPhones("Call +91 98765 43210 for help.", vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.token, "<PII:PHONE:1>");
    assert.equal(matches[0]?.text, "+91 98765 43210");
    assert.equal(vault.resolve(matches[0]?.token ?? "<PII:PHONE:99>"), "+91 98765 43210");
  });

  test("detects a phone number with doubled separators", () => {
    const vault = new TokenVault();

    const matches = detectPhones("Call +91  98765  43210 today", vault);

    assert.equal(matches[0]?.text, "+91  98765  43210");
  });

  test("reuses a token for a repeated phone number", () => {
    const vault = new TokenVault();

    const matches = detectPhones("+1 202-555-0100 and +1 202-555-0100", vault);

    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.token, matches[1]?.token);
    assert.deepEqual(vault.stats(), { PHONE: 1 });
  });

  test("ignores bare numbers that could be order IDs", () => {
    const vault = new TokenVault();

    assert.deepEqual(detectPhones("Order 9876543210 and tracking 123456789012", vault), []);
    assert.deepEqual(vault.stats(), {});
  });
});

describe("card detection", () => {
  test("detects a Luhn-valid card number", () => {
    const vault = new TokenVault();

    const matches = detectCards("Pay with 4539 5787 6362 1486.", vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.token, "<PII:CARD:1>");
    assert.equal(matches[0]?.text, "4539 5787 6362 1486");
    assert.equal(vault.resolve(matches[0]?.token ?? "<PII:CARD:99>"), "4539 5787 6362 1486");
  });

  test("reuses a token for a repeated card number", () => {
    const vault = new TokenVault();

    const matches = detectCards("4539578763621486 and 4539578763621486", vault);

    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.token, matches[1]?.token);
    assert.deepEqual(vault.stats(), { CARD: 1 });
  });

  test("ignores invalid or arbitrary long numbers", () => {
    const vault = new TokenVault();

    assert.deepEqual(detectCards("1234567890123456 and 4539 5787 6362 1487", vault), []);
    assert.deepEqual(vault.stats(), {});
  });
});

describe("PAN detection", () => {
  test("detects a PAN and stores it as a government ID", () => {
    const vault = new TokenVault();

    const matches = detectPanNumbers("PAN: ABCDE1234F", vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.token, "<PII:GOV_ID:1>");
    assert.equal(matches[0]?.text, "ABCDE1234F");
    assert.equal(vault.resolve(matches[0]?.token ?? "<PII:GOV_ID:99>"), "ABCDE1234F");
  });

  test("normalises lowercase PAN text through case-insensitive detection", () => {
    const vault = new TokenVault();

    const matches = detectPanNumbers("abcde1234f", vault);

    assert.equal(matches[0]?.text, "abcde1234f");
    assert.deepEqual(vault.stats(), { GOV_ID: 1 });
  });

  test("reuses a token for a repeated PAN", () => {
    const vault = new TokenVault();

    const matches = detectPanNumbers("ABCDE1234F and ABCDE1234F", vault);

    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.token, matches[1]?.token);
    assert.deepEqual(vault.stats(), { GOV_ID: 1 });
  });

  test("ignores invalid PAN-shaped text", () => {
    const vault = new TokenVault();

    assert.deepEqual(detectPanNumbers("ABCD1234F, ABCDE12345, ABCDE1234", vault), []);
    assert.deepEqual(vault.stats(), {});
  });
});

describe("IFSC and UPI detection", () => {
  test("detects an IFSC code", () => {
    const vault = new TokenVault();

    const matches = detectIfscCodes("Bank IFSC: HDFC0001234", vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.token, "<PII:ACCOUNT:1>");
    assert.equal(matches[0]?.text, "HDFC0001234");
  });

  test("detects a UPI ID", () => {
    const vault = new TokenVault();

    const matches = detectUpiIds("Pay to user.name@okbank", vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.token, "<PII:ACCOUNT:1>");
    assert.equal(matches[0]?.text, "user.name@okbank");
  });

  test("reuses tokens for repeated account identifiers", () => {
    const vault = new TokenVault();

    const matches = detectUpiIds("user@okbank and user@okbank", vault);

    assert.equal(matches.length, 2);
    assert.equal(matches[0]?.token, matches[1]?.token);
    assert.deepEqual(vault.stats(), { ACCOUNT: 1 });
  });

  test("ignores malformed IFSC and UPI text", () => {
    const vault = new TokenVault();

    assert.deepEqual(detectIfscCodes("HDFC1234567", vault), []);
    assert.deepEqual(detectUpiIds("@okbank and user@", vault), []);
    assert.deepEqual(vault.stats(), {});
  });

  test("does not read an email address as a UPI ID", () => {
    const vault = new TokenVault();

    assert.deepEqual(detectUpiIds("Mail user@example.com or user@mail.example.co.in", vault), []);
    assert.equal(detectUpiIds("Pay user@okaxis.", vault)[0]?.text, "user@okaxis");
  });
});

describe("contextual numeric detection", () => {
  test("detects Aadhaar only near an Aadhaar label", () => {
    const vault = new TokenVault();

    const matches = detectAadhaarNumbers("Aadhaar number: 1234 5678 9012", vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.token, "<PII:GOV_ID:1>");
    assert.equal(matches[0]?.text, "1234 5678 9012");
  });

  test("detects an account number only near an account label", () => {
    const vault = new TokenVault();

    const matches = detectAccountNumbers("Bank account no: 123456789012", vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.token, "<PII:ACCOUNT:1>");
    assert.equal(matches[0]?.text, "123456789012");
  });

  test("does not classify unlabeled numbers as Aadhaar or accounts", () => {
    const vault = new TokenVault();
    const text = "Order 123456789012 and tracking 9876543210";

    assert.deepEqual(detectAadhaarNumbers(text, vault), []);
    assert.deepEqual(detectAccountNumbers(text, vault), []);
    assert.deepEqual(vault.stats(), {});
  });

  test("a label only describes the number right after it", () => {
    const vault = new TokenVault();

    const redacted = redactDomData(
      { label: "Aadhaar 1234 5678 9012, account number 123456789012" },
      vault
    );

    assert.equal(redacted.label, "Aadhaar <PII:GOV_ID:1>, account number <PII:ACCOUNT:1>");
  });

  test("supports compact Aadhaar values and repeated accounts", () => {
    const vault = new TokenVault();

    const aadhaar = detectAadhaarNumbers("UIDAI: 123456789012", vault);
    const accounts = detectAccountNumbers("Account: 12345678 and account: 12345678", vault);

    assert.equal(aadhaar[0]?.text, "123456789012");
    assert.equal(accounts[0]?.token, accounts[1]?.token);
    assert.deepEqual(vault.stats(), { GOV_ID: 1, ACCOUNT: 1 });
  });
});

describe("password detection and redaction", () => {
  test("tokenises a password field value as DOM-sourced PII", () => {
    const vault = new TokenVault();

    const match = detectPasswordValue("correct horse battery staple", vault);

    assert.equal(match?.token, "<PII:OTHER:1>");
    assert.equal(match?.source, "dom-type");
    assert.equal(vault.resolve(match?.token ?? "<PII:OTHER:99>"), "correct horse battery staple");
  });

  test("does not create a token for an empty password field", () => {
    const vault = new TokenVault();

    assert.equal(detectPasswordValue("", vault), null);
    assert.deepEqual(vault.stats(), {});
  });

  test("replaces only detected values and preserves surrounding context", () => {
    const vault = new TokenVault();
    const text = "Email: user@example.com; PAN: ABCDE1234F";
    const matches = [
      ...detectEmails(text, vault),
      ...detectPanNumbers(text, vault),
    ];

    assert.equal(
      redactMatches(text, matches),
      "Email: <PII:EMAIL:1>; PAN: <PII:GOV_ID:1>"
    );
  });

  test("redacts matches from right to left without shifting earlier spans", () => {
    const vault = new TokenVault();
    const text = "user@example.com called +91 98765 43210";
    const matches = [
      ...detectEmails(text, vault),
      ...detectPhones(text, vault),
    ];

    assert.equal(
      redactMatches(text, matches),
      "<PII:EMAIL:1> called <PII:PHONE:1>"
    );
  });

  test("redacts DOM labels and values while preserving the field context", () => {
    const vault = new TokenVault();

    const redacted = redactDomData(
      { label: "Email", value: "user@example.com", inputType: "email" },
      vault
    );

    assert.equal(redacted.label, "Email");
    assert.equal(redacted.value, "<PII:EMAIL:1>");
    assert.equal(redacted.detections.length, 1);
  });

  test("treats password input values as PII even without a regex match", () => {
    const vault = new TokenVault();

    const redacted = redactDomData(
      { label: "Password", value: "not-a-pattern", inputType: "password" },
      vault
    );

    assert.equal(redacted.label, "Password");
    assert.equal(redacted.value, "<PII:OTHER:1>");
    assert.equal(redacted.detections[0]?.source, "dom-type");
  });

  test("does not duplicate overlapping email and UPI matches", () => {
    const vault = new TokenVault();

    const redacted = redactDomData({ value: "Contact user@example.com" }, vault);

    assert.equal(redacted.value, "Contact <PII:EMAIL:1>");
    assert.equal(redacted.detections.length, 1);
  });

  test("gives tokens only to matches that survive overlap resolution", () => {
    const vault = new TokenVault();

    // A card number after "account number" matches both detectors; the card wins.
    const redacted = redactDomData({ label: "account number 4539578763621486" }, vault);

    assert.equal(redacted.label, "account number <PII:CARD:1>");
    assert.deepEqual(vault.stats(), { CARD: 1 });
  });

  test("uses a field's label as context for its value", () => {
    const vault = new TokenVault();

    const redacted = redactDomData({ label: "Aadhaar number", value: "123456789012" }, vault);

    assert.equal(redacted.label, "Aadhaar number");
    assert.equal(redacted.value, "<PII:GOV_ID:1>");
  });

  test("trusts the field type when no pattern matches", () => {
    const vault = new TokenVault();

    const name = redactDomData({ label: "Full name", value: "Suparno Saha", autocomplete: "name" }, vault);
    const phone = redactDomData({ label: "Mobile", value: "98765 43210", inputType: "tel" }, vault);

    assert.equal(name.value, "<PII:NAME:1>");
    assert.equal(name.detections[0]?.source, "dom-type");
    assert.equal(phone.value, "<PII:PHONE:1>");
  });

  test("leaves ordinary field values alone", () => {
    const vault = new TokenVault();

    const redacted = redactDomData({ label: "Search", value: "red running shoes", inputType: "search" }, vault);

    assert.equal(redacted.value, "red running shoes");
    assert.deepEqual(vault.stats(), {});
  });
});

describe("GLiNER entity tokenisation", () => {
  test("maps names and addresses to vault tokens", () => {
    const vault = new TokenVault();
    const entities = [
      { text: "Rahul Sharma", label: "person", start: 15, end: 27, score: 0.94 },
      { text: "12 MG Road", label: "address", start: 31, end: 41, score: 0.88 },
    ];

    const matches = tokeniseGlinerEntities(entities, vault);

    assert.deepEqual(
      matches.map(({ token, category, confidence }) => ({ token, category, confidence })),
      [
        { token: "<PII:NAME:1>", category: "NAME", confidence: 0.94 },
        { token: "<PII:ADDRESS:1>", category: "ADDRESS", confidence: 0.88 },
      ]
    );
  });

  test("drops unknown labels and low-confidence entities", () => {
    const vault = new TokenVault();
    const entities = [
      { text: "Rahul", label: "person", start: 0, end: 5, score: 0.49 },
      { text: "Tuesday", label: "date", start: 6, end: 13, score: 0.99 },
    ];

    assert.deepEqual(tokeniseGlinerEntities(entities, vault), []);
    assert.deepEqual(vault.stats(), {});
  });

  test("keeps the highest-confidence result when entities overlap", () => {
    const vault = new TokenVault();
    const entities = [
      { text: "Rahul Sharma", label: "person", start: 0, end: 12, score: 0.91 },
      { text: "Sharma", label: "person", start: 6, end: 12, score: 0.87 },
    ];

    const matches = tokeniseGlinerEntities(entities, vault);

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.text, "Rahul Sharma");
    assert.deepEqual(vault.stats(), { NAME: 1 });
  });

  test("reuses tokens for repeated entities", () => {
    const vault = new TokenVault();
    const entities = [
      { text: "Rahul", label: "person", start: 0, end: 5, score: 0.9 },
      { text: "Rahul", label: "person", start: 10, end: 15, score: 0.9 },
    ];

    const matches = tokeniseGlinerEntities(entities, vault);

    assert.equal(matches[0]?.token, matches[1]?.token);
    assert.deepEqual(vault.stats(), { NAME: 1 });
  });
});