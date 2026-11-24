// auction: a live salvage car auction. pure game logic — the room's durable object stores the state,
// calls act() for player actions and tick() on its alarm, and sends each seat view(state, seat).
//
// every car is generated from the room's seed: a vehicle, a damage type, a title, and a condition
// report. some report lines are visible, some are ??? until someone pays to inspect. the full
// repair bill (parts + labor), days to fix and resale only show after the hammer falls.
//
// numbers: built to be believable for the us market, not quotes. anything marked TUNE is a
// conservative guess — eddy works around this stuff and will correct it.
import { rng, type Rng } from "@edwrdq/daily";

export const BANKROLL = 25_000;
export const LOTS = 6;
export const INCREMENTS = [100, 250, 500] as const;
// phase lengths (ms). 6 lots × ~55s + anti-snipe extensions ≈ 6–8 minutes.
export const T = { intro: 5_000, preview: 20_000, bidding: 20_000, snipe: 5_000, sold: 15_000 } as const;
/** humans + bots. solo games get bots up to this many seats. TUNE */
export const FILL_TO = 5;

// ------------------------------------------------------------------ money

/** buyer fees on top of the hammer price. loosely shaped like real salvage auction schedules
 *  (a tiered buyer fee + an online bidding fee + gate + environmental), rounded. TUNE */
export function fees(price: number) {
  const tiers: [number, number][] = [
    [500, 175], [1000, 300], [2000, 425], [4000, 550], [6000, 650], [8000, 725], [10000, 800], [15000, 900],
  ];
  const buyer = tiers.find(([max]) => price < max)?.[1] ?? Math.round(price * 0.06);
  const online = price < 1000 ? 50 : price < 6000 ? 100 : 160;
  return { buyer, online, gate: 95, env: 15, total: buyer + online + 95 + 15 };
}

// shop rates a flipper would actually pay (independent shops, not dealer). TUNE
const BODY_RATE = 65;
const MECH_RATE = 95;

// ------------------------------------------------------------------ vehicles

type Cls = "econ" | "mid" | "suv" | "truck" | "sport" | "lux" | "ev";
export type Body = "sedan" | "suv" | "truck" | "coupe";
// parts cost multiplier by class (econ = 1). TUNE
const PARTS_X: Record<Cls, number> = { econ: 1, mid: 1.15, suv: 1.25, truck: 1.35, sport: 1.3, lux: 1.9, ev: 2.1 };
// value kept per year after the first. TUNE
const RETAIN: Record<Cls, number> = { econ: 0.91, mid: 0.9, suv: 0.91, truck: 0.92, sport: 0.9, lux: 0.86, ev: 0.84 };

type Vehicle = { make: string; model: string; trims: string[]; cls: Cls; body: Body; msrp: number; from: number; to: number; retain?: number };
// msrp ≈ a mid trim, today's dollars, rounded. conservative. TUNE
const VEHICLES: Vehicle[] = [
  { make: "honda", model: "civic", trims: ["lx", "sport", "ex"], cls: "econ", body: "sedan", msrp: 25000, from: 2012, to: 2024, retain: 0.93 },
  { make: "toyota", model: "corolla", trims: ["l", "le", "se"], cls: "econ", body: "sedan", msrp: 23000, from: 2012, to: 2024, retain: 0.93 },
  { make: "hyundai", model: "elantra", trims: ["se", "sel"], cls: "econ", body: "sedan", msrp: 22000, from: 2013, to: 2024 },
  { make: "nissan", model: "altima", trims: ["s", "sv", "sr"], cls: "mid", body: "sedan", msrp: 28000, from: 2013, to: 2024 },
  { make: "toyota", model: "camry", trims: ["le", "se", "xle"], cls: "mid", body: "sedan", msrp: 29000, from: 2012, to: 2024, retain: 0.93 },
  { make: "honda", model: "accord", trims: ["lx", "sport", "ex-l"], cls: "mid", body: "sedan", msrp: 30000, from: 2013, to: 2024, retain: 0.92 },
  { make: "chevrolet", model: "malibu", trims: ["ls", "lt"], cls: "mid", body: "sedan", msrp: 26000, from: 2013, to: 2024 },
  { make: "kia", model: "optima", trims: ["lx", "ex"], cls: "mid", body: "sedan", msrp: 25000, from: 2012, to: 2020 },
  { make: "kia", model: "k5", trims: ["lxs", "gt-line"], cls: "mid", body: "sedan", msrp: 28000, from: 2021, to: 2024 },
  { make: "honda", model: "cr-v", trims: ["lx", "ex", "ex-l"], cls: "suv", body: "suv", msrp: 32000, from: 2012, to: 2024, retain: 0.92 },
  { make: "toyota", model: "rav4", trims: ["le", "xle", "adventure"], cls: "suv", body: "suv", msrp: 33000, from: 2013, to: 2024, retain: 0.93 },
  { make: "nissan", model: "rogue", trims: ["s", "sv", "sl"], cls: "suv", body: "suv", msrp: 30000, from: 2014, to: 2024, retain: 0.89 },
  { make: "ford", model: "escape", trims: ["se", "sel", "titanium"], cls: "suv", body: "suv", msrp: 30000, from: 2013, to: 2024, retain: 0.88 },
  { make: "subaru", model: "outback", trims: ["premium", "limited"], cls: "suv", body: "suv", msrp: 33000, from: 2013, to: 2024 },
  { make: "jeep", model: "wrangler", trims: ["sport", "sahara", "rubicon"], cls: "suv", body: "suv", msrp: 42000, from: 2012, to: 2024, retain: 0.94 },
  { make: "ford", model: "f-150", trims: ["xl", "xlt", "lariat"], cls: "truck", body: "truck", msrp: 50000, from: 2012, to: 2024 },
  { make: "chevrolet", model: "silverado 1500", trims: ["lt", "rst", "ltz"], cls: "truck", body: "truck", msrp: 50000, from: 2012, to: 2024 },
  { make: "ram", model: "1500", trims: ["tradesman", "big horn", "laramie"], cls: "truck", body: "truck", msrp: 49000, from: 2013, to: 2024 },
  { make: "toyota", model: "tacoma", trims: ["sr5", "trd sport", "trd off-road"], cls: "truck", body: "truck", msrp: 39000, from: 2012, to: 2023, retain: 0.95 },
  { make: "dodge", model: "charger", trims: ["sxt", "gt", "r/t"], cls: "sport", body: "sedan", msrp: 36000, from: 2012, to: 2023 },
  { make: "ford", model: "mustang", trims: ["ecoboost", "gt"], cls: "sport", body: "coupe", msrp: 38000, from: 2012, to: 2024 },
  { make: "bmw", model: "330i", trims: ["base", "xdrive"], cls: "lux", body: "sedan", msrp: 46000, from: 2016, to: 2024 },
  { make: "tesla", model: "model 3", trims: ["standard range", "long range"], cls: "ev", body: "sedan", msrp: 45000, from: 2018, to: 2024 },
];

