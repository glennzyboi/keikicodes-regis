# Keiki Coders brand tokens

*Scraped 4 September 2026 from keikicoders.com. Source of truth: their Squarespace custom
stylesheet at `static1.squarespace.com/static/custom-css/6523a780f28838549671e2dc/.../custom.css`.
These are their real values, not an interpretation.*

## Typefaces

| Role | Family | Weights seen | Availability |
|---|---|---|---|
| Display, headings, numbers, labels | **Fredoka** | 600, 700 | Google Fonts |
| Body, running text | **Poppins** | 500 | Google Fonts |

Fredoka is a rounded geometric sans. It is doing the "children" work in their identity and it is
used for far more than headlines: eyebrows, stat numbers and small labels are all Fredoka.

## Colour

| Token | Hex | Where they use it |
|---|---|---|
| Deep green | `#0f5740` | Headings, large stat numbers, eyebrow text on light |
| Primary green | `#1b7a5a` | The highlight badge behind key words |
| Mid green | `#2c7a5d` | Eyebrow text, stat suffixes, secondary emphasis |
| Base green (rgba source) | `#2e9e74` | Used at 12 to 14 percent as a pale pill background |
| Ink | `#06231c` | Body text. A near-black with green in it, never pure black |
| Muted | `#4a5551` | Labels, secondary text |
| Yellow accent | `#ffcf33` | The pop. Used sparingly |
| Yellow shade | `#e6b800` | Hover or depth on the yellow |
| Surface pale | `#eef3f0` | Section backgrounds |
| Surface neutral | `#f8f9fa` | Card backgrounds |
| Border green | `#cfe3da` | Green-tinted dividers |
| Border neutral | `#ebedee` | Card borders |
| White | `#ffffff` | Cards, the logo chip |

## Shadow

Always green-tinted, never neutral grey:

```
rgba(6,35,28,.04)  rgba(6,35,28,.08)  rgba(6,35,28,.1)
rgba(6,35,28,.15)  rgba(6,35,28,.2)   rgba(6,35,28,.35)
0 10px 20px -8px rgba(27,122,90,.55)   /* on the green badge */
0 15px 35px -5px rgba(6,35,28,.08)     /* card lift */
```

## Radius

Very round. Observed values, in frequency order:

```
999px   pills and eyebrows
50%     circular logo chips
20px 18px 22px 24px 28px 16px   cards and panels
```

## Motion and gesture

- `transition: transform .3s cubic-bezier(.25,.46,.45,.94)` on cards
- `translateY(-5px)` on hover
- The highlight badge sits at `rotate(-2.5deg)`, a deliberate hand-placed tilt
- `scroll-behavior: smooth` set globally

## Typographic feel

- Hero: `clamp(3rem, 7vw, 5.5rem)`, `line-height: .95`, `letter-spacing: .1em`. Very large, very
  tight leading, unusually open tracking.
- Eyebrows: uppercase, `letter-spacing: .04em`, inside a pill with a circular logo chip
- Body: `1.2rem`, `line-height: 1.45`, weight 500. Larger and heavier than a typical body setting.

## Applying it to the app

Glenn chose a **full brand match** rather than a calmer variant. So: Fredoka throughout including
form labels and table headers, their roundness, yellow used with intent rather than sprayed, and
green-tinted shadows everywhere a neutral grey would be the lazy default.

The one place to spend extra care is the payment step, where a playful register can read as less
trustworthy. Solve it with hierarchy and clear affordances, not by muting the brand.
