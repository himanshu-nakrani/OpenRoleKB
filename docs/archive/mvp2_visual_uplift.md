# Visual Uplift Plan — "Warm Consumer"

> Goal: take the existing weekend-project look and push it to feel like a *small but considered* consumer product. Notion / Cron / Arc Search reference. Warm cream + apricot, mature typography, restrained motion, no maximalism.
>
> Non-goal: redesign. The current information architecture (ask bar → we-heard chips → split list/detail) stays exactly as-is. We're tightening the visual layer, not rebuilding it.
>
> Scope: ~6h of work, 4 commits. No new dependencies. No new pages. No breaking API changes.

---

## 1. Diagnosis — what makes it look like a weekend project today

Reading the current screens against the reference vibe, five things stand out:

1. **The hero is missing.** Home page jumps straight into the ask bar. There's no display heading, no "why am I here" moment. Consumer apps earn their first 200ms by stating the promise.
2. **Type is doing one job.** Fraunces is loaded and wired (`--font-fraunces`, `font-display-opsz-*` utilities exist) but only the brand wordmark uses it. The display font is the single biggest lever for "mature, considered" — it's currently dormant.
3. **Spacing is uniform.** Header (h-14), main padding (py-8), card padding (py-4) all sit in the same rhythm. There's no breathing room around the hero, no narrative density gradient.
4. **Cards are flat-ish.** `shadow-card` exists but is very subtle; hover only shifts background by one shade. Selected state uses a 3px left border, which reads as functional, not delightful. No lift, no warm tint on hover.
5. **The accent is shouting in the wrong places.** The submit button is a solid apricot circle (`bg-accent-dark`) sitting permanently in the ask bar — high-saturation chrome that competes with results. ScoreChip at ≥85% also fills with accent. Two strong accents in the same viewport.

The palette, font loading, animation primitives, and component structure are all already correct. The uplift is almost entirely *applying what's there more deliberately* — not new tokens.

---

## 2. Design language tightening

### 2.1 Color — keep the palette, retune the weights

Current tokens are good. Two adjustments:

- **`--surface` in light mode** is pure `#FFFFFF` against a cream `#FBF8F4` bg. The contrast is sharp and reads "card on page" but it's a hair clinical. Drop surface to `#FEFCF8` — still reads white, but warms the cards into the same family as the bg.
- **`--accent-soft` in light mode** (`#FBE7D5`) is the right hue but unused. Wire it into: (a) hover background for accent-adjacent affordances (Save button when not-yet-saved gets `hover:bg-accent-soft`), (b) the selected-row left-edge gradient (see §2.4).

No new color tokens. The point is to *use* the soft accent we already have.

### 2.2 Type — let Fraunces do hero/heading work

We have `font-display-opsz-display` (opsz 72), `-h1` (opsz 36), `-h2` (opsz 24) utilities. Currently only `-h1` is used (brand wordmark).

Introduce three usage rules:

- **Display (Fraunces opsz 72, 2.5rem)**: home hero heading only. One per page, top of viewport.
- **H1 (Fraunces opsz 36, 1.625rem)**: brand wordmark (already), section labels on `/saved` and `/search/[id]` pages.
- **H2 (Fraunces opsz 24, 1.25rem)**: result detail title in `DetailPane`. Currently the detail title likely renders in Geist; switching the detail-pane title to Fraunces creates a satisfying "open the card → see the serif" reveal.

Body, micro, small, mono — all stay Geist. Don't sprinkle Fraunces around; restraint is what makes it feel intentional.

### 2.3 Shape & spacing — introduce a density gradient

Today the home page has uniform vertical rhythm. Add a hero block above the ask bar:

```
┌──────────────────────────────────────────────┐
│   (header)                                   │
├──────────────────────────────────────────────┤
│                                              │
│         Find a role you'll love.             │ ← Fraunces display, mt-16
│         Describe what you want in plain      │ ← Geist body, text-ink-soft
│         English. We'll do the searching.     │
│                                              │
│   ╭──────────────────────────────────────╮   │
│   │ ⌕  describe the role you want…    ⏎│   │ ← ask bar, mt-10
│   ╰──────────────────────────────────────╯   │
│                                              │
│   try: "junior PM fintech"  •  …             │ ← example chips, mt-8
└──────────────────────────────────────────────┘
```