const GAME_YEAR = 2026;
const r100 = (n: number) => Math.round(n / 100) * 100;
const r10 = (n: number) => Math.round(n / 10) * 10;

/** clean-title retail before the damage. TUNE (a depreciation curve, not a price guide) */
export function cleanRetail(v: Vehicle, year: number, miles: number) {
  const age = Math.max(1, GAME_YEAR - year);
  const base = v.msrp * 0.85 * (v.retain ?? RETAIN[v.cls]) ** (age - 1);
  const expected = age * 12_000;
  const mileAdj = Math.min(1.1, Math.max(0.7, 1 - (0.1 * (miles - expected)) / 50_000));
  return Math.max(2500, r100(base * mileAdj));
}

// ------------------------------------------------------------------ damage + condition reports

export type Damage = "front" | "rear" | "side" | "flood" | "hail" | "mechanical" | "runs";
export const DAMAGE_LABEL: Record<Damage, string> = {
  front: "front end",
  rear: "rear end",
  side: "side",
  flood: "flood",
  hail: "hail",
  mechanical: "mechanical",
  runs: "run & drive",
};
export type Title = "clean" | "salvage" | "rebuilt";
export type Line = { part: string; parts: number; labor: number };
type Ctx = { r: Rng; m: number; cls: Cls };
type Outcome = { p: number; text: string; lines?: (c: Ctx) => Line[]; days?: number; resale?: number; bad: boolean };
type Check = { key: string; label: string; cost: number; outcomes: Outcome[] };

const amt = (c: Ctx, lo: number, hi: number) => r10(c.r.int(lo, hi) * c.m);
const body = (c: Ctx, lo: number, hi: number) => Math.round(c.r.int(lo * 10, hi * 10) / 10) * BODY_RATE;
const mech = (c: Ctx, lo: number, hi: number) => Math.round(c.r.int(lo * 10, hi * 10) / 10) * MECH_RATE;
const part = (part: string, parts: number, labor = 0): Line => ({ part, parts, labor });

// visible damage: what the lot photos show. each returns report lines + their repair lines.
type Visible = { text: string; lines: (c: Ctx) => Line[] }[];
const VISIBLE: Record<Damage, (c: Ctx) => Visible> = {
  front: (c) => [
    { text: "front bumper cover: crushed", lines: (c) => [part("front bumper cover + absorber", amt(c, 220, 480), body(c, 3, 5))] },
    { text: "headlights: both broken", lines: (c) => [part("headlight assemblies (2)", amt(c, 260, 900) * (c.cls === "lux" || c.cls === "ev" ? 2 : 1), body(c, 1, 1.5))] },
    { text: "hood: buckled", lines: (c) => [part("hood", amt(c, 220, 560), body(c, 2, 3))] },
    ...(c.r.chance(0.6) ? [{ text: "radiator support: bent", lines: (c: Ctx) => [part("radiator core support", amt(c, 140, 380), body(c, 3, 5))] }] : []),
    { text: "paint: front end", lines: (c) => [part("paint, materials + refinish", amt(c, 350, 700), body(c, 6, 10))] },
  ],
  rear: () => [
    { text: "rear bumper cover: smashed", lines: (c) => [part("rear bumper cover + reinforcement", amt(c, 200, 460), body(c, 3, 5))] },
    { text: "tail lights: broken", lines: (c) => [part("tail lights (2)", amt(c, 140, 520), body(c, 0.5, 1))] },
    { text: "trunk / tailgate: dented", lines: (c) => [part("trunk lid / tailgate", amt(c, 260, 720), body(c, 2, 3.5))] },
    { text: "paint: rear", lines: (c) => [part("paint, materials + refinish", amt(c, 300, 600), body(c, 5, 8))] },
  ],
  side: (c) => {
    const doors = c.r.chance(0.5) ? 2 : 1;
    return [
      { text: doors === 2 ? "doors: two caved in" : "door: caved in", lines: (c) => [part(`door shell${doors === 2 ? "s (2)" : ""}`, amt(c, 300, 750) * doors, body(c, 4, 6) * doors)] },
      { text: "mirror: hanging off", lines: (c) => [part("side mirror", amt(c, 80, 340), body(c, 0.5, 1))] },
      { text: "paint: one side", lines: (c) => [part("paint, materials + refinish", amt(c, 350, 700), body(c, 6, 12))] },
    ];
  },
  flood: () => [
    { text: "interior: wet, musty, silt in the carpet", lines: (c) => [part("strip, clean + dry interior", 0, body(c, 10, 16)), part("carpet + pad", amt(c, 300, 800))] },
  ],
  hail: () => [
    { text: "hail dents: roof, hood, trunk", lines: (c) => [part("paintless dent repair", 0, r10(c.r.int(1500, 4000)))] },
  ],
  mechanical: (c) => [
    c.r.chance(0.5)
      ? { text: "seller notes: engine noise, won't stay running", lines: () => [] }
      : { text: "seller notes: starts, won't move", lines: () => [] },
    { text: "brakes + tires: worn", lines: (c) => [part("brakes + 4 tires", amt(c, 420, 900), mech(c, 1.5, 2.5))] },
  ],
  runs: () => [
    { text: "body: scrapes, small dents", lines: (c) => [part("detail + touch-up", amt(c, 150, 350))] },
  ],
};

