// The Crypt: pure, deterministic-given-an-RNG story ingredients (easy to test).

export type Rng = () => number;

export const LOCATIONS = [
  "an abandoned lighthouse on Raven's Reach",
  "the flooded cellar of Blackwood Manor",
  "a fog-choked cemetery behind the old cannery",
  "a roadside motel where every clock shows 3:07",
  "the forgotten fourth floor of Hollow Creek Hospital",
  "a cornfield that hums after midnight",
];

export const MONSTERS = [
  "a lantern-bearing drowned sailor",
  "a scarecrow that remembers your name",
  "a hollow-eyed choir that only sings in whispers",
  "a pale child who is always just behind you",
  "something wearing the shape of your neighbour",
];

export const CURSES = [
  "May every mirror you pass hold one reflection too many.",
  "May your candle burn blue and your shadow arrive late.",
  "May the third stair creak even when no one is climbing.",
  "May the dead remember your birthday.",
  "May you hear your name from the empty room, forever just once.",
];

export type Fright = 1 | 2 | 3 | 4 | 5;

const FRIGHT_STYLE: Record<Fright, string> = {
  1: "a cozy, giggle-in-the-dark campfire tale",
  2: "a spooky-but-safe bedtime shiver",
  3: "a proper ghost story with a creeping dread",
  4: "a nerve-shredding tale with an unsettling twist",
  5: "pure nightmare fuel — read with every light on",
};

export function pick<T>(items: readonly T[], rng: Rng = Math.random): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function randomCurse(rng: Rng = Math.random): string {
  return pick(CURSES, rng);
}

export function hauntedLocation(rng: Rng = Math.random): string {
  return pick(LOCATIONS, rng);
}

export function storySeed(fright: Fright, rng: Rng = Math.random) {
  return {
    fright,
    style: FRIGHT_STYLE[fright],
    location: pick(LOCATIONS, rng),
    monster: pick(MONSTERS, rng),
    curse: pick(CURSES, rng),
  };
}

export function clampFright(n: number): Fright {
  return Math.min(5, Math.max(1, Math.round(n))) as Fright;
}
