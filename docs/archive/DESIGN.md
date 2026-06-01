# OpenRoleKB — UI/UX Design Spec

## Context

The current UI works end-to-end but is a single-column form on a slate background with the default Geist sans. It looks like a Next.js starter that grew a search box. This doc upgrades it to a **playful-soft, two-pane reading experience** with system + manual theme, and keeps the AI score subtle so results read like a friendly job board rather than an ML demo.

Audience: people who type a sentence about the job they want and expect to *read* postings, not navigate a dashboard.

Decisions already taken (see Q&A above):
- Aesthetic: **playful / soft** — rounded shapes, warm accents, friendly copy
- Layout: **two-pane** (list left, detail right) on desktop; single column on mobile
- Theme: **system + manual toggle**
- Score: **subtle chip + tooltip**

---

## 1. Design language

### 1.1 Voice
Friendly, second-person, low-jargon. Avoid corporate verbs ("leverage", "utilize"). Examples:

| Bad | Good |
|---|---|
| "Search executed successfully" | "Found 18 roles" |
| "No results match your query" | "Nothing matched. Try loosening a constraint?" |
| "Filter pills" (internal term) | "We heard:" |
| "Reranking…" | "Sorting by fit…" |

### 1.2 Color

Soft, warm palette. Single accent (apricot) instead of cobalt blue — friendlier, more memorable, fewer dark-pattern associations.

```css
/* Light */
--bg:        #FBF8F4   /* warm off-white, not pure */
--surface:   #FFFFFF
--surface-2: #F4EFE7   /* card hover, pill bg */
--ink:       #1F1A14   /* deep brown-black */
--ink-soft:  #5C5346
--border:    #E8DFD0
--accent:    #E07A3A   /* apricot — used sparingly */
--accent-soft: #FBE7D5
--success:   #5A9E6F   /* sage, not emerald */
--danger:    #C9554A

/* Dark */
--bg:        #14110D
--surface:   #1B1814
--surface-2: #25201A
--ink:       #F2EBDC
--ink-soft:  #A89E8A
--border:    #2E2820
--accent:    #F49A5C   /* lifted for contrast on dark */
--accent-soft: #3A2A1C
--success:   #7CB890
--danger:    #E07A6E
```

The accent is **not** used for body links — only for: the brand mark, primary CTA, focus rings, score chip backgrounds at the highest tier, and the active state in the result list. Body links use `--ink` underlined.

### 1.3 Type

Three faces:

- **Display / headings**: `Fraunces` (Google Fonts, variable) — humanist serif with soft optical sizing. Slightly playful, still serious.
- **Body / UI**: keep `Geist Sans` — readable at small sizes, already loaded.
- **Mono**: keep `Geist Mono` — only used in the parsed-filters debug panel.

Scale (rem):
```
display  : 2.5    weight 500  Fraunces, optical=72
h1       : 1.625  weight 500  Fraunces, optical=36
h2       : 1.25   weight 500  Geist Sans semibold
body     : 1      weight 400  Geist Sans
small    : 0.875  weight 400  Geist Sans
micro    : 0.75   weight 500  Geist Sans medium  (chips, captions)
```

Line height: 1.55 for body, 1.2 for headings. No max line length cap on titles, 70ch on description prose.

### 1.4 Shape & motion