Once the user has searched (results present), the hero block collapses to zero height — the ask bar slides up to top. This is the density gradient: pre-search is generous, post-search is dense and functional.

Spacing tokens stay Tailwind defaults; no new scale needed.

### 2.4 Cards — lift, tint, settle

Current `ResultRow`:
- border + subtle shadow
- hover: `bg-surface-2 border-border-strong`
- selected: 3px left accent border

Changes:

- **Hover**: add a 1px upward translate + slightly stronger shadow. `hover:-translate-y-px hover:shadow-card-hover` (introduce one new shadow var, `--shadow-card-hover`, slightly deeper than `--shadow-card`).
- **Selected**: replace the hard 3px border with a *gradient tint* on the left edge — `bg-gradient-to-r from-accent-soft/60 to-transparent` over the first ~40px of the card, plus a 2px (not 3px) accent left border. Softer, warmer, reads as "this one's open" without screaming.
- **Card radius**: bump from `rounded-lg` (8px) to `rounded-xl` (12px). Closer to the Cron/Arc family of shapes.
- **Hover transition**: keep `duration-120` but switch to `ease-enter` (already defined) instead of the implicit linear. Subtle but noticeably more "considered."

### 2.5 ScoreChip — dial back the high-end

The 85%+ tier currently fills with `bg-accent`. In a list of 8 results where the top 3 are ≥85%, you get three apricot pills shouting at once. Retune:

- **≥85%**: `bg-accent-soft text-accent-dark` + a tiny filled dot before the number (`◉ 92%`). Warm, premium, doesn't compete with the submit button.
- **65–84%**: `bg-surface-2 text-ink` (unchanged).
- **40–64%**: `bg-surface-2 text-ink-soft` (unchanged).
- **<40%**: hidden (unchanged).

Net: at most one strong-accent element per viewport (the submit button), and it earns its weight.

### 2.6 Header — glass + brand polish

`AppHeader` is already `backdrop-blur-md bg-bg/85` — good bones. Two polish moves:

- Bump blur to `backdrop-blur-xl` and bg opacity to `bg-bg/70`. More translucency = more "app chrome."
- Brand mark: the filled accent dot is fine; add a 1px subtle ring (`ring-1 ring-accent-dark/20`) so it reads as a *mark*, not a dot. Tiny detail, disproportionate impact.

### 2.7 Submit button — preserve, refine

Keep the apricot circle inside the ask bar — it's load-bearing branding. But:

- Bump from `w-10 h-10` to `w-11 h-11` so it feels slightly more substantial against the `h-14` bar.
- Add `shadow-sm` so it sits a hair above the input surface (it currently floats flat).
- Disabled state: drop to `opacity-30` is correct but feels dead. Keep opacity but add `bg-surface-3` underneath so it reads as "off," not "broken."

---

## 3. Component-level work

### 3.1 Home hero — new

Add to `src/app/page.tsx`, above `<SearchBox>`, gated on "no search has been run yet":

```tsx
{searchState.exaResults.length === 0 && searchState.phase !== "loading" && (
  <div className="max-w-3xl mx-auto pt-12 pb-8 text-center">
    <h1 className="text-display font-display-opsz-display text-ink">
      Find a role you'll love.
    </h1>
    <p className="mt-4 text-body text-ink-soft max-w-xl mx-auto">
      Describe what you want in plain English. We'll do the searching.
    </p>
  </div>
)}
```

Once the user searches, this block unmounts and the ask bar moves up. Use the existing `phase === "loading"` and `exaResults.length` signals — no new state.

### 3.2 `SearchBox` — three small refinements

