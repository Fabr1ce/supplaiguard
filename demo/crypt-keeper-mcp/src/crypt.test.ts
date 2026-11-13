import { test } from "node:test";
import assert from "node:assert/strict";
import { CURSES, LOCATIONS, clampFright, hauntedLocation, randomCurse, storySeed } from "./crypt.js";

test("clampFright keeps values in 1..5", () => {
  assert.equal(clampFright(-3), 1);
  assert.equal(clampFright(99), 5);
  assert.equal(clampFright(3.4), 3);
});

test("rng 0 picks first element, rng ~1 picks last", () => {
  assert.equal(randomCurse(() => 0), CURSES[0]);
  assert.equal(hauntedLocation(() => 0.999), LOCATIONS[LOCATIONS.length - 1]);
});

test("storySeed is complete and reflects fright", () => {
  const s = storySeed(5, () => 0);
  assert.equal(s.fright, 5);
  assert.match(s.style, /nightmare/);
  assert.ok(s.location && s.monster && s.curse);
});
