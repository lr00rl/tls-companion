# TLS Companion

TLS 学习工作台：逐步回放真实的 TLS 握手，同步查看线路字节、密钥调度、Go crypto/tls 源码与调用追踪、RFC 原文和笔记。

**Site:** https://lr00rl.github.io/tls-companion/

TLS Companion is a study workbench for TLS and HTTPS. Every handshake in it actually ran: a capture program starts Go's `crypto/tls` client and server in one process and records every byte on the wire, every secret the key schedule derived, and every function both endpoints entered. The workbench replays those recordings step by step, and the sequence diagram, the packet inspector, the key schedule, the source code, and the call trace always point at the same instant.

## What is in it

The **workbench** (`#/play`) replays five recorded connections: a TLS 1.3 full handshake with X25519MLKEM768, a HelloRetryRequest, a PSK resumption, a TLS 1.2 ECDHE handshake, and TLS 1.2 RSA key transport. Each step narrates one slice of the event log and opens the code that ran there. Records are drawn to byte scale and colored by the secret that protects them. Picking a field in a message opens the line that marshals it; picking a call in the trace moves the timeline; scrubbing the timeline moves everything.

The **code browser** (`#/code`) shows `crypto/tls` and the packages it leans on (the FIPS 140 TLS 1.3 and 1.2 key schedules, HKDF, HMAC, ML-KEM, HPKE, ECDH, x509, cryptobyte) with semantic highlighting, go-to-definition, references, hover docs, and, for every function, where it ran in the recordings.

The **notes** (`#/notes`) are the TLS series from `content/notes`. Every heading that a workbench step cites links back to that step, and RFC mentions open the RFC text in place.

The **history** (`#/history`) lays protocol versions, attacks, and Go releases side by side. Each entry shows how Go's `crypto/tls` handles it today, with the code, and Go release entries diff the relevant file between two Go tags, fetched live from GitHub.

The **RFC reader** (`#/rfc`) has 40 RFCs as unpaginated text with cross-links, and lists the Go comments that cite each section.

Everything works from the keyboard. `/` or Cmd-K searches steps, Go symbols, files, notes, and RFC sections, and treats `key_share`, `keyShare`, and "key share" as the same query. In the workbench, Left and Right change step, Space plays, and the timeline takes the arrow keys, Shift with an arrow for larger jumps, Home, and End. The field tree and the call trace are each one tab stop that the arrow keys move through. Tabbing into the code puts a cursor on the current line: Up and Down move it, Left and Right pick an identifier, and Enter follows it. Every view is a link, and workbench links count steps from 1, so `#/play/tls13-full/8` opens step 8.

## How the data is made

Everything under `public/data/` is generated, and CI regenerates it on every push.

- `tools/cmd/tlsindex` type-checks the indexed packages from the GOROOT of the Go toolchain running it, with all their dependencies, and writes per-file semantic tokens, definitions, references, call edges, and links from comments to RFC sections.
- `tools/cmd/tlsinstrument` writes a `go build -overlay` that inserts a trace call after the opening brace of every function in `crypto/tls` and the FIPS 140 `tls13`/`tls12` packages (on the same line, so upstream line numbers hold), and wraps HKDF-Extract, Derive-Secret, HKDF-Expand-Label, and the TLS 1.2 PRF so every derived secret is reported.
- `tools/cmd/tlscapture` builds against that overlay and runs the scenarios over an in-memory pipe whose mutex is passed between the endpoints like a baton, so the trace interleaves in causal order. It decrypts every record from the key log with its own HKDF and PRF code and fails if those keys differ from the ones `crypto/tls` derived.
- `scripts/build-notes.mjs` renders the Obsidian notes (wikilinks, mermaid, heading anchors, RFC links); `scripts/build-rfc.mjs` unpaginates the RFC text in `content/rfc`.

Steps in `src/scenarios/` and entries in `src/history/entries.ts` anchor on function names and code text, never on line numbers. `pnpm test` resolves every anchor, symbol, note heading, and RFC section against the generated data, so a Go upgrade that renames a function fails the build and names the step to fix.

## Develop

Requirements: Go 1.26.1 and Node 24 with pnpm.

```sh
pnpm install
pnpm data          # index crypto/tls, record handshakes, build notes and RFCs
pnpm test          # validate scenarios, history, and the dissector against the data
pnpm dev           # http://localhost:5173/tls-companion/
pnpm build         # static site in dist/
```

`pnpm sync:notes` copies the notes from the Obsidian vault into `content/notes` (set `TLS_NOTES_DIR` to point elsewhere). `pnpm fetch:rfc` downloads any RFC added to the list in `scripts/fetch-rfc.mjs`.

To move to a newer Go release, change the version in `.github/workflows/pages.yml` and `tools/go.mod`, run `pnpm data && pnpm test` with that toolchain, and fix whatever steps the test names.

## Layout

```
tools/            Go: indexer, instrumenter, capture program
scripts/          Node: data pipeline, notes and RFC builders
content/notes/    the TLS notes (Markdown, Chinese)
content/rfc/      RFC plain text
src/workbench/    stage, transport, inspector, trace, code panel
src/code/         code viewer, references, symbol resolution
src/capture/      capture model, message and DER dissectors, key schedule
src/scenarios/    step definitions per recorded connection
src/history/      evolution timeline data
src/pages/        home, code browser, notes, history, RFC reader
docs/DESIGN.md    design decisions and tokens
```

## Third-party content

Go source code shown by the site is from the Go project and is distributed under the BSD-style license in the Go repository. RFC text is copyright of the IETF Trust and the authors, reproduced under the IETF Trust's legal provisions. The notes are the author's own writing.