// hidden checks: ??? on the lot sheet until someone pays to inspect. outcome odds are per lot.
const CHECKS: Record<Damage, Check[]> = {
  front: [
    { key: "airbags", label: "airbags", cost: 150, outcomes: [
      { p: 0.45, bad: true, text: "airbags deployed — driver + passenger", days: 2, lines: (c) => [part("airbag modules (2)", amt(c, 700, 1500)), part("seatbelt pretensioners", amt(c, 240, 560)), part("srs control module", amt(c, 200, 520), mech(c, 3, 5))] },
      { p: 0.55, bad: false, text: "airbags not deployed" },
    ] },
    { key: "cooling", label: "radiator / a/c", cost: 150, outcomes: [
      { p: 0.6, bad: true, text: "radiator + a/c condenser punctured", lines: (c) => [part("radiator", amt(c, 120, 320)), part("a/c condenser", amt(c, 130, 380)), part("fan assembly", amt(c, 90, 300), mech(c, 2.5, 4)), part("a/c evacuate + recharge", amt(c, 150, 250))] },
      { p: 0.4, bad: false, text: "cooling stack intact" },
    ] },
    { key: "frame", label: "frame rails", cost: 400, outcomes: [
      { p: 0.25, bad: true, text: "frame rail kinked — needs the frame machine", days: 4, resale: 0.93, lines: (c) => [part("frame rail section", amt(c, 300, 900), body(c, 12, 30))] },
      { p: 0.75, bad: false, text: "frame rails straight" },
    ] },
    { key: "engine", label: "engine", cost: 250, outcomes: [
      { p: 0.6, bad: false, text: "runs and drives" },
      { p: 0.25, bad: true, text: "no start — crank sensor + blown fuse", lines: (c) => [part("crank sensor + fuses", amt(c, 60, 180), mech(c, 1, 2))] },
      { p: 0.15, bad: true, text: "pushed back — mounts + oil pan cracked", days: 3, lines: (c) => [part("motor mounts + oil pan", amt(c, 400, 1100), mech(c, 6, 10))] },
    ] },
  ],
  rear: [
    { key: "frame", label: "trunk floor / rails", cost: 400, outcomes: [
      { p: 0.25, bad: true, text: "trunk floor buckled, rails pushed", days: 3, resale: 0.94, lines: (c) => [part("trunk floor + rail pull", amt(c, 300, 800), body(c, 10, 26))] },
      { p: 0.75, bad: false, text: "structure ok" },
    ] },
    { key: "quarter", label: "quarter panel", cost: 200, outcomes: [
      { p: 0.35, bad: true, text: "quarter panel needs replacing (welded)", days: 3, lines: (c) => [part("quarter panel", amt(c, 250, 600), body(c, 10, 16))] },
      { p: 0.65, bad: false, text: "quarter panel pulls out" },
    ] },
    { key: "exhaust", label: "exhaust / fuel", cost: 150, outcomes: [
      { p: 0.35, bad: true, text: "muffler + filler neck crushed", lines: (c) => [part("exhaust + filler neck", amt(c, 230, 700), mech(c, 1, 2))] },
      { p: 0.65, bad: false, text: "exhaust + fuel lines fine" },
    ] },
    { key: "camera", label: "backup camera / sensors", cost: 150, outcomes: [
      { p: 0.4, bad: true, text: "backup camera + park sensors dead", lines: (c) => [part("camera + park sensors", amt(c, 150, 450), mech(c, 1, 1.5))] },
      { p: 0.6, bad: false, text: "camera works" },
    ] },
  ],
  side: [
    { key: "curtain", label: "curtain airbags", cost: 200, outcomes: [
      { p: 0.4, bad: true, text: "curtain airbags deployed", days: 2, lines: (c) => [part("curtain airbag + headliner", amt(c, 750, 1900), mech(c, 3, 4))] },
      { p: 0.6, bad: false, text: "curtain airbags not deployed" },
    ] },
    { key: "pillar", label: "b-pillar", cost: 400, outcomes: [
      { p: 0.2, bad: true, text: "b-pillar pushed in — structural", days: 5, resale: 0.9, lines: (c) => [part("b-pillar section", amt(c, 300, 800), body(c, 16, 40))] },
      { p: 0.8, bad: false, text: "pillars straight" },
    ] },
    { key: "glass", label: "window / regulator", cost: 150, outcomes: [
      { p: 0.5, bad: true, text: "window shattered, regulator bent", lines: (c) => [part("door glass + regulator", amt(c, 120, 380), body(c, 1, 2))] },
      { p: 0.5, bad: false, text: "glass ok" },
    ] },
    { key: "suspension", label: "wheel / suspension", cost: 250, outcomes: [
      { p: 0.35, bad: true, text: "wheel cracked, control arm bent", lines: (c) => [part("wheel + control arm", amt(c, 210, 750), mech(c, 2, 3)), part("alignment", amt(c, 100, 150))] },
      { p: 0.65, bad: false, text: "rolls straight" },
    ] },
  ],
  flood: [
    { key: "waterline", label: "water line", cost: 300, outcomes: [
      { p: 0.4, bad: false, text: "water line at the floorboards" },
      { p: 0.4, bad: true, text: "water line at the seats", days: 3, resale: 0.9, lines: (c) => [part("seats (used)", amt(c, 600, 1500)), part("lower electrical modules", amt(c, 400, 1400), mech(c, 3, 6))] },
      { p: 0.2, bad: true, text: "water line above the dash", days: 8, resale: 0.7, lines: (c) => [part("wiring harness + modules", amt(c, 2000, 4800), mech(c, 14, 24)), part("seats (used)", amt(c, 600, 1500))] },
    ] },
    { key: "engine", label: "engine", cost: 250, outcomes: [
      { p: 0.3, bad: true, text: "engine hydrolocked — water in the cylinders", days: 5, lines: (c) => [part("used engine", amt(c, 1800, 4200), mech(c, 12, 18))] },
      { p: 0.7, bad: false, text: "engine turns over, oil is clean" },
    ] },
    { key: "trans", label: "transmission", cost: 200, outcomes: [
      { p: 0.25, bad: true, text: "water in the transmission", days: 2, lines: (c) => [part("transmission flush + rebuild", amt(c, 1200, 2800), mech(c, 4, 7))] },
      { p: 0.75, bad: false, text: "trans fluid looks normal" },
    ] },
    { key: "electrical", label: "electrical", cost: 150, outcomes: [
      { p: 0.5, bad: true, text: "dash lit up like a christmas tree", lines: (c) => [part("body control module + sensors", amt(c, 300, 1200), mech(c, 2, 5))] },
      { p: 0.5, bad: false, text: "no warning lights" },
    ] },
  ],
  hail: [
    { key: "severity", label: "dent depth", cost: 200, outcomes: [
      { p: 0.6, bad: false, text: "all pdr-able" },
      { p: 0.4, bad: true, text: "roof skin needs replacing", days: 4, lines: (c) => [part("roof skin", amt(c, 400, 900), body(c, 18, 26)), part("roof paint", amt(c, 350, 700))] },
    ] },
    { key: "windshield", label: "windshield", cost: 150, outcomes: [
      { p: 0.5, bad: true, text: "windshield cracked", lines: (c) => [part("windshield", amt(c, 250, 600) * (c.cls === "lux" || c.cls === "ev" ? 2 : 1), body(c, 1.5, 2))] },
      { p: 0.5, bad: false, text: "glass ok" },
    ] },
    { key: "sunroof", label: "sunroof / back glass", cost: 150, outcomes: [
      { p: 0.2, bad: true, text: "back glass shattered", lines: (c) => [part("back glass", amt(c, 300, 900), body(c, 1.5, 2.5))] },
      { p: 0.8, bad: false, text: "no other glass damage" },
    ] },
  ],
  mechanical: [
    { key: "engine", label: "engine", cost: 300, outcomes: [
      { p: 0.35, bad: true, text: "engine knocks — spun rod bearing", days: 6, lines: (c) => [part("used engine", amt(c, 1800, 4500), mech(c, 12, 18))] },
      { p: 0.25, bad: true, text: "timing chain rattle", days: 3, lines: (c) => [part("timing chain kit", amt(c, 250, 700), mech(c, 8, 12))] },
      { p: 0.2, bad: false, text: "just a bad starter", lines: (c) => [part("starter", amt(c, 150, 380), mech(c, 1, 2))] },
      { p: 0.2, bad: true, text: "engine seized solid", days: 7, lines: (c) => [part("used engine", amt(c, 2500, 5500), mech(c, 14, 20))] },
    ] },
    { key: "trans", label: "transmission", cost: 250, outcomes: [
      { p: 0.35, bad: true, text: "transmission slips in 2nd–3rd", days: 3, lines: (c) => [part("used transmission", amt(c, 1200, 3000), mech(c, 6, 9))] },
      { p: 0.65, bad: false, text: "shifts fine" },
    ] },
    { key: "cooling", label: "cooling system", cost: 150, outcomes: [
      { p: 0.3, bad: true, text: "head gasket weeping, coolant in the oil", days: 3, lines: (c) => [part("head gasket set + machine work", amt(c, 400, 1000), mech(c, 10, 16))] },
      { p: 0.7, bad: false, text: "no leaks" },
    ] },
  ],
  runs: [
    { key: "cel", label: "check engine light", cost: 150, outcomes: [
      { p: 0.5, bad: false, text: "no codes" },
      { p: 0.3, bad: true, text: "misfire — coil + plugs", lines: (c) => [part("ignition coil + plugs", amt(c, 150, 400), mech(c, 1, 2))] },
      { p: 0.2, bad: true, text: "catalytic converter efficiency (p0420)", lines: (c) => [part("catalytic converter", amt(c, 600, 1800), mech(c, 1.5, 2.5))] },
    ] },
    { key: "history", label: "previous repairs", cost: 200, outcomes: [
      { p: 0.3, bad: true, text: "cheap old bodywork, bondo under the paint", lines: (c) => [part("redo bodywork + paint", amt(c, 300, 800), body(c, 6, 10))] },
      { p: 0.7, bad: false, text: "no previous repairs" },
    ] },
    { key: "tires", label: "tires / brakes", cost: 150, outcomes: [
      { p: 0.5, bad: true, text: "tires bald, rotors grooved", lines: (c) => [part("4 tires + brakes", amt(c, 450, 950), mech(c, 1.5, 2.5))] },
      { p: 0.5, bad: false, text: "plenty of tread" },
    ] },
  ],
};

