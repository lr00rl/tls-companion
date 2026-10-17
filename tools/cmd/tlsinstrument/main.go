// Command tlsinstrument writes a go build -overlay that instruments crypto/tls
// and the FIPS 140 TLS key schedules in GOROOT, without touching GOROOT itself.
//
// Every function body gets a trace call inserted right after its opening brace,
// on the same line, so line numbers in the instrumented copy match upstream.
// The TLS 1.3 HKDF primitives and the TLS 1.2 PRF are additionally wrapped so
// the capture tool sees every secret they derive.
//
//	go run ./cmd/tlsinstrument -out ../build/overlay
//	go build -tags tlstrace -overlay ../build/overlay/overlay.json ./cmd/tlscapture
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/lr00rl/tls-companion/tools/internal/symkey"
)

type target struct {
	pkg string
	// wrap renames these declarations to tlscOrig<Name>; the hook file
	// declares replacements under the original names.
	wrap []string
	hook string
}

var targets = []target{
	{pkg: "crypto/tls", hook: tlsHook},
	{pkg: "crypto/internal/fips140/tls13", wrap: []string{"ExpandLabel", "extract", "deriveSecret"}, hook: tls13Hook},
	{pkg: "crypto/internal/fips140/tls12", wrap: []string{"PRF"}, hook: tls12Hook},
}

// skipFiles holds generated code that only adds noise to a trace.
var skipFiles = map[string]bool{"common_string.go": true}

func main() {
	out := flag.String("out", "../build/overlay", "overlay directory")
	flag.Parse()
	log.SetFlags(0)

	goroot := goEnv("GOROOT")
	abs, err := filepath.Abs(*out)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.RemoveAll(abs); err != nil {
		log.Fatal(err)
	}
	replace := map[string]string{}
	funcs := 0
	for _, t := range targets {
		dir := filepath.Join(goroot, "src", t.pkg)
		entries, err := os.ReadDir(dir)
		if err != nil {
			log.Fatal(err)
		}
		dst := filepath.Join(abs, t.pkg)
		if err := os.MkdirAll(dst, 0o755); err != nil {
			log.Fatal(err)
		}
		wrapped := map[string]bool{}
		for _, e := range entries {
			name := e.Name()
			if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") || skipFiles[name] {
				continue
			}
			src, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				log.Fatal(err)
			}
			res, n, err := instrument(t, filepath.Join(dir, name), src, wrapped)
			if err != nil {
				log.Fatal(err)
			}
			funcs += n
			p := filepath.Join(dst, name)
			if err := os.WriteFile(p, res, 0o644); err != nil {
				log.Fatal(err)
			}
			replace[filepath.Join(dir, name)] = p
		}
		for _, w := range t.wrap {
			if !wrapped[w] {
				log.Fatalf("%s: no declaration of %s to wrap; upstream changed", t.pkg, w)
			}
		}
		hook := filepath.Join(dst, "zz_tlscompanion.go")
		if err := os.WriteFile(hook, []byte(t.hook), 0o644); err != nil {
			log.Fatal(err)
		}
		replace[filepath.Join(dir, "zz_tlscompanion.go")] = hook
	}
	b, err := json.MarshalIndent(map[string]any{"Replace": replace}, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(abs, "overlay.json"), b, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("instrumented %d functions in %d files", funcs, len(replace)-len(targets))
}

func goEnv(name string) string {
	b, err := exec.Command("go", "env", name).Output()
	if err != nil {
		log.Fatalf("go env %s: %v", name, err)
	}
	return strings.TrimSpace(string(b))
}

type edit struct {
	off  int
	end  int
	text string
}

// instrument inserts a trace call at the top of every function body in src and
// renames the declarations listed in t.wrap. Edits never add or remove a
// newline, so upstream line numbers stay valid.
func instrument(t target, path string, src []byte, wrapped map[string]bool) ([]byte, int, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, src, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		return nil, 0, err
	}
	wrap := map[string]bool{}
	for _, w := range t.wrap {
		wrap[w] = true
	}
	var edits []edit
	n := 0
	for _, d := range f.Decls {
		fd, ok := d.(*ast.FuncDecl)
		if !ok || fd.Body == nil {
			continue
		}
		if fd.Name.Name == "String" && fd.Recv != nil {
			continue
		}
		key := symkey.FuncDecl(t.pkg, fd, path, fset.Position(fd.Pos()).Line)
		lb := fset.Position(fd.Body.Lbrace).Offset
		edits = append(edits, edit{lb + 1, lb + 1, " defer tlscTraceEnter(" + strconv.Quote(key) + ")();"})
		n++
		if fd.Recv == nil && wrap[fd.Name.Name] {
			s := fset.Position(fd.Name.Pos()).Offset
			edits = append(edits, edit{s, s + len(fd.Name.Name), "tlscOrig" + fd.Name.Name})
			wrapped[fd.Name.Name] = true
		}
	}
	sort.Slice(edits, func(i, j int) bool { return edits[i].off > edits[j].off })
	out := append([]byte(nil), src...)
	for _, e := range edits {
		out = append(out[:e.off], append([]byte(e.text), out[e.end:]...)...)
	}
	if strings.Count(string(out), "\n") != strings.Count(string(src), "\n") {
		return nil, 0, fmt.Errorf("%s: instrumentation changed the line count", path)
	}
	return out, n, nil
}