- Submit button: w/h bump, `shadow-sm`, disabled bg.
- Loading shimmer: currently `via-surface-2/40`. Bump to `via-accent-soft/50` so the loading state has a faint apricot wash — it ties the loading moment to the brand color without being a spinner.
- Ask bar `border-[1.5px]`: keep. Focus state: change `focus-visible:ring-accent/40` to `focus-visible:ring-accent/30` and add `focus-visible:shadow-card-hover` so the bar lifts on focus.

### 3.3 `ResultRow` — apply card changes from §2.4

- `rounded-lg` → `rounded-xl`
- Add `hover:-translate-y-px hover:shadow-card-hover transition-all duration-120` (replace existing transition-all if duplicated)
- Selected state: remove `border-l-[3px] border-l-accent border-border-strong`, add `bg-gradient-to-r from-accent-soft/60 via-surface-2 to-surface-2 border-l-2 border-l-accent`
- The invisible spacer span when `showScore` is false (`<span className="inline-flex px-2 py-0.5 ...invisible">`) — delete it. We don't need to reserve space if we just `min-h` the row instead. Layout shift was the concern; instead use `min-h-[3.5rem]` on the inner flex.

### 3.4 `ScoreChip` — retune tiers

Update the 85%+ tier per §2.5. Add the `◉` glyph (or a `<span className="w-1.5 h-1.5 rounded-full bg-accent-dark" />` for crisper rendering).

### 3.5 `AppHeader` — glass + ring

- `backdrop-blur-md bg-bg/85` → `backdrop-blur-xl bg-bg/70`
- Brand dot: add `ring-1 ring-accent-dark/20`
- Sign-in button: already pill-shaped, fine. Slight refinement — `hover:border-accent/40 hover:text-ink` so hovering it warms toward accent rather than going neutral.

### 3.6 `DetailPane` title — Fraunces

Wherever the detail title renders, swap `text-h1 font-medium` → `text-h1 font-display-opsz-h2` (or `-h1` depending on size). Confirm the file when implementing — likely `src/components/DetailPane.tsx`.

### 3.7 `globals.css` — additions only

Add to `:root` and `.dark`:

```css
--shadow-card-hover: 0 2px 4px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.06);
```

In `.dark`:

```css
--shadow-card-hover: inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.25);
```

Adjust `--surface` light: `#FFFFFF` → `#FEFCF8`.

Add to `@layer utilities`:

```css
.shadow-card-hover { box-shadow: var(--shadow-card-hover); }
```

No new keyframes. The existing `pop-in`, `slide-up`, `breathe`, `shimmer` cover what we need.

---

## 4. Micro-interactions

Don't add new ones. Audit existing usage:

- **Save button "Saved ✓"**: already pulses (`animate-pulse-success` exists in CSS). Confirm it fires on the transition from unsaved → saved. If not wired, add `animate-pulse-success` to the saved-state className for one cycle.
- **Result row appearance**: when SSE streams in `results`, the cards currently appear without animation. Add `animate-fade-in` to each `ResultRow` (existing keyframe). Stagger with inline `style={{ animationDelay: \`${idx * 30}ms\` }}` for the first 8 rows. Caps the total stagger under 240ms — present, not theatrical.
- **Hero on home**: wrap in `animate-fade-in` on initial mount so it eases in rather than pops.
- **`prefers-reduced-motion`**: already handled by the media query in `globals.css`. Stagger delays still apply but durations collapse to 0.01ms — fine.

---

## 5. Dark mode

Quick pass through all changes:

- `--surface` light tweak doesn't affect dark.
- `--shadow-card-hover` defined for both modes (see §3.7).
- `bg-accent-soft/60` selected-row tint — `accent-soft` in dark is `#3A2A1C`, a deep warm brown. At 60% opacity over the row, it reads as "warmly tinted" not "highlighted blue." Verify visually; if too muddy, drop to `/40`.
- ScoreChip 85%+ tier in dark: `bg-accent-soft text-accent-dark` — accent-dark in dark mode is `#E07A3A` (light apricot), accent-soft is deep brown. Contrast holds. Verify.