const DAMAGE_ODDS: [Damage, number][] = [["front", 0.26], ["rear", 0.14], ["side", 0.14], ["flood", 0.1], ["hail", 0.1], ["mechanical", 0.13], ["runs", 0.13]];
const TITLE_ODDS: Record<Damage, [Title, number][]> = {
  front: [["salvage", 0.7], ["clean", 0.2], ["rebuilt", 0.1]],
  rear: [["salvage", 0.65], ["clean", 0.25], ["rebuilt", 0.1]],
  side: [["salvage", 0.65], ["clean", 0.25], ["rebuilt", 0.1]],
  flood: [["salvage", 0.85], ["clean", 0.15]],
  hail: [["clean", 0.55], ["salvage", 0.45]],
  mechanical: [["clean", 0.75], ["salvage", 0.15], ["rebuilt", 0.1]],
  runs: [["clean", 0.6], ["salvage", 0.25], ["rebuilt", 0.15]],
};
// share of clean retail you get selling it fixed. a salvage car becomes "rebuilt" after inspection. TUNE
const RESALE: Record<Title, [number, number]> = { clean: [0.86, 0.94], salvage: [0.62, 0.76], rebuilt: [0.66, 0.78] };
const BASE_DAYS: Record<Damage, [number, number]> = { front: [6, 10], rear: [4, 7], side: [5, 9], flood: [7, 12], hail: [3, 6], mechanical: [3, 6], runs: [1, 2] };