const tlsHook = `// Code generated by tlsinstrument. DO NOT EDIT.

package tls

import (
	"crypto/internal/fips140/tls12"
	"crypto/internal/fips140/tls13"
)

// TLSCompanionTraceHook, when set, is called on entry to and exit from every
// instrumented function, keyed like the workbench index keys declarations.
var TLSCompanionTraceHook func(enter bool, key string)

// TLSCompanionSecretHook, when set, receives every secret the TLS 1.3 key
// schedule and the TLS 1.2 PRF derive. See the tls13 and tls12 hook files for
// what in1 and in2 hold for each op.
var TLSCompanionSecretHook func(op, label string, in1, in2, out []byte)

func init() {
	tls13.TLSCompanionTraceEnter = tlscTraceEnter
	tls12.TLSCompanionTraceEnter = tlscTraceEnter
	secret := func(op, label string, in1, in2, out []byte) {
		if TLSCompanionSecretHook != nil {
			TLSCompanionSecretHook(op, label, in1, in2, out)
		}
	}
	tls13.TLSCompanionSecretHook = secret
	tls12.TLSCompanionSecretHook = secret
}

func tlscTraceEnter(key string) func() {
	if TLSCompanionTraceHook == nil {
		return func() {}
	}
	TLSCompanionTraceHook(true, key)
	return func() { TLSCompanionTraceHook(false, key) }
}
`

const tls13Hook = `// Code generated by tlsinstrument. DO NOT EDIT.

package tls13

import "hash"

var TLSCompanionTraceEnter func(key string) func()

// TLSCompanionSecretHook receives:
//
//	HKDF-Extract       in1 = salt (current secret), in2 = IKM (new secret)
//	Derive-Secret      in1 = secret, in2 = transcript hash
//	HKDF-Expand-Label  in1 = secret, in2 = context
var TLSCompanionSecretHook func(op, label string, in1, in2, out []byte)

// tlscDepth suppresses reports from primitives called by another wrapped
// primitive, so Derive-Secret is not also reported as its inner Expand-Label.
var tlscDepth int

func tlscTraceEnter(key string) func() {
	if TLSCompanionTraceEnter == nil {
		return func() {}
	}
	return TLSCompanionTraceEnter(key)
}

func tlscReport(op, label string, in1, in2, out []byte) {
	if tlscDepth == 0 && TLSCompanionSecretHook != nil {
		TLSCompanionSecretHook(op, label, in1, in2, out)
	}
}

func ExpandLabel[H hash.Hash](hash func() H, secret []byte, label string, context []byte, length int) []byte {
	tlscDepth++
	out := tlscOrigExpandLabel(hash, secret, label, context, length)
	tlscDepth--
	tlscReport("HKDF-Expand-Label", label, secret, context, out)
	return out
}

func extract[H hash.Hash](hash func() H, newSecret, currentSecret []byte) []byte {
	tlscDepth++
	out := tlscOrigextract(hash, newSecret, currentSecret)
	tlscDepth--
	ikm := newSecret
	if ikm == nil {
		ikm = make([]byte, hash().Size())
	}
	tlscReport("HKDF-Extract", "", currentSecret, ikm, out)
	return out
}

func deriveSecret[H hash.Hash](hash func() H, secret []byte, label string, transcript hash.Hash) []byte {
	var th []byte
	if transcript != nil {
		th = transcript.Sum(nil)
	} else {
		th = hash().Sum(nil)
	}
	tlscDepth++
	out := tlscOrigderiveSecret(hash, secret, label, transcript)
	tlscDepth--
	tlscReport("Derive-Secret", label, secret, th, out)
	return out
}
`

const tls12Hook = `// Code generated by tlsinstrument. DO NOT EDIT.

package tls12

import "hash"

var TLSCompanionTraceEnter func(key string) func()

// TLSCompanionSecretHook receives PRF calls: in1 = secret, in2 = seed.
var TLSCompanionSecretHook func(op, label string, in1, in2, out []byte)

func tlscTraceEnter(key string) func() {
	if TLSCompanionTraceEnter == nil {
		return func() {}
	}
	return TLSCompanionTraceEnter(key)
}

func PRF[H hash.Hash](hash func() H, secret []byte, label string, seed []byte, keyLen int) []byte {
	out := tlscOrigPRF(hash, secret, label, seed, keyLen)
	if TLSCompanionSecretHook != nil {
		TLSCompanionSecretHook("PRF", label, secret, seed, out)
	}
	return out
}
`
