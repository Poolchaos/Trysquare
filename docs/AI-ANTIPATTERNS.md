# AI Anti-Patterns: the tells that expose AI-built work

Compiled 2026-07-27 from a three-track web investigation (webapp design tells,
game tells, writing and code tells); sources at the end. This is the
project-agnostic catalog, binding for ALL work in this repo: pages, copy,
emails, generated documents, docs, commits, and code. Adopted on
2026-07-27. Where a rule here and a more specific rule in CLAUDE.md or
docs/04-UI-DESIGN.md disagree, the more specific one wins. Section 2 covers
game surfaces and is kept so this file stays portable; it does not apply
here.

Two findings frame everything below:

1. **No single tell is proof. Density and uniformity are the signal.** Every
   source converges on this: one purple button convicts nobody; a page where
   every card, heading, and sentence follows the statistical default does.
   Edited AI output with the tells removed is largely indistinguishable, which
   is the point: remove them.
2. **Tells are what happens when nobody made a decision.** Generators emit the
   statistical average of their training data (the purple gradient traces to
   Tailwind demo defaults saturating tutorials). A surface that could belong
   to any product is therefore a defect even when nothing on the lists below
   appears. The core test users apply takes about 3 seconds: "they all look
   the same."

Stigma is measured, not theoretical: disclosed AI use on Steam cuts review
counts roughly in half; a CHI 2026 study found players rate content worse
merely for believing it is AI-made; undisclosed AI assets in a game with any
audience are typically spotted within 24 hours.

---

## 1. Web and app visual tells

### 1.1 Color

- Purple-to-blue / indigo-to-violet gradients; the loudest single tell.
  Blue-to-pink and cyan-to-purple variants included.
- The recurring lavender "AI purple" accent (ranked the #2 tell in a
  3.2M-post Reddit-mining study).
- Gradient-filled text: hero headlines, big stat numbers.
- Default shadcn grays plus Tailwind blue as the entire palette.
- Neon-on-dark: cyan/violet accents with glowing colored box-shadows.
- Radial gradient halos and blurred gradient "orbs" floating behind hero
  content on dark pages.
- Pure #fff or #000 backgrounds with no tint; or its 2026 successor, the
  reflex "tasteful" warm cream/beige.
- Multiple saturated colors competing with no hierarchy.
- Dark-theme body text that barely scrapes WCAG AA contrast.

### 1.2 Typography

- Inter as the unchosen default; the rotating cast of stand-ins: Poppins,
  Space Grotesk, Geist, Manrope, Roboto, Instrument Serif.
- The oversized italic-serif accent word inside a sans hero headline.
- One font family everywhere, no display/body pairing, hierarchy carried by
  font-size alone.
- All-caps letter-spaced kicker labels repeated above every section heading.
- Monospace used decoratively "for the hacker vibe" rather than for code or
  data.
- Crushed, over-tight letter-spacing on display type.

### 1.3 Layout and structure

- The default SaaS hero: everything centered, eyebrow pill/badge chip above
  the H1 ("Trusted by 2,800+ teams"), gradient headline, dual CTAs (solid
  "Start Free" plus ghost "Watch Demo").
- The fixed page skeleton in the same order every time: hero, three feature
  cards, logo strip, stats banner, pricing (middle tier highlighted), FAQ
  accordion, footer.
- Exactly three feature cards in a row: icon tile, title, two lines of blurb,
  rounded corners, soft shadow.
- Numbered "1 / 2 / 3" how-it-works step rows; tiny editorial "01 / 02 / 03"
  section numbers.
- Stat banner rows: big number, small label, three supporting stats.
- Bento grids as the reflex "fancy" option.
- Cardocalypse: cards nested 3-5 levels deep, everything boxed, each layer
  with its own padding and shadow.
- The colored 3-4px left-border strip on cards, cycling colors with no
  semantic logic; multiple sources call this the single most reliable tell.
- Hairline 1px border paired with a wide diffuse shadow on the same card;
  over-rounded 24px+ radii turning small cards into soft blobs.