function weighted<T>(r: Rng, xs: [T, number][]) {
  let x = r.next() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of xs) if ((x -= w) < 0) return v;
  return xs[xs.length - 1][0];
}

export type ReportItem = { label: string; text: string; hidden: boolean; cost: number; bad: boolean; lines: Line[]; days: number; resale: number; expCost: number; expResale: number };
export type Lot = {
  year: number;
  make: string;
  model: string;
  trim: string;
  body: Body;
  miles: number;
  title: Title;
  damage: Damage;
  retail: number; // clean-title retail before the damage (what the lot sheet calls est. retail)
  open: number; // opening bid
  items: ReportItem[];
  baseDays: number;
  resaleShare: number; // before item penalties
  // what a sensible buyer expects from the visible info (bots use it; tests check fairness)
  expect: { repairs: number; resale: number };
};

/** one lot. everything (even hidden outcomes) is decided now, from the seed. */
export function makeLot(r: Rng, damage: Damage): Lot {
  const pool = VEHICLES;
  const v = r.pick(pool);
  const year = r.int(v.from, v.to);
  const age = Math.max(1, GAME_YEAR - year);
  const miles = Math.round(age * 12_000 * (0.55 + r.next() * 0.95) + r.int(0, 999));
  const title = weighted(r, TITLE_ODDS[damage]);
  const retail = cleanRetail(v, year, miles);
  const c: Ctx = { r, m: PARTS_X[v.cls], cls: v.cls };

  const items: ReportItem[] = VISIBLE[damage](c).map((x) => {
    const lines = x.lines(c);
    return { label: x.text.split(":")[0], text: x.text, hidden: false, cost: 0, bad: true, lines, days: 0, resale: 1, expCost: 0, expResale: 1 };
  });
  let expRepairs = items.reduce((a, it) => a + it.lines.reduce((s, l) => s + l.parts + l.labor, 0), 0);
  let expResaleX = 1;
  const checks = r.shuffle([...CHECKS[damage]]).slice(0, 3);
  for (const ch of checks) {
    const o = weighted(r, ch.outcomes.map((o) => [o, o.p] as [Outcome, number]));
    // expected cost of this check, so bots (and the opening bid) price in the risk
    let expCost = 0;
    let expRes = 0;
    for (const alt of ch.outcomes) {
      const probe: Ctx = { r: rng(`probe:${ch.key}:${alt.text}`), m: c.m, cls: c.cls };
      expCost += alt.p * (alt.lines?.(probe) ?? []).reduce((s, l) => s + l.parts + l.labor, 0);
      expRes += alt.p * (alt.resale ?? 1);
    }
    expRepairs += expCost;
    expResaleX *= expRes;
    const lines = o.lines?.(c) ?? [];
    items.push({ label: ch.label, text: o.text, hidden: true, cost: ch.cost, bad: o.bad, lines, days: o.days ?? 0, resale: o.resale ?? 1, expCost: Math.round(expCost), expResale: expRes });
  }
  // a replacement engine comes with its own head gasket
  if (items.some((it) => it.label === "engine" && it.lines.some((l) => l.part === "used engine"))) {
    for (const it of items) if (it.label === "cooling system" && it.lines.length) {
      it.lines = [];
      it.text += " (moot: the engine's getting replaced)";
    }
  }
  const [lo, hi] = RESALE[title];
  const resaleShare = lo + r.next() * (hi - lo);
  const floodX = damage === "flood" ? (title === "clean" ? 0.7 : 0.85) : 1; // flood history follows the car. TUNE
  const expResale = r100(retail * ((lo + hi) / 2) * floodX * expResaleX);
  const fair = Math.max(300, expResale - expRepairs);
  const open = Math.max(100, r100(fair * (0.22 + r.next() * 0.16)));
  return {
    year,
    make: v.make,
    model: v.model,
    trim: r.pick(v.trims),
    body: v.body,
    miles,
    title,
    damage,
    retail,
    open,
    items,
    baseDays: r.int(...BASE_DAYS[damage]),
    resaleShare: resaleShare * floodX,
    expect: { repairs: Math.round(expRepairs), resale: expResale },
  };
}