- Border radius scale: `4px, 8px, 12px, 16px, 999px`. Default for cards is **12px**; inputs and buttons are **999px** (pill). The pill input is the single biggest aesthetic move — it signals "ask me a question" instead of "fill in a form".
- Shadow: one soft elevation, `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)`. No layered shadows. In dark mode, use a 1px inner highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)`) instead of a drop shadow.
- Motion: 180ms `cubic-bezier(0.2, 0.8, 0.2, 1)` for all UI transitions. Respect `prefers-reduced-motion` (drop to 0ms).

### 1.5 Spacing

8-point grid. Card internal padding: 20px desktop, 16px mobile. Vertical rhythm between sections: 32px.

---

## 2. Layout

### 2.1 Page structure (desktop, ≥1024px)

```
┌───────────────────────────────────────────────────────────────┐
│  HEADER  (sticky, 64px)                                       │
│  ○ OpenRoleKB    [theme toggle] [about]                       │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────── ASK BAR (centered, max-w-3xl) ───────────┐  │
│  │  🔎  "senior react role, remote-friendly, EU…"      [↵] │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  We heard:  [ role: react ] [ senior ] [ remote ] [ EU ]      │
│                                          [ Save this search ] │
│                                                               │
│  ┌───────────────────────┬─────────────────────────────────┐  │
│  │  RESULTS LIST         │  DETAIL PANE                    │  │
│  │  (max-w-md, scroll)   │  (flex-1, scroll)               │  │
│  │                       │                                 │  │
│  │  ┌─ ResultRow ──┐     │   Senior React Engineer         │  │
│  │  │ Title        │     │   Acme Robotics · Berlin/Remote │  │
│  │  │ Company·Loc  │  86%│   ─────────────────             │  │
│  │  │ Fit one-line │     │   [Apply on Greenhouse ↗]       │  │
│  │  └──────────────┘     │                                 │  │
│  │  ┌─ ResultRow ──┐ 78% │   ## About the role             │  │
│  │  │ …            │     │   Acme Robotics is a Series B…  │  │
│  │  │              │     │   …                             │  │
│  │  └──────────────┘     │                                 │  │
│  │  ┌─ ResultRow ──┐ 71% │   ## What we look for           │  │
│  │  │ …            │     │   • 5+ years React…             │  │
│  │  └──────────────┘     │                                 │  │
│  └───────────────────────┴─────────────────────────────────┘  │
│                                                               │
│  Recent searches (sidebar collapsed by default)               │
└───────────────────────────────────────────────────────────────┘
```

Widths:
- Header content max: `max-w-6xl`
- Ask bar: `max-w-3xl`
- List column: fixed `380px` on `≥1024px`, fluid below
- Detail pane: fills remaining width, internally capped at `prose-lg` (~70ch) for the description body

### 2.2 Mobile (`<768px`)

Single column. Tapping a result opens a full-screen detail sheet that slides up; a back chevron returns to the list. The list and detail are mutually exclusive — no two-pane shrink. Use `<dialog>` with view-transitions when supported.

### 2.3 Tablet (`768–1023px`)

Single column with the result detail rendered inline expanded under the row (accordion). Cheaper than reworking the two-pane and avoids cramped panes.

---

## 3. Components

### 3.1 Ask bar

The hero element. Replaces the current cramped input + side button.

```
┌─────────────────────────────────────────────────────────────┐
│ 🔎  Tell us what you're looking for…                    ⏎  │
└─────────────────────────────────────────────────────────────┘
   ↑ 56px tall, fully rounded, 1.5px border, accent focus ring
```

Behavior:
- Placeholder rotates through 4 examples (5s each, paused on focus):
  - "senior react role, remote-friendly, EU timezone, no crypto"
  - "junior frontend in berlin, posted this month"
  - "staff python engineer with ML experience, sf"
  - "first product manager, fintech, remote US"
- Submit via Enter, the ↩ button, or `⌘K` from anywhere on the page (focuses the input).
- While loading: the right edge shows a thin shimmer band sliding L→R; the button shows a soft spinner. The input stays editable so a user can retype mid-search.
- Empty submit (`""`) does nothing — no error.

### 3.2 "We heard:" row

Replaces the current "Filter pills" block. The label `We heard:` (sentence case, gray) makes the AI parse explicit and friendly — and forgiveness-friendly when it's wrong.

```
We heard:  [ react ✕ ]  [ senior ]  [ remote ]  [ EU ]
                          ┊
                          └ Each pill has a × to remove → triggers re-search
                            with that filter dropped
```

Each pill:
- Rounded full, `--surface-2` background, `--ink-soft` text, micro size.
- Hover reveals a `×` to drop the filter. Dropping a filter immediately re-runs the search.
- The accent-soft background variant is used only for the active "Save this search" affordance.

Edge case: zero pills extracted → show `We heard you, searching…` for 600ms then fade to nothing. Avoids the awkward empty row.

### 3.3 Result row (list)

```
┌──────────────────────────────────────────────┐
│ Senior React Engineer                    86% │   ← title (truncate)  · score chip right
│ Acme Robotics · Berlin / Remote              │   ← company · location (--ink-soft)
│ ── Hits your remote + senior + react asks    │   ← fit line, italic, --success color
└──────────────────────────────────────────────┘
   selected state: --surface-2 bg + 3px left accent border
   hover state:    --surface-2 bg at 60% opacity
   focus state:    2px accent ring inset
