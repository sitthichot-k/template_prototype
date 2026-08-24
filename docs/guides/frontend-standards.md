# Frontend standards

Rules that apply to every screen in this application, including the ones you
add. They exist because each was, at some point, decided eleven different ways
in eleven files — and the result was a product that looked like eleven
products.

Each section names the single place the rule lives. **Change it there. Never
re-implement it in a view.** A view's scoped styles should describe only what
is genuinely unique to that screen.

| Concern | Lives in |
|---|---|
| Breakpoints | [`assets/styles/tokens.css`](../../frontend-vue/src/assets/styles/tokens.css) |
| Responsive baseline | [`assets/styles/base.css`](../../frontend-vue/src/assets/styles/base.css) |
| Media queries in JS | [`composables/useMediaQuery.js`](../../frontend-vue/src/composables/useMediaQuery.js) |
| Page header | `.page-header` in `base.css` |
| Buttons | `.btn` in `base.css` |
| Form fields, required marker | [`components/common/FormField.vue`](../../frontend-vue/src/components/common/FormField.vue) |
| Required validation | [`composables/useRequiredFields.js`](../../frontend-vue/src/composables/useRequiredFields.js) |
| Modals | [`components/common/ModalDialog.vue`](../../frontend-vue/src/components/common/ModalDialog.vue) |
| Lists and tables | [`components/dynamic/DataTable.vue`](../../frontend-vue/src/components/dynamic/DataTable.vue) |

---

## 1. Responsive is not optional

**Every element, on every screen, at every width.** A feature is not finished
until it works on a phone. This is not a polish pass to be scheduled later —
retrofitting responsiveness costs several times what building it in does,
because by then the layout has hard-coded widths baked through it.

### The breakpoints

Four, declared once in `tokens.css`:

| Token | Width | Meaning |
|---|---|---|
| `--bp-sm` | `40rem` / 640px | Phone |
| `--bp-md` | `48rem` / 768px | Large phone, small tablet — **the drawer boundary** |
| `--bp-lg` | `64rem` / 1024px | Tablet, small laptop |
| `--bp-xl` | `80rem` / 1280px | Desktop |

CSS cannot read a custom property inside `@media`, so the literals get repeated
in stylesheets. **Repeat these four values, in `rem`, and nothing else.** A
one-off `@media (max-width: 900px)` is how a layout starts breaking at a width
nothing else in the system knows about.

In JavaScript, never hard-code a width:

```js
import { useIsMobile, useMediaQuery } from '@/composables/useMediaQuery';

const isMobile = useIsMobile();                        // below --bp-md
const isWide   = useMediaQuery('(min-width: 80rem)');  // anything else
```

`useIsMobile()` reads `--bp-md` from the stylesheet, so CSS and JS cannot
disagree about where the layout changes — the bug that produces a desktop
sidebar next to a mobile header.

### What you already get

Do **not** re-solve these. They are in the responsive baseline at the bottom of
`base.css`:

- **The page never scrolls sideways.** `html, body { overflow-x: hidden }`, and
  every grid column carries `min-width: 0`.
- **Wide tables scroll inside themselves.** Wrap in `.table-scroll`; `DataTable`
  already does. The table keeps its natural column widths — squeezing ten
  columns into 360px makes them unreadable, not responsive.
- **Long strings wrap.** `.page { overflow-wrap: anywhere }` handles emails,
  URLs and permission paths.
- **Images never overflow.** `img, svg, video, canvas { max-width: 100% }`.
- **Page headers reflow.** Title shrinks, actions drop to full width below it.
- **Dialogs go full-screen below `--bp-md`**, and their footer buttons stack.
- **Field pairs stack.** `.form-row` collapses to one column.
- **Touch targets grow** under `@media (pointer: coarse)` — 44px minimum, which
  is the accessibility floor. Coarseness is the right test, not width: a tablet
  is wide and still touched.
- **The sidebar becomes a drawer** below `--bp-md`, with a backdrop, closing
  itself on navigation.

### What you are responsible for

- **Prefer intrinsic layout over media queries.** `grid-template-columns:
  repeat(auto-fit, minmax(12rem, 1fr))` adapts at every width, with no
  breakpoint to maintain. Reach for `@media` only when the content genuinely
  reorders.
- **Never set a fixed `width` or `height` on a container.** Use `max-width`,
  `min()`, or a grid track.
- **Test at 360px.** If it works there and at 1920px, the middle takes care of
  itself. Chrome DevTools device toolbar, "Responsive", 360 × 740.
- **Check the dark theme at the same time.** Both are one toggle away.

### Reviewing a change

A change that touches the UI is not ready until:

- [ ] 360px wide: nothing is clipped, nothing scrolls sideways, every control
      is reachable
- [ ] 768px: the drawer opens, closes on navigation, and the backdrop dismisses
- [ ] 1920px: content does not stretch into unreadable line lengths
- [ ] Keyboard only: every action reachable, focus always visible
- [ ] Both themes