/** what fixing + selling a lot really comes to */
export function outcome(lot: Lot) {
  const lines = lot.items.flatMap((i) => i.lines);
  const repairs = lines.reduce((a, l) => a + l.parts + l.labor, 0);
  const days = lot.baseDays + lot.items.reduce((a, i) => a + i.days, 0);
  const resale = r100(lot.retail * lot.resaleShare * lot.items.reduce((a, i) => a * i.resale, 1));
  return { lines, repairs, days, resale };
}

export function makeLots(seed: string) {
  const r = rng(`edwrdq:auction:${seed}`);
  const lots: Lot[] = [];
  const count: Partial<Record<Damage, number>> = {};
  while (lots.length < LOTS) {
    const d = weighted(r, DAMAGE_ODDS);
    if ((count[d] ?? 0) >= 2) continue; // variety: no more than two of one damage type
    count[d] = (count[d] ?? 0) + 1;
    lots.push(makeLot(r, d));
  }
  return lots;
}

// ------------------------------------------------------------------ game state

export type Personality = "cautious" | "gambler" | "sniper";
export type Player = { seat: number; nick: string; bot: Personality | null; cash: number; inspected: Record<number, number>; spentInspect: number };
export type Sale = { lot: number; seat: number | null; price: number; fees: number; repairs: number; resale: number; profit: number; days: number };
export type Phase = "intro" | "preview" | "bidding" | "sold" | "done";
export type AuctionState = {
  seed: string;
  lots: Lot[];
  lot: number;
  phase: Phase;
  ends: number;
  players: Player[];
  high: { seat: number; amount: number } | null;
  bids: { seat: number; amount: number; at: number }[];
  sales: Sale[];
  botNext: number;
  /** per-lot bot limits, decided when bidding opens */
  botMax: Record<number, number>;
  /** clock speed: 1 normally. local testing can run faster. */
  k: number;
};

export function createAuction(seed: string, seats: { seat: number; nick: string; bot: boolean }[], now: number, k = 1): AuctionState {
  const r = rng(`edwrdq:auction-bots:${seed}`);
  const kinds: Personality[] = ["cautious", "gambler", "sniper"];
  return {
    seed,
    lots: makeLots(seed),
    lot: 0,
    phase: "intro",
    ends: Math.round(now + T.intro * k),
    players: seats.map((s) => ({ seat: s.seat, nick: s.nick, bot: s.bot ? r.pick(kinds) : null, cash: BANKROLL, inspected: {}, spentInspect: 0 })),
    high: null,
    bids: [],
    sales: [],
    botNext: 0,
    botMax: {},
    k,
  };
}

const player = (s: AuctionState, seat: number) => s.players.find((p) => p.seat === seat);

/** most you can bid and still cover the fees */
export function maxBid(cash: number) {
  let lo = 0;
  let hi = cash;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid + fees(mid).total <= cash) lo = mid;
    else hi = mid;
  }
  return lo;
}

export type Action = { a: "inspect"; item: number } | { a: "bid"; inc: number };
export type ActResult = { ok: true } | { ok: false; notice: string };

