# Design

TLS Companion is a study workbench, not a landing page. The person using it is
an engineer reading the TLS notes who wants to see a handshake actually run and
read the code that ran it. Sessions are long, mostly on a desktop, sometimes on a
phone to replay a step. The test the design has to pass: from any byte on the
wire, reach the line of Go that wrote it and the RFC section that defines it in
two clicks, and get back without losing your place.

## Objects and navigation

The objects are scenarios (one recorded connection), steps (a narrated slice of
its event log), records and messages (what crossed the wire), fields (byte
ranges inside a message), symbols (Go declarations), secrets (key schedule
nodes), notes sections, RFC sections, and history entries.

Top-level areas are peers in a persistent bar: Handshake, Code, Notes,
History, RFCs. Search (`/` or `Ctrl K`)
spans all of them. Every view is a hash route, so refresh, share, and the
browser's back button all work. Code navigation pushes history entries, step
changes replace the current one.

One selection model drives the workbench. Choosing a step moves the playhead to
its first event, selects its message, and opens its code. Choosing a field opens
the line that marshals it. Choosing a call in the trace moves the playhead and
opens the callee. Scrubbing moves everything at once.

## Visual system

Chassis: a dense instrument-panel layout (panels separated by 1px rules, compact
rows, tabular mono numbers). Evidence: the real bytes, code, secrets, and RFC
text are the content; nothing is a mockup. Accent: the wire.

Signature element: records are drawn to byte scale and colored by the secret
that protects them, using the same colors in the sequence diagram, hex dump,
key schedule, and code annotations, and the RFC 8446 notation (`{}` handshake
keys, `[]` application keys) in every label so color never carries meaning
alone. An MTU line shows when a post-quantum ClientHello no longer fits in one
packet.

Tokens live in `src/styles/tokens.css` and are the only source of color, type,
spacing, and motion values.

| Role | Light | Dark |
| --- | --- | --- |
| paper | `oklch(.985 .003 240)` | `oklch(.17 .01 255)` |
| panel | `oklch(.972 .005 240)` | `oklch(.195 .012 255)` |
| line | `oklch(.905 .008 240)` | `oklch(.29 .012 255)` |
| ink | `oklch(.24 .02 255)` | `oklch(.93 .008 255)` |
| muted (secondary text) | `oklch(.48 .015 255)` | `oklch(.72 .012 255)` |
| faint (offsets, counts, line numbers) | `oklch(.53 .012 255)` | `oklch(.62 .012 255)` |
| accent (selection, focus, playhead) | `oklch(.50 .17 258)` | `oklch(.72 .13 258)` |
| plaintext epoch | `oklch(.53 .01 250)` | `oklch(.68 .01 250)` |
| early-data epoch | `oklch(.55 .13 70)` | `oklch(.78 .12 70)` |
| handshake epoch | `oklch(.53 .17 350)` | `oklch(.74 .12 350)` |
| application epoch | `oklch(.50 .13 155)` | `oklch(.74 .11 155)` |

Every text token, the epoch colors included because packet labels use them,
holds 4.5:1 against paper, panel, and well in both themes. Faint is therefore
only a little lighter than muted; size and weight carry the rest of the
hierarchy.

Type: the system sans stack (PingFang SC on Apple, Microsoft YaHei on Windows)
carries UI and prose because it sets Chinese and Latin together correctly.
JetBrains Mono carries code, bytes, numbers, and kickers, and is the identity
face. Noto Serif SC is the display face, used only for page and note headings.

Layout at 1440: step rail (320px) | stage over inspector | code over trace. At
900 to 1279 the rail folds into the transport bar. Below 900 it is one column
with the stage on top and a bottom tab bar for Steps, Packet, Code, Calls, and Keys.

Motion: UI transitions are 140ms ease-out. The stage clock (time in RTT units)
is eased toward its target by an rAF loop at constant speed with a capped
duration, always from the value on screen, so stepping or scrubbing mid-flight
retargets instead of jumping. Dragging the scrubber or a splitter tracks the
pointer 1:1 with pointer capture. With `prefers-reduced-motion`, the clock jumps
and packets appear in place.
