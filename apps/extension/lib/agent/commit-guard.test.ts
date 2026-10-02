import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { unaskedCommitment } from "./commit-guard.ts";

describe("unaskedCommitment", () => {
  test("refuses an order, an account or a deletion the goal did not ask for", () => {
    assert.equal(unaskedCommitment("Place order", "Change the coupon code to SAVE20"), "place an order or pay");
    assert.equal(unaskedCommitment("Create account", "Fill in the sign-up form with my name"), "create an account");
    assert.equal(unaskedCommitment("Delete address", "Change the city in my profile"), "delete or remove something");
    assert.equal(unaskedCommitment("Transfer ₹5,000", "Show my balance"), "subscribe, cancel or transfer money");
  });

  test("allows them when the goal asks", () => {
    assert.equal(unaskedCommitment("Place order", "Buy the headphones"), undefined);
    assert.equal(unaskedCommitment("Pay now", "Order the headphones and pay by card"), undefined);
    assert.equal(unaskedCommitment("Create account", "Sign me up with my email"), undefined);
    assert.equal(unaskedCommitment("Sign up", "sign up for the newsletter"), undefined);
    assert.equal(unaskedCommitment("Delete", "delete the draft"), undefined);
  });

  test("leaves ordinary buttons alone", () => {
    for (const button of ["Send message", "Save changes", "Apply coupon", "Add to cart", "Remove filter", "Search", "Cancel"]) {
      assert.equal(unaskedCommitment(button, "Change the coupon code to SAVE20"), undefined, button);
    }
  });
});