export function act(s: AuctionState, seat: number, x: Action, now: number): ActResult {
  const p = player(s, seat);
  if (!p) return { ok: false, notice: "you're not in this game." };
  const lot = s.lots[s.lot];
  if (x.a === "inspect") {
    if (s.phase !== "preview") return { ok: false, notice: "inspections close when bidding opens." };
    if (p.inspected[s.lot] !== undefined) return { ok: false, notice: "one inspection per lot." };
    const it = lot.items[x.item];
    if (!it?.hidden) return { ok: false, notice: "nothing to inspect there." };
    if (p.cash < it.cost) return { ok: false, notice: "not enough cash." };
    p.cash -= it.cost;
    p.spentInspect += it.cost;
    p.inspected[s.lot] = x.item;
    return { ok: true };
  }
  if (x.a === "bid") {
    if (s.phase !== "bidding" || now >= s.ends) return { ok: false, notice: "bidding isn't open." };
    if (!INCREMENTS.includes(x.inc as (typeof INCREMENTS)[number])) return { ok: false, notice: "bad bid." };
    if (s.high?.seat === seat) return { ok: false, notice: "you're already the high bidder." };
    const amount = s.high ? s.high.amount + x.inc : lot.open;
    if (amount > maxBid(p.cash)) return { ok: false, notice: "not enough cash for that bid + fees." };
    s.high = { seat, amount };
    s.bids = [...s.bids, { seat, amount, at: now }].slice(-8);
    if (s.ends - now < T.snipe * s.k) s.ends = Math.round(now + T.snipe * s.k); // anti-snipe
    return { ok: true };
  }
  return { ok: false, notice: "unknown action." };
}

// ------------------------------------------------------------------ bots

/** what a bot thinks the car is worth to it (resale − repairs), with what it can see */
function botValue(s: AuctionState, p: Player) {
  const lot = s.lots[s.lot];
  let repairs = lot.expect.repairs;
  let resale = lot.expect.resale;
  const seen = p.inspected[s.lot];
  if (seen !== undefined) {
    // swap the expected cost of the inspected check for what it really is
    const it = lot.items[seen];
    repairs += it.lines.reduce((a, l) => a + l.parts + l.labor, 0) - it.expCost;
    resale = r100((resale / it.expResale) * it.resale);
  }
  return resale - repairs;
}

function botLimits(s: AuctionState) {
  const r = rng(`edwrdq:auction-limits:${s.seed}:${s.lot}`);
  const out: Record<number, number> = {};
  for (const p of s.players) {
    if (!p.bot) continue;
    const v = botValue(s, p);
    const share = p.bot === "cautious" ? 0.62 : p.bot === "gambler" ? 0.92 + r.next() * 0.2 : 0.78; // TUNE
    let max = v * share * (0.9 + r.next() * 0.2);
    max -= fees(Math.max(0, max)).total;
    out[p.seat] = Math.min(maxBid(p.cash), Math.max(0, Math.floor(max)));
  }
  return out;
}

function botInspect(s: AuctionState) {
  const r = rng(`edwrdq:auction-inspect:${s.seed}:${s.lot}`);
  const lot = s.lots[s.lot];
  for (const p of s.players) {
    if (!p.bot || p.inspected[s.lot] !== undefined) continue;
    const want = p.bot === "cautious" ? 0.8 : p.bot === "sniper" ? 0.4 : 0.1;
    if (!r.chance(want)) continue;
    // check the priciest-to-get-wrong item (the expensive inspection)
    const hidden = lot.items.map((it, i) => ({ it, i })).filter((x) => x.it.hidden);
    const pick = hidden.sort((a, b) => b.it.cost - a.it.cost)[0];
    if (pick && p.cash > pick.it.cost + 2000) act(s, p.seat, { a: "inspect", item: pick.i }, 0);
  }
}

/** one bot move (at most) during bidding. returns true if anyone bid. */
function botBid(s: AuctionState, now: number) {
  const r = rng(`edwrdq:auction-bid:${s.seed}:${s.lot}:${s.bids.length}:${Math.floor(now / 500)}`);
  const left = s.ends - now;
  const lot = s.lots[s.lot];
  const next = (inc: number) => (s.high ? s.high.amount + inc : lot.open);
  const willing = s.players.filter((p) => {
    if (!p.bot || s.high?.seat === p.seat) return false;
    if (next(100) > (s.botMax[p.seat] ?? 0)) return false;
    if (p.bot === "sniper") return left < 4_000 * s.k;
    return true;
  });
  if (!willing.length || !r.chance(left < 4_000 * s.k ? 0.85 : 0.55)) return false;
  const p = r.pick(willing);
  const room = (s.botMax[p.seat] ?? 0) - (s.high?.amount ?? lot.open - 100);
  const inc = p.bot === "gambler" && room > 1500 ? 500 : room > 800 && r.chance(0.5) ? 250 : 100;
  return act(s, p.seat, { a: "bid", inc }, now).ok;
}

// ------------------------------------------------------------------ the clock

/** advance phases and let bots act. call on every alarm; returns true if anything changed. */
export function tick(s: AuctionState, now: number): boolean {
  let changed = false;
  for (let guard = 0; guard < 10 && s.phase !== "done" && now >= s.ends; guard++) {
    changed = true;
    if (s.phase === "intro") {
      s.phase = "preview";
      s.ends = Math.round(now + T.preview * s.k);
      botInspect(s);
    } else if (s.phase === "preview") {
      s.phase = "bidding";
      s.ends = Math.round(now + T.bidding * s.k);
      s.high = null;
      s.bids = [];
      s.botMax = botLimits(s);
      s.botNext = Math.round(now + 1500 * s.k);
    } else if (s.phase === "bidding") {
      settle(s);
      s.phase = "sold";
      s.ends = Math.round(now + T.sold * s.k);
    } else if (s.phase === "sold") {
      if (s.lot + 1 >= s.lots.length) {
        s.phase = "done";
        s.ends = now;
      } else {
        s.lot++;
        s.phase = "preview";
        s.ends = Math.round(now + T.preview * s.k);
        botInspect(s);
      }
    }
  }
  if (s.phase === "bidding" && now >= s.botNext && now < s.ends) {
    if (botBid(s, now)) changed = true;
    s.botNext = Math.round(now + (700 + Math.floor(rng(`${s.seed}:${now}`).next() * 900)) * s.k);
  }
  return changed;
}