- Uniform spacing rhythm: identical section padding, one max-width container,
  identical card heights, uniform 16px radius everywhere.
- Permanent dark mode as reflex default; the "Linear-clone" look (dark
  background, blurred glows, animated gradient artifacts) that fails the
  squint test between four different companies.
- Glassmorphism used decoratively rather than to solve a layering problem.

### 1.4 Components

- shadcn/ui defaults shipped untouched (`rounded-2xl shadow-lg p-6`, default
  theme, default radius); the #1 tell in the Reddit-mining study.
- Testimonial walls with placeholder avatars and unverifiable names; logo
  strips with unearned or fake press logos, often auto-scrolling.
- The universal feature-card icon tile: a small rounded square holding a
  generic thin-line icon that could illustrate any product.
- Emoji used as icons in navs, cards, and bullets (ranked #5 tell); the
  four-pointed sparkle glyph as default AI iconography.
- Meaningless pulsing/colored status dots mapped to no real state.
- "Edit with Lovable" / "Built with Bolt" badges; "Built with" plus a heart
  emoji in the footer.
- Forms with no validation, error, hover, focus, disabled, empty, or loading
  states.
- Default favicon, links pointing to "#", placeholder social links.

### 1.5 Motion

- Identical fade-in-on-scroll on every element, same timing, no purpose.
- Universal hover-lift on cards, stagger on lists, image scale/rotate on
  hover.
- Auto-scrolling logo marquees; typewriter/blinking-cursor hero text; aurora
  and gradient-blob background animations; scroll-jacking; cursor followers.
- Bounce/elastic easing; or the inverse tell, zero interaction states at all.
- Ignoring `prefers-reduced-motion`.

### 1.6 Imagery

- AI-generated hero art with plastic smoothness and unnatural symmetry;
  stock photos of diverse people at laptops.
- Undraw/Storyset-style flat stock illustration as filler; floating 3D
  abstract blobs; generic SVG mascot doodles.

## 2. Game tells

### 2.1 Art

- Melted or wrong fine detail: hands, fingers, feet, eyes, teeth; the first
  thing players check.
- Gibberish pseudo-text baked into signs, labels, and textures; players
  screenshot these.
- Objects merging or floating: straps that go nowhere, weapons fused with
  hands, accessories detached from bodies.
- The glossy "AI sheen": waxy poreless skin, over-rendered volumetric glow,
  hyperdetailed but soulless; cinematic lighting over content that falls
  apart on second look.
- Excessive random ornament that means nothing; prompt attributes leaking
  onto everything in a scene (spillover).
- Characters that never keep the same face: portrait, sprite, and dialogue
  bust read as different people; outfit details drift between poses. Only
  reference-linking holds identity.
- Style inconsistency across assets: no shared palette, outline treatment,
  rendering style, or finish level; pixel-density mismatches between sprites
  and backgrounds; unmodified recognizable asset-store packs (the "asset
  flip" read).
- Extreme per-asset contrast with no unified value structure across the
  scene.
- Gorgeous AI key art next to visibly cruder gameplay screenshots; the gap
  itself is the tell.

### 2.2 Game UI

- Engine-default UI: Godot default theme, Unity default font and grey
  buttons; reads as prototype.
- UI icons in a different style from the game art; icon sets pulled from
  mixed packs; inconsistent icon sizing and margins; a store-bought UI kit
  dropped in wholesale.
- Web/SaaS grammar inside a HUD: cards with drop shadows, pill labels,
  gradient CTAs.
- Emoji in game-facing strings as stand-in iconography.

### 2.3 Game writing

- Dialogue in the assistant register: over-formal, over-explaining,
  relentlessly positive, exclamation-heavy barks, "brave adventurer" filler.
- Lore dumps with no voice that summarize the world at the player instead of
  speaking in character.
- Templated item descriptions: every item follows one sentence skeleton
  (name, epic adjective, vague lore clause).
- Tutorial copy in the assistant register ("Great job! Now let's...").
- Plus every prose tell in section 3.

### 2.4 Audio

- Generic AI music: predictable progressions, cliche instrumentation,
  supermarket-playlist polish; fixed songs with audible loop seams and no
  dynamic layering; mood that does not match the scene.
- AI voice: flat pitch, no emotional variation, mispronounced names and
  numbers, uncanny consistency.

### 2.5 Design and structure

- Broad but shallow: many systems, none deep; content volume disproportionate
  to team size is itself a red flag players price in.
- Procedurally samey or outright broken generated levels (blocked paths, no
  coherence).
- Visible runtime-AI latency (NPCs pausing seconds before responding).

### 2.6 Store page and meta

- The capsule/header is where players hunt for tells first (fingers,
  gibberish text, sheen).
- Missing or evasive AI disclosure where the platform requires it (Steam,
  itch.io); communities detect undisclosed assets within about 24 hours, and
  the cover-up outweighs the crime. Disclose honestly; this workspace's
  policy is honest disclosure with the `art_src/` authorship trail as
  evidence.
- Trailer/screenshot mismatch; scrubbing AI marketing material after being
  caught becomes its own story.

## 3. Writing and copy tells

### 3.1 Vocabulary (banned in shipped copy)

- The canonical spikes: delve, tapestry, landscape, realm, synergy,
  testament ("a testament to"), journey, navigate ("navigating the complex
  landscape of").
- Abstract verb inflation: leverage, utilize, harness, streamline,
  facilitate, foster, enhance, elevate, empower, supercharge, unleash,
  unlock (as marketing verb).
- Inflated adjectives: crucial, pivotal, robust, seamless, comprehensive,
  nuanced, vibrant, profound, nestled, innovative, cutting-edge,
  game-changing, world-class, best-in-class, enterprise-grade.
- The formal transition stack at unnatural density: moreover, furthermore,
  additionally, consequently.
- Elegant variation: refusing to repeat a word, cycling synonyms; dodging
  plain "is" with "serves as", "stands as", "functions as", "marks".

### 3.2 Constructions

- "It's not just X, it's Y" / "Not X, but Y" contrast-parallelism; the
  signature construction of this era.
- The reflexive rule of three ("fast, fun, and friendly") in nearly every
  list-like sentence; paired-fragment intensifiers ("No ads. No nonsense.").
- "In today's fast-paced world"; "Let's dive in"; "look no further".
- Sycophantic openers leaking into copy ("Great question!").
- The hedging register: "It's worth noting", "Generally speaking", "could
  potentially", "arguably one of the most", superlatives nobody verified.
- Recap conclusions ("In conclusion", "Ultimately") that restate the piece;
  auto-appended FAQ or "Key Takeaways" padding.
- Sentence-final participle analysis tacked onto facts ("..., highlighting
  the importance of...", "..., underscoring its role in...").
- Vague attributions with no named source ("experts argue", "industry
  reports suggest").
- Weightless headlines that fit any product ("Build faster. Ship smarter.",
  "Your all-in-one platform", "Your journey starts here").

### 3.3 Punctuation and formatting

- Em dashes (workspace-wide ban; periods or hyphens).
- Title Case On Every Heading where house style is sentence case.
- Bold-keyword-per-sentence; bulleted lists where every item is a bolded
  lead-in. Micro-tell: ending the bold lead-in with a period where a human
  writes a colon.
- Emoji-headed sections and emoji-led bullets (workspace-wide emoji ban).
- Curly/straight quote inconsistency from pasted output; markdown remnants
  in non-markdown surfaces.
- Chatbot artifacts pasted verbatim: "As an AI...", "As of my last
  update...", "Certainly! Here's...", citation tokens ("oaicite",
  "turn0search0"), `utm_source=chatgpt.com` in URLs.
- Every-sentence exclamation marks.

### 3.4 Structure and tone

- Uniform paragraph rhythm: same sentence lengths, same paragraph shapes,
  cadence that never varies; polished but voiceless.
- Rigid outline structure regardless of content: intro, 3-5 headed sections,
  conclusion.
- Everything hedged and nothing claimed: no stake, no opinion, no concrete
  anecdote; redundant UX writing where label, sublabel, and helper text all
  say the same thing.
- Sudden style shift where AI paragraphs were spliced into human text.
- Broken or hallucinated citations: dead links, invalid DOIs, cites to
  search-result pages.

## 4. Code and repository tells

### 4.1 Comments

- Narrating the obvious ("// increment counter") uniformly across files.
- Change-narration addressed to a reviewer ("// Fixed the bug where...",
  "// Updated to use the new API"); the comment describes the diff, not the
  code.
- Step headers inside functions ("# Step 1: Validate input"); formulaic
  never-revisited TODOs.
- Full Args/Returns/Raises docstring boilerplate on trivial functions in a
  codebase that documents nothing else.
- Conversational leftovers ("Note that...", "You may want to...").

### 4.2 Structure

- Over-engineering tiny tasks: factories, DI, abstract base classes for a
  10-line script; textbook 3-5 line functions with zero pragmatic shortcuts;
  sterile uniformity with no debugging artifacts.
- The same problem solved five different ways in one repo (one per prompt
  session): multiple HTTP clients, date libs, validation styles.
- Defensive try/catch around everything; broad catches that log and ignore.
- Happy-path-only logic: no validation, no edge cases, no system-wide mental
  model; missing real plumbing (config, env, logging, auth) in "complete"
  code.
- Unrequested "example usage" blocks and `__main__` demos.
- Security anti-patterns: disabled TLS verification, string-interpolated
  SQL, hardcoded example credentials.

### 4.3 Naming and hygiene

- Generic names (data, result, temp, item, processData); formulaic
  near-duplicates (user_data, user_info, user_object); over-descriptive
  names where a human writes `count`; mixed naming conventions in one file.
- Dead code, orphaned functions, unused imports from abandoned generation
  attempts.
- Hallucinated packages and APIs (a 2025 USENIX study measured 19.7% of
  package references hallucinated; the basis of "slopsquatting" attacks).
  Verify every dependency exists before adding it.
- Dependency sprawl for simple apps; imported-but-never-called packages.

### 4.4 Tests and git

- Tests that assert trivialities, only exercise the happy path, or mock the
  unit under test; tests altered to pass instead of the bug being fixed
  (already law here: CLAUDE.md, testing law).
- AI authorship trailers (Co-Authored-By, "Generated with") in commits;
  workspace-wide ban.
- Generic commit messages ("Add feature") or bloated bullet lists narrating
  the chat session, including abandoned attempts; huge single-commit diffs
  mixing unrelated changes.

### 4.5 READMEs and docs

- Emoji section headers plus badge walls plus a bolded rule-of-three
  "Features" list; "This project provides a comprehensive..."; a recap
  "Conclusion" in a README.
- Docs describing aspirational features the code does not have.

## 5. What to do instead

The corrective is the same everywhere: make decisions, and constrain the
generator with them before generating.

- **Direct with constraints.** Every project keeps a written design
  direction (here: docs/04-UI-DESIGN.md) that names the palette, type, and voice, and bans the
  defaults by name. Concrete references beat adjectives.
- **Color:** cap at ~3 hues from a decided palette, extend with tints and
  shades; tint the neutrals; every color resolves to a token.
- **Type:** a deliberate display/body pairing, licensed on purpose; never
  the default stack.
- **Layout:** break the fixed skeleton; asymmetric grids, varied section
  rhythm, left-aligned heroes; one repeating design primitive; hierarchy
  survives the squint test. Cards borderless by default, separated by
  whitespace; color strips only for real semantic states.
- **Proof over decoration:** real screenshots, verifiable claims, earned
  logos only; no manufactured social proof.
- **Motion:** functional transitions only; design all interactive states;
  respect reduced-motion.
- **Game art:** one locked style guide; one defining prompt per character
  with reference-linking for every variant; a human unification pass on
  everything (anatomy, palette, outlines, value range, gibberish text);
  never ship engine-default themes or fonts.
- **Writing:** a named voice with a stake and specifics; vary sentence
  rhythm; say the true specific thing or cut the line; a human edits every
  shipped string.
- **Code:** match the codebase's existing conventions and comment density;
  the smallest correct change; verify dependencies exist; comments state
  constraints the code cannot show, nothing else.
- **The template test:** every surface must contain at least one decision a
  template could not have made. If you cannot name it, the surface is not
  done.

## Sources

Highest-signal sources per track; live-fetched 2026-07-27.

Webapps:

- Impeccable.style "Slop" catalog: https://impeccable.style/slop/
- JCarterJohnson/vibecoded-design-tells (3.2M-post Reddit mining):
  https://github.com/JCarterJohnson/vibecoded-design-tells
- Developers Digest, "AI Design Slop: 16 Patterns":
  https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it
- VibeCodeKit, "AI Slop Design": https://vibecodekit.dev/ai-slop-design
- 925 Studios: https://www.925studios.co/blog/ai-slop-design-tells
- Publishd, "9 fingerprints": https://publishd.app/blog/make-ai-built-site-not-look-ai
- prg.sh on why generators default purple:
  https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- Fountain Institute, "7 Signs a UI Has Been Vibe Coded":
  https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui
- Daryl Ginn, "The Linear effect": https://rectangle.substack.com/p/the-linear-effect
- NN/g on the sparkles icon: https://www.nngroup.com/articles/ai-sparkles-icon-problem/

Games:

- PC Gamer on AI capsule art:
  https://www.pcgamer.com/gaming-industry/steam-week-in-review-spammy-ai-generated-capsule-art-is-a-pox-and-it-makes-browsing-steam-less-fun/
- EN World, "How do you tell when something is AI art?":
  https://www.enworld.org/threads/how-do-you-tell-when-something-is-ai-art.702681/
- ACM CHI 2026, "Playing the Imitation Game" (belief alone lowers ratings):
  https://dl.acm.org/doi/10.1145/3772318.3790473
- MMORPG.GG on The Quinfall: https://mmorpg.gg/the-quinfall-a-warning-on-asset-dependency-and-pre-order-scams/
- recognizingpatterns Substack (24-hour detection window):
  https://recognizingpatterns.substack.com/p/you-can-pick-up-the-cats
- Sam Liberty, "Why Nobody Has Cracked AI Dialogue In Games":
  https://sa-liberty.medium.com/why-nobody-has-cracked-ai-dialogue-in-games-and-a-thought-experiment-on-how-to-do-it-148a22330552
- Wayline, "The Indie Dev's Guide to AI Art": https://www.wayline.io/blog/indie-dev-ai-art-guide
- HN on the AI sheen: https://news.ycombinator.com/item?id=41262547

Writing and code:

- Wikipedia, "Signs of AI writing" (the most thorough prose catalog):
  https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- The Conversation on em dashes and "delve":
  https://theconversation.com/too-many-em-dashes-weird-words-like-delves-spotting-text-written-by-chatgpt-is-still-more-art-than-science-259629
- GPTZero, "The Rule of Three": https://gptzero.me/news/the-rule-of-three/
- Charlie Guo, "The Field Guide to AI Slop": https://www.ignorance.ai/p/the-field-guide-to-ai-slop
- AquilaX, "How to identify vibe-coded code":
  https://aquilax.ai/blog/how-to-identify-vibe-coded-ai-generated-code
- dev.to, "7 signs to spot LLM-generated Python":
  https://dev.to/dev_tips/was-this-python-written-by-a-human-or-an-ai-7-signs-to-spot-llm-generated-code-3370
- Pangram Labs on AI code signals: https://www.pangram.com/blog/ai-code-detector
- Gigacore on hallucinated packages / slopsquatting:
  https://gigacore.substack.com/p/the-dark-side-of-ai-coding-how-hallucinated