```

Notes:
- Single line per field; long company names truncate with ellipsis.
- The fit line is the LLM's `oneLineFit` — clip at 80 chars (rerank prompt already enforces).
- Score chip uses a tier system rather than a literal % gradient — feels less clinical:
  - ≥0.85 → `--accent-soft` bg, `--accent` text → "86%"
  - 0.65–0.84 → `--surface-2` bg, `--ink` text → "78%"
  - 0.4–0.64 → `--surface-2` bg, `--ink-soft` text → "52%"
  - <0.4 → not shown (filtered out)
- Tooltip on hover (300ms delay) shows the full fit reason if it was clipped.
- Keyboard: `↑`/`↓` move selection, `Enter` opens the source URL in a new tab, `Space` previews in the detail pane without leaving.

### 3.4 Detail pane

When nothing is selected: empty state with a soft illustration (a coffee mug + paper, see §6) and the line *"Pick a role to read it here."*

When a result is selected:
- **Header block** (sticky inside the pane):
  - Title in Fraunces, 1.625rem
  - Company · location · "Posted 4 days ago" (relative dates)
  - Primary CTA: rounded pill button `Apply on greenhouse.io ↗` (accent bg, white text). Opens `target=_blank`, `rel=noopener noreferrer`.
  - Secondary actions: `[ Save ⭐ ]` `[ Copy link ]` `[ Hide this company ]` — text-style buttons.
- **Score band** (one line, below header): "Matches your senior + remote ask • 86% fit" — replaces the chip with prose.
- **Body**: the Exa `text` content rendered as `prose-lg`. Headings autodetected (`## What we look for`, etc.) if Exa returns them; otherwise display as plain paragraphs.
- **Footer**: small "Source: job-boards.greenhouse.io" and a "Tell us this match was off →" link that opens a 1-question thumbs-down feedback form (out of scope for v1 UI but design accommodates it).

### 3.5 Save / saved-searches

Current "Save search" button is fine; tweak copy.

- Button: pill, ghost style (`border: 1px solid --border`, no fill until hover). Copy: `Save this search`. After save: `Saved ✓` with a check; disabled.
- Saved-searches list: **collapse into a horizontal scroller below the ask bar** rather than a vertical sidebar. Each entry is a pill with the raw query truncated to ~28 chars and a × to delete. Clicking re-runs.
  - This makes saved searches feel like *tabs you can switch between* rather than a buried sidebar nobody scrolls to.

```
Recent:  [ senior react remote EU ✕ ]  [ junior frontend berlin ✕ ]  [ + ]
```

The `+` is shown only when there's a current search not yet saved — clicking it saves.

### 3.6 Loading & empty states

Loading (during a fresh search):
- Ask bar shows the shimmer.
- Where the list will be: 5 skeleton rows (rounded, 76px tall each, gentle gradient pulse 1.2s).
- "We heard:" row reveals as soon as `event: parsed` arrives (typically 400ms in).
- When `event: results` arrives, skeletons swap for real rows. Score chips on each row show a small dot pulse until `event: rerank` lands, then fade in the %.
- Detail pane is empty during loading.

Empty (zero results returned):
- Friendly mascot illustration + headline `Nothing matched.`
- Body: `Try dropping a filter, broadening location, or rephrasing.`
- Buttons: each parsed filter rendered as a "Try without [filter]" suggestion that re-runs.

Error:
- Inline banner above the list, `--danger` border-left, `--surface` bg. Copy: short + actionable. Example: `Couldn't reach the search service. Try again?` with a Retry button.

### 3.7 Theme toggle

Header right side, 32px round button. Three states cycle:
- System (icon: half-moon over sun)
- Light (sun)
- Dark (moon)

Stored in `localStorage` (`openrolekb_theme = "system" | "light" | "dark"`). On first paint, an inline script (in `<head>`) sets the class before hydration to prevent flash:

```html
<script>
  (function() {
    var t = localStorage.getItem('openrolekb_theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  })();
</script>
```

### 3.8 Header

```
┌──────────────────────────────────────────────────────┐
│  ◐ OpenRoleKB                       [☼] [About]      │
└──────────────────────────────────────────────────────┘
```

- Brand mark: small filled circle in `--accent` + wordmark in Fraunces. No tagline (move tagline to the empty hero state on first load).
- Header is sticky on scroll with `backdrop-blur` over a 90% bg overlay — keeps the ask bar reachable as the list scrolls.

---

## 4. Information architecture & flow