If anything reads off in dark mode during implementation, the fallback is to keep dark on the current tokens and only ship the light-mode warmth uplift — but I expect the dark palette to translate cleanly because all the changes lean on existing tokens.

---

## 6. Phased rollout — 4 commits, ~6h total

### Commit 1 — Tokens & primitives (~45min)

- `globals.css`: add `--shadow-card-hover` (both modes), `.shadow-card-hover` utility, adjust `--surface` to `#FEFCF8`.
- Verify nothing regresses; cards should look ~identical, just a hair warmer.

**Visual diff**: barely perceptible. This is the foundation.

### Commit 2 — Cards & ScoreChip (~1.5h)

- `ResultRow.tsx`: radius bump, hover lift, gradient selected state, drop the invisible spacer for `min-h`.
- `ScoreChip.tsx`: retune 85%+ tier with `accent-soft` bg and accent dot.
- Smoke-test with a search that returns mixed scores (some ≥85, some 65–84, some <40).

**Visual diff**: noticeable. Cards feel more "product."

### Commit 3 — Hero, type, header (~2h)

- `page.tsx`: add hero block, gated on no-results state.
- `AppHeader.tsx`: blur/opacity bump, brand-mark ring, sign-in hover warmth.
- `DetailPane.tsx`: detail title to Fraunces.
- Verify hero unmounts cleanly when results arrive (no flash, no layout jump).

**Visual diff**: largest single jump. Home page now has a "moment."

### Commit 4 — Motion polish (~1h)

- `SearchBox.tsx`: submit button refinements, focus-shadow on ask bar, loading shimmer warmth.
- Stagger fade-in on `ResultsList.tsx` row mount.
- Save button pulse on success transition.
- Cross-browser sanity (Safari backdrop-blur quirks, Firefox stagger).

**Visual diff**: subtle. This is the polish layer that makes it feel *finished*.

Budget: ~5.25h coding + ~45min visual QA = ~6h.

---

## 7. Verification checklist

Per commit:

- [ ] Light mode hero → search → results flow looks intentional
- [ ] Dark mode same flow, no muddy tints or contrast failures
- [ ] `prefers-reduced-motion` respected (no transforms during reduction)
- [ ] Mobile (≤767px): hero block doesn't crowd, ask bar still hits comfortably, cards stack
- [ ] Keyboard nav: tab order unchanged, focus rings still visible, ⌘K still works
- [ ] No new lint warnings, no Tailwind class typos (Tailwind v4 is strict)
- [ ] Build passes (`pnpm build` / `npm run build`)
- [ ] No measurable LCP regression on home (hero is just type + a sentence, should be cheap)

Manual eyeball check on the reference vibe: open the app side-by-side with Notion / Cron / Arc Search. Does it now belong in that family, or does it still read as one tier below? If still one tier below, the most likely culprit is spacing — the hero needs more vertical room. Don't add more shadows or color; add air.

---

## 8. What we are explicitly NOT doing

- **No icon system swap.** Lucide stays.
- **No new fonts.** Fraunces + Geist is the system.
- **No motion library.** No Framer Motion, no react-spring. CSS keyframes cover everything.
- **No design tokens refactor.** The token system is fine — we're just using more of what's there.
- **No empty-state illustrations.** Type + spacing carries the empty state. Illustrations age fast.
- **No theme presets / customization.** One light, one dark. That's the product.
- **No skeleton screens.** Shimmer on the ask bar + breathe on the pulse dot is enough loading affordance for the scale we're at.
- **No marketing-page polish.** This is the app. No landing page, no testimonials section.

---

## 9. Open questions

None blocking. Two optional:

- **Do we want the hero subtitle line at all?** ("Describe what you want in plain English. We'll do the searching.") — keeping it because pure-display heroes read as marketing-page; the subtitle anchors it as a tool. But it's the easiest line to cut if it feels redundant once on screen.
- **Should the selected-row gradient tint reverse in RTL?** Defer until RTL is a stated requirement.
