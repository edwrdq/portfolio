---
title: hlvm
section: hlvm
date: 2026-11-21
summary: a compiler, all the way down to asm.
status: active
links:
  - label: github
    href: https://github.com/edwrdq/hlvm
---

hlvm compiles [gulf of mexico](https://github.com/TodePond/GulfOfMexico), a joke language that parodies a bunch of languages, mostly javascript.

it's written in x86-64 assembly with raw linux syscalls. why? i wanted a project that was insane, and this was the first thing that came to mind.

the plan: source → lexer → parser → ir → machine code. early versions still lean on nasm and ld. eventually i want to write those myself too.

```text
print("hello")!

→ hello
```

hardest part so far? honestly nothing yet. asm feels simpler for this than C would. it makes you do everything one step at a time. it's just tedious.

building it for hack club phantom, feb 2027.