### 4.1 First-visit flow
1. User lands on `/` → sees header, ask bar prefilled with a rotating placeholder, and below it a quiet line: *"Search live job postings in plain English."*
2. No skeletons, no results below — just empty space (or an example queries strip, see §4.2).
3. They type, hit Enter → `parsed` event paints "We heard:" → `results` paints skeletons → reranked list fades in.
4. They click a row → detail pane fills.
5. They hit `Save this search` → button flips to `Saved ✓`, the query appears in the "Recent:" strip.

### 4.2 Example queries strip (first-visit only)
Below the empty-state hint, four pill-shaped example queries:
```
Try:  [ "senior react, remote EU" ]  [ "junior PM, fintech NYC" ]  [ "data eng with dbt" ]  [ "Rust backend, anywhere" ]
```
Clicking fires `runSearch(text)`. Dismissible — once the user runs *any* search this session, hide forever (`sessionStorage` flag).

### 4.3 URL state
- `/` — empty home
- `/?q=…` — search prefills + auto-runs (shareable links)
- `/search/[id]` — permalink to a cached result list (already implemented). On this page, the ask bar is prefilled with the cached `rawQuery` so editing+re-running stays in place.

---

## 5. Accessibility

- All interactive elements reachable via keyboard. `:focus-visible` rings in `--accent` at 2px offset.
- Result list: `role="listbox"`, rows `role="option"` with `aria-selected`. `aria-live="polite"` on the count line so SR users hear "18 results".
- Score chip has `aria-label="86 percent match"`.
- Color contrast: every text + bg pair meets WCAG AA at body size, AAA for headings. Score chip tiers tested against both light and dark surfaces.
- Reduced motion: shimmer, pulse, accordion slides all reduce to instant.
- All icons that carry meaning have `aria-label`; decorative ones get `aria-hidden`.

---

## 6. Illustrations & icons

One-time investment, sets the playful tone.

