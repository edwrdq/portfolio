// example curated logic entries (agent-written, unverified, unscheduled). they show the two formats.
export default [
  {
    game: "logic",
    kind: "order",
    title: "√2 is irrational",
    data: {
      claim: "√2 is irrational",
      steps: [
        "suppose √2 is rational, so √2 = a/b with a and b whole numbers sharing no common factor.",
        "square both sides: 2 = a²/b², so a² = 2b².",
        "a² is even, so a must be even. write a = 2k.",
        "substitute: (2k)² = 2b², so 4k² = 2b², so b² = 2k².",
        "b² is even, so b is even too.",
        "a and b are both even, so they share the factor 2. that contradicts how we picked them, so √2 can't be rational.",
      ],
      explain: "a classic proof by contradiction: assume the opposite, follow it until two facts clash.",
    },
  },
  {
    game: "logic",
    kind: "badstep",
    title: "1 = 2",
    data: {
      claim: "1 = 2",
      steps: ["let a = b.", "multiply both sides by a: a² = ab.", "subtract b²: a² − b² = ab − b².", "factor: (a + b)(a − b) = b(a − b).", "divide both sides by (a − b): a + b = b.", "since a = b: 2b = b, so 2 = 1."],
      bad: 4,
      explain: "a = b means a − b = 0, so step 5 divides both sides by zero. everything before it is fine (0 = 0 in disguise); that division is where it breaks.",
    },
  },
];