function settle(s: AuctionState) {
  const lot = s.lots[s.lot];
  const o = outcome(lot);
  if (!s.high) {
    s.sales.push({ lot: s.lot, seat: null, price: 0, fees: 0, repairs: o.repairs, resale: o.resale, profit: 0, days: o.days });
    return;
  }
  const p = player(s, s.high.seat)!;
  const f = fees(s.high.amount).total;
  const profit = o.resale - s.high.amount - f - o.repairs;
  // you pay, fix it, sell it: the money comes back before the next lot
  p.cash += -s.high.amount - f - o.repairs + o.resale;
  s.sales.push({ lot: s.lot, seat: p.seat, price: s.high.amount, fees: f, repairs: o.repairs, resale: o.resale, profit, days: o.days });
}

/** when the room should wake next */
export function nextWake(s: AuctionState) {
  if (s.phase === "done") return null;
  return s.phase === "bidding" ? Math.min(s.ends, s.botNext) : s.ends;
}

/** a seat leaving mid-game is taken over by a bot */
export function botify(s: AuctionState, seat: number) {
  const p = player(s, seat);
  if (p && !p.bot) p.bot = "cautious";
}

// ------------------------------------------------------------------ what each seat sees

export type LotView = Omit<Lot, "items" | "resaleShare" | "expect" | "baseDays"> & {
  items: { label: string; text: string | null; hidden: boolean; cost: number; mine: boolean; bad: boolean | null }[];
};
export type AuctionView = {
  now: number;
  phase: Phase;
  ends: number;
  lotNo: number;
  lots: number;
  lot: LotView;
  high: { seat: number; amount: number } | null;
  bids: { seat: number; amount: number }[];
  you: { seat: number; cash: number; maxBid: number; inspected: number | null } | null;
  players: { seat: number; nick: string; bot: boolean; cash: number; profit: number; won: number }[];
  sale: (Sale & { lines: Line[]; feeBreakdown: ReturnType<typeof fees> | null }) | null;
  results: { sales: (Sale & { car: string; damage: Damage; title: Title })[] } | null;
};

export const carName = (l: Pick<Lot, "year" | "make" | "model" | "trim">) => `${l.year} ${l.make} ${l.model} ${l.trim}`;

export function view(s: AuctionState, seat: number, now: number): AuctionView {
  const lot = s.lots[s.lot];
  const me = player(s, seat);
  const revealed = s.phase === "sold" || s.phase === "done";
  const mine = me?.inspected[s.lot];
  const { items, resaleShare: _r, expect: _e, baseDays: _b, ...rest } = lot;
  const sale = revealed ? s.sales.find((x) => x.lot === s.lot) ?? null : null;
  const profitOf = (p: Player) => p.cash - BANKROLL;
  return {
    now,
    phase: s.phase,
    ends: s.ends,
    lotNo: s.lot + 1,
    lots: s.lots.length,
    lot: {
      ...rest,
      items: items.map((it, i) => {
        const see = !it.hidden || revealed || mine === i;
        return { label: it.label, text: see ? it.text : null, hidden: it.hidden, cost: it.cost, mine: mine === i, bad: see ? it.bad : null };
      }),
    },
    high: s.high,
    bids: s.bids.map((b) => ({ seat: b.seat, amount: b.amount })),
    you: me ? { seat, cash: me.cash, maxBid: maxBid(me.cash), inspected: mine ?? null } : null,
    players: s.players.map((p) => ({ seat: p.seat, nick: p.nick, bot: !!p.bot, cash: p.cash, profit: profitOf(p), won: s.sales.filter((x) => x.seat === p.seat).length })),
    sale: sale ? { ...sale, lines: outcome(lot).lines, feeBreakdown: sale.seat !== null ? fees(sale.price) : null } : null,
    results: s.phase === "done" ? { sales: s.sales.map((x) => ({ ...x, car: carName(s.lots[x.lot]), damage: s.lots[x.lot].damage, title: s.lots[x.lot].title })) } : null,
  };
}

/** end-screen line for the worst buy */
export function disaster(x: { damage: Damage; price: number; profit: number; car: string }) {
  const k = `$${Math.round(x.price / 1000)}k`;
  const lines: Record<Damage, string> = {
    flood: `bought a flood car for ${k}. it was a fish tank.`,
    mechanical: `paid ${k} for a car that wouldn't run. it still doesn't.`,
    front: `paid ${k} for a front end. the frame had opinions.`,
    rear: `paid ${k} for a rear-ender. the trunk floor was a taco.`,
    side: `paid ${k} for a t-bone. it t-boned the bank account.`,
    hail: `paid ${k} for a golf ball. the dents won.`,
    runs: `paid ${k} for a "run & drive". it ran. then it didn't.`,
  };
  return lines[x.damage];
}