---

## 2. Required fields

One component marks them, one composable validates them.

### Marking

`FormField` draws the red asterisk. Never type one into a view — the day the
marker changes (a tooltip, an "(optional)" suffix instead, a different colour)
is the day someone has to find them all.

```vue
<FormField label="Display name" required>
  <input v-model="form.displayName" class="form-field__control" maxlength="150" />
</FormField>
```

The control is a slot, not a prop, because the set of controls is open — text,
select, textarea, checkbox, a JSON editor. The field only cares whether what it
wraps has a value.

Other props: `help`, `error` (takes precedence over `help`), `inline` (for a
single checkbox).

### Validating

The form owner installs the context and calls `validate()` first in its submit
handler:

```js
import { provideRequiredFields } from '@/composables/useRequiredFields';

const { validate, clear } = provideRequiredFields();

async function save() {
  if (!validate()) return;
  …
}
```

`validate()` checks every registered field, marks **all** the blank ones —
reporting one gap per submit turns a three-field form into three round trips —
then focuses and scrolls to the first. The mark clears as soon as the field is
filled. `clear()` drops every mark, for reopening a dialog on a fresh record.

Fields register themselves, and unregister on unmount: a `v-if` field left
registered would block submission from behind a branch that is not on screen,
which is the hardest kind of failure to diagnose.

### Where the line sits

**`validate()` owns emptiness. Everything else is the form's own.**

```js
// Format problems only — not "is it filled in".
const canSave = computed(() => !usernameError.value && !passwordError.value);
```

Do not disable the submit button because a required field is blank. A greyed-out
button explains nothing; a message on the field says exactly which one is
missing.

### Relationship to the server

Client validation never authorises anything. The API validates every request
independently, and mirrored rules — the password policy in
`modules/access-control/password-policy.js` is the example — exist only to turn
a round trip into instant feedback. When a rule is duplicated, say so in a
comment on both sides and test the mirror.

---

## 3. Structure

### Page header

Every screen opens the same way:

```vue
<header class="page-header">
  <div>
    <h1 class="page-header__title">Users</h1>
    <p class="page-header__meta">optional one-liner</p>
    <p class="page-header__description">optional longer explanation</p>
  </div>
  <div class="page-header__actions">
    <button class="btn btn--primary">New user</button>
  </div>
</header>
```

A single action can be a bare `.btn` child — it is pushed right either way. If
you have only a title, `<h1>` alone is fine; otherwise wrap the text block in a
`<div>`, or the flex row will lay title and description side by side.

**No screen gets a distinct header because it is important.** A screen earns one
by being a different kind of thing, and none currently is.

### Buttons

| Context | Class |
|---|---|
| Page or dialog main action | `.btn .btn--primary` |
| Anything secondary | `.btn .btn--ghost` |
| Destructive, as the decision being confirmed | `.btn .btn--danger` |
| Inside a table row | add `.btn--sm` |
| Destructive in a table row | `.btn .btn--danger-ghost .btn--sm` |

Visual weight tracks how much an action is *recommended*, not how dramatic it
is. That is why a column of Delete buttons is `--danger-ghost`: repeating the
loudest style down a table advertises the action nobody should take by accident.

### Tables

Use `DataTable`. It speaks the backend's list-query contract, so paging,
sorting and search come for free, and it handles the actions column and
horizontal scrolling. Row actions go in the `#row-actions` slot wrapped in
`.row-actions`.

Cells do not break mid-word by default (`.table th, .table td` set
`overflow-wrap: normal`) — a column's floor is its longest word, never
narrower. Only a cell that genuinely holds a long unbreakable token (a user
agent, a URL) should break mid-word; give it `class="is-wrappable"` instead of
adding a one-off `word-break` rule in the view's own `<style>`.

### Dialogs

Use `ModalDialog`. It wraps the native `<dialog>` element, so focus trapping,
focus restoration, Esc, page inertness and top-layer stacking are the browser's
job rather than yours — each of which a hand-rolled overlay gets wrong at least
once.

---

## 4. Permissions in the UI

`v-can` hides what the viewer cannot do:

```vue
<button v-can="'/security/users:create'" class="btn btn--primary">New user</button>
```

**This is presentation only.** The API enforces the same rule on every request.
Never treat a hidden button as a security control, and say so in review — it is
the assumption that quietly becomes load-bearing.

Guard against an action the API rejects rather than one the UI merely hides: if
a permission does not exist in the module manifest, `v-can` hides the button
forever and nobody notices. Check the manifest declares the action.

---

## 5. Adding a screen

Most of the time you do not need to. Menu entries, permissions, settings and
navigation all come from `/platform/bootstrap`, so a new backend module appears
in the UI with no frontend change at all. See
[module-authoring.md](module-authoring.md).

When the generic screens are not enough, add a route with a `permission` meta
and a view under `src/modules/<module>/views/`, then work through §1's review
checklist before you call it done.