- **Mascot**: a single line-art mug-and-paper drawing (~120×120) used for empty states and the 404. Hand-drawn-feel SVG with `stroke="currentColor"` so it adapts to theme. Estimated 1h to sketch in Excalidraw + clean up in Figma; can be commissioned but a placeholder works for v1.
- **Icons**: use [Lucide](https://lucide.dev) — already plays nicely with Tailwind, stroke width 1.5 fits the soft tone. Specific icons used: `Search`, `Sun`, `Moon`, `SunMoon`, `Star`, `Link`, `EyeOff`, `ExternalLink`, `X`, `Plus`, `ChevronDown`, `ChevronLeft`.

---

## 7. Implementation map

What changes where, ordered by impact-per-effort.

### 7.1 Foundation (do first — unlocks everything else)
| File | Change |
|---|---|
| `src/app/globals.css` | Define the CSS vars from §1.2 under `:root` and `.dark`. Switch the body bg/text to use them. Add `@font-face` import for Fraunces (`next/font/google`). Add the no-flash theme script comment pointing at where it should live. |
| `src/app/layout.tsx` | Inject the inline no-flash script in `<head>` before children. Load Fraunces alongside Geist. Replace the cobalt brand color with `--accent`. Add theme-toggle button (new component). |
| `src/components/ThemeToggle.tsx` | New. 3-state cycle, persists to localStorage, dispatches `theme-change` event so other tabs sync via `storage` listener. |
| `tailwind.config` (if not already) | Wire the CSS vars as Tailwind colors so `bg-surface`, `text-ink`, `border-border`, etc. work. With Tailwind v4 this is `@theme` in CSS — same file as globals. |

### 7.2 Ask bar redesign
| File | Change |
|---|---|
| `src/components/SearchBox.tsx` | Restyle the existing `<form>`: pill input, leading `Search` icon, integrated submit button on the right. Add the rotating placeholder via a small useEffect timer. Wire `⌘K` global focus shortcut. |
| `src/components/SearchBox.tsx` | Replace the current "FilterPills" with the new "We heard:" component; add `×` to drop a filter → call `runSearch` with the modified filter set. |

### 7.3 Results layout
| File | Change |
|---|---|
| `src/app/page.tsx` | Convert to a 3-row grid: header info / ask area / results. Wrap results in a 2-column flex (md+) with `<ResultsList>` and `<DetailPane>`. Below md, show only the list (selection navigates to detail full-screen). |
| `src/components/ResultsList.tsx` | New. Owns the selected-index state, keyboard nav (↑/↓/Enter/Space), and renders `<ResultRow>`s. Maintains `selectedUrl` (not index) so it survives rerank reordering. |
| `src/components/ResultRow.tsx` | New. Replaces the current `JobCard`. Compact row layout (title / company·location / fit line) + score chip. |
| `src/components/DetailPane.tsx` | New. Sticky header, score band, prose body, footer. Empty state with the mascot. |
| `src/components/ScoreChip.tsx` | New. Tiered styling per §3.3. Accepts `score?: number` and renders nothing if undefined or <0.4. |
| `src/components/SearchBox.tsx` | Stop rendering `JobCard`s — list rendering moves to `ResultsList`. Lift `state.exaResults / state.reranked / state.filters` up to `page.tsx` (or a context) so the detail pane can read them. |

### 7.4 Saved searches as tabs
| File | Change |
|---|---|
| `src/components/SavedSearches.tsx` | Rewrite as a horizontal scroller (`overflow-x-auto`, no-scrollbar). Each entry is a pill button (existing dispatch of `openrolekb:rerun-search` already works). Drop the `<aside>` heading. Add a `+` pill that, when the current search isn't saved yet, calls the save endpoint and updates state. |
| `src/app/page.tsx` | Position the saved-search strip immediately under the "We heard:" row. |

### 7.5 Loading states
| File | Change |
|---|---|
| `src/components/Skeleton.tsx` | New. Reusable shimmer block; respects reduced-motion. |
| `src/components/ResultsList.tsx` | When `state.phase === "loading"` and `exaResults.length === 0`, render 5 skeletons. When results land but rerank hasn't, show a pulsing dot where the score chip will be. |

### 7.6 Mobile detail sheet
| File | Change |
|---|---|
| `src/components/DetailSheet.tsx` | New. On `<768px`, selecting a result opens a `<dialog>` sheet with slide-up animation + close on backdrop tap and ESC. Reuses `<DetailPane>` content. |

### 7.7 Polish
- Replace `Geist` brand color in `layout.tsx` with `Fraunces` for the wordmark.
- Add `next/image`-loaded mascot SVG (`public/mascot.svg`) used in three empty states (home, no-results, 404).
- 404 page (`src/app/not-found.tsx`): mascot + "We couldn't find that page" + back-to-home link.
- `prefers-reduced-motion` media query handled once in `globals.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```

---

## 8. Out of scope (deliberately)

- **Filter sidebar / advanced filters UI** — the whole point is plain English. Don't add a price slider.
- **Apply tracking, account, comments** — UI accommodates a Save and Hide gesture but no DB beyond what's already planned.
- **In-app job description rendering** for paywalled sources — link out, don't scrape further.
- **Multi-language UI** — copy is English-only; plan for i18n later via locale folders, not now.
- **Custom dark-mode-only illustrations** — single line-art mascot adapts via `currentColor`.

---

## 9. Verification

Once implemented, the experience should pass:

1. **3-second test** (show home page to someone who's never seen it): they can tell within 3s that it's a job search and that it accepts plain English.
2. **Mom test** (give a non-technical user the URL): they successfully run one search end-to-end without instruction.
3. **Keyboard-only test**: complete a search → navigate to a result → open it in a new tab, all without touching the mouse.
4. **Reader-mode equivalence**: the detail pane body looks comparable to the article in browser reader mode for at least 3 randomly-chosen job postings.
5. **Theme flash**: hard refresh in dark mode, no white flash before paint.
6. **Lighthouse**: ≥95 accessibility, ≥95 best-practices on the home and a populated `/?q=…` URL.

---

## 10. Suggested build order

Bite-sized, each shippable independently:

1. **CSS vars + Fraunces + theme toggle** (no layout changes) — ~1h. Immediate visual lift.
2. **Ask bar restyle + rotating placeholder + ⌘K** — ~1h. Sets the tone.
3. **"We heard:" row with × to drop filters** — ~1h. Adds a real interaction.
4. **Two-pane layout + ScoreChip tiers + ResultRow compaction** — ~3h. Biggest lift; lift state up to `page.tsx` here.
5. **Saved-searches as horizontal strip** — ~1h.
6. **Skeletons + score-pulse + reduced-motion CSS** — ~1h.
7. **Mobile detail sheet** — ~2h.
8. **Mascot SVG + empty / no-results / 404 states** — ~1h once the asset exists.

Total: ~11h of focused work to land everything.
