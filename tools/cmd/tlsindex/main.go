// Command tlsindex type-checks crypto/tls and the packages it leans on, straight
// from the GOROOT of the toolchain running it, and writes the static
// cross-reference index the workbench reads: per-file semantic tokens,
// definitions, references, call edges, and comment links into the RFCs.
//
//	go run ./cmd/tlsindex -out ../public/data/code
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/scanner"
	"go/token"
	"go/types"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lr00rl/tls-companion/tools/internal/symkey"
	"golang.org/x/tools/go/packages"
)

// indexed lists the packages whose source the workbench shows. Everything they
// import is still type-checked, so references into other packages resolve to an
// exact upstream file and line.
var indexed = []string{
	"crypto/tls",
	"crypto/internal/fips140/tls13",
	"crypto/internal/fips140/tls12",
	"crypto/internal/fips140/hkdf",
	"crypto/internal/fips140/hmac",
	"crypto/internal/fips140/mlkem",
	"crypto/hpke",
	"crypto/ecdh",
	"crypto/mlkem",
	"crypto/cipher",
	"crypto/x509",
	"vendor/golang.org/x/crypto/cryptobyte",
}

// Token kinds shared with the web app (src/code/tokens.ts).
const (
	kKeyword = 1
	kComment = 2
	kString  = 3
	kNumber  = 4
	kIdent   = 5
	kFunc    = 6
	kMethod  = 7
	kType    = 8
	kField   = 9
	kConst   = 10
	kVar     = 11
	kPackage = 12
	kBuiltin = 13
	kLocal   = 14
	kLabel   = 15
	kLink    = 17
	defBit   = 32
)

type symbol struct {
	Key      string `json:"k"`
	Name     string `json:"n"`
	Kind     int    `json:"t"`
	Pkg      string `json:"p"`
	File     string `json:"f"`
	Line     int    `json:"l"`
	Col      int    `json:"c"`
	EndLine  int    `json:"e,omitempty"`
	Sig      string `json:"s,omitempty"`
	Doc      string `json:"d,omitempty"`
	Recv     string `json:"r,omitempty"`
	External int    `json:"x,omitempty"`

	obj      types.Object
	exported bool
}

type fileOut struct {
	Path    string   `json:"path"`
	Pkg     string   `json:"pkg"`
	Text    string   `json:"text"`
	Ignored bool     `json:"ignored,omitempty"`
	Tokens  []int    `json:"tokens"`
	Refs    []string `json:"refs"`
	Locals  [][]any  `json:"locals"`
	Outline [][]any  `json:"outline"`
}

type fileMeta struct {
	Path       string `json:"p"`
	Lines      int    `json:"lines"`
	Ignored    bool   `json:"ignored,omitempty"`
	Constraint string `json:"constraint,omitempty"`
}

type pkgMeta struct {
	Path     string     `json:"path"`
	Name     string     `json:"name"`
	Display  string     `json:"display"`
	Synopsis string     `json:"synopsis"`
	Files    []fileMeta `json:"files"`
}

type meta struct {
	GoVersion string    `json:"go"`
	Upstream  string    `json:"upstream"`
	Generated string    `json:"generated"`
	Packages  []pkgMeta `json:"packages"`
}

// ref is one use of a symbol: file index, line, column, enclosing func key.
type ref struct {
	file, line, col int
	enclosing       string
}

type indexer struct {
	fset     *token.FileSet
	srcRoot  string
	keyOf    map[types.Object]string
	symbols  map[string]*symbol
	isIndex  map[string]bool
	files    []string
	refs     map[string][]ref
	calls    map[string][]string
	external map[string]bool
}

func main() {
	out := flag.String("out", "../public/data/code", "output directory")
	flag.Parse()
	log.SetFlags(0)

	goroot := goEnv("GOROOT")
	version := goEnv("GOVERSION")
	ix := &indexer{
		fset:     token.NewFileSet(),
		srcRoot:  filepath.Join(goroot, "src"),
		keyOf:    map[types.Object]string{},
		symbols:  map[string]*symbol{},
		isIndex:  map[string]bool{},
		refs:     map[string][]ref{},
		calls:    map[string][]string{},
		external: map[string]bool{},
	}
	for _, p := range indexed {
		ix.isIndex[p] = true
	}

	start := time.Now()
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax |
			packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedDeps,
		Fset: ix.fset,
		Dir:  ix.srcRoot,
		Env:  append(os.Environ(), "GOWORK=off"),
	}
	roots, err := packages.Load(cfg, indexed...)
	if err != nil {
		log.Fatal(err)
	}
	var all []*packages.Package
	packages.Visit(roots, nil, func(p *packages.Package) { all = append(all, p) })
	for _, p := range all {
		for _, e := range p.Errors {
			log.Fatalf("load %s: %v", p.PkgPath, e)
		}
	}
	log.Printf("loaded %d packages in %s", len(all), time.Since(start).Round(time.Millisecond))

	for _, p := range all {
		ix.declare(p)
	}

	m := meta{
		GoVersion: version,
		Upstream:  "https://github.com/golang/go/blob/" + version + "/src/",
		Generated: time.Now().UTC().Format(time.RFC3339),
	}
	byPath := map[string]*packages.Package{}
	for _, p := range roots {
		byPath[p.PkgPath] = p
	}
	for _, path := range indexed {
		p := byPath[path]
		if p == nil {
			log.Fatalf("package %s did not load", path)
		}
		pm, files := ix.indexPackage(p)
		m.Packages = append(m.Packages, pm)
		for _, f := range files {
			writeJSON(filepath.Join(*out, "files", f.Path+".json"), f)
		}
	}

	ix.writeSymbols(*out)
	ix.writeRefs(*out)
	writeJSON(filepath.Join(*out, "calls.json"), ix.calls)
	writeJSON(filepath.Join(*out, "meta.json"), m)
	log.Printf("indexed %d files, %d symbols in %s", len(ix.files), len(ix.symbols), time.Since(start).Round(time.Millisecond))
}

func goEnv(name string) string {
	b, err := exec.Command("go", "env", name).Output()
	if err != nil {
		log.Fatalf("go env %s: %v", name, err)
	}
	return strings.TrimSpace(string(b))
}

// declare assigns keys to every package-level object, method, field, and
// interface method in p, so uses anywhere in the universe resolve by identity.
func (ix *indexer) declare(p *packages.Package) {
	if p.TypesInfo == nil {
		return
	}
	info := p.TypesInfo
	add := func(id *ast.Ident, key string, kind int, doc *ast.CommentGroup, end token.Pos, recv string) {
		obj := info.Defs[id]
		if obj == nil || id.Name == "_" {
			return
		}
		pos := ix.fset.Position(id.Pos())
		s := &symbol{
			Key:      key,
			Name:     id.Name,
			Kind:     kind,
			Pkg:      p.PkgPath,
			File:     ix.rel(pos.Filename),
			Line:     pos.Line,
			Col:      pos.Column,
			Recv:     recv,
			obj:      obj,
			exported: id.IsExported(),
		}
		if end.IsValid() {
			s.EndLine = ix.fset.Position(end).Line
		}
		if doc != nil {
			s.Doc = trimDoc(doc.Text())
		}
		s.Sig = types.ObjectString(obj, func(q *types.Package) string {
			if q == p.Types {
				return ""
			}
			return q.Name()
		})
		ix.keyOf[obj] = key
		ix.symbols[key] = s
	}

	for _, f := range p.Syntax {
		for _, d := range f.Decls {
			switch d := d.(type) {
			case *ast.FuncDecl:
				line := ix.fset.Position(d.Pos()).Line
				key := symkey.FuncDecl(p.PkgPath, d, ix.fset.Position(d.Pos()).Filename, line)
				kind, recv := kFunc, ""
				if d.Recv != nil && len(d.Recv.List) > 0 {
					kind, recv = kMethod, symkey.RecvDisplay(d.Recv.List[0].Type)
				}
				add(d.Name, key, kind, d.Doc, d.End(), recv)
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch s := spec.(type) {
					case *ast.TypeSpec:
						doc := s.Doc
						if doc == nil && len(d.Specs) == 1 {
							doc = d.Doc
						}
						key := p.PkgPath + "." + s.Name.Name
						add(s.Name, key, kType, doc, s.End(), "")
						ix.declareMembers(p, key, s.Type, add)
					case *ast.ValueSpec:
						doc := s.Doc
						if doc == nil && len(d.Specs) == 1 {
							doc = d.Doc
						}
						if doc == nil {
							doc = s.Comment
						}
						kind := kVar
						if d.Tok == token.CONST {
							kind = kConst
						}
						for _, n := range s.Names {
							add(n, p.PkgPath+"."+n.Name, kind, doc, token.NoPos, "")
						}
					}
				}
			}
		}
	}
}

type adder func(id *ast.Ident, key string, kind int, doc *ast.CommentGroup, end token.Pos, recv string)

func (ix *indexer) declareMembers(p *packages.Package, prefix string, e ast.Expr, add adder) {
	switch t := e.(type) {
	case *ast.StructType:
		for _, f := range t.Fields.List {
			doc := f.Doc
			if doc == nil {
				doc = f.Comment
			}
			if len(f.Names) == 0 {
				if id := embeddedIdent(f.Type); id != nil {
					add(id, prefix+"."+id.Name, kField, doc, token.NoPos, "")
				}
				continue
			}
			for _, n := range f.Names {
				add(n, prefix+"."+n.Name, kField, doc, token.NoPos, "")
				ix.declareMembers(p, prefix+"."+n.Name, f.Type, add)
			}
		}
	case *ast.InterfaceType:
		for _, f := range t.Methods.List {
			if _, ok := f.Type.(*ast.FuncType); !ok {
				continue
			}
			for _, n := range f.Names {
				add(n, prefix+"."+n.Name, kMethod, f.Doc, token.NoPos, "")
			}
		}
	case *ast.StarExpr:
		ix.declareMembers(p, prefix, t.X, add)
	case *ast.ArrayType:
		ix.declareMembers(p, prefix, t.Elt, add)
	case *ast.MapType:
		ix.declareMembers(p, prefix, t.Value, add)
	}
}

func embeddedIdent(e ast.Expr) *ast.Ident {
	switch t := e.(type) {
	case *ast.Ident:
		return t
	case *ast.StarExpr:
		return embeddedIdent(t.X)
	case *ast.SelectorExpr:
		return t.Sel
	case *ast.IndexExpr:
		return embeddedIdent(t.X)
	case *ast.IndexListExpr:
		return embeddedIdent(t.X)
	}
	return nil
}

func (ix *indexer) rel(abs string) string {
	r, err := filepath.Rel(ix.srcRoot, abs)
	if err != nil {
		return abs
	}
	return filepath.ToSlash(r)
}

type funcRange struct {
	start, end int
	key        string
}

func (ix *indexer) indexPackage(p *packages.Package) (pkgMeta, []fileOut) {
	pm := pkgMeta{
		Path:    p.PkgPath,
		Name:    p.Name,
		Display: strings.TrimPrefix(p.PkgPath, "vendor/"),
	}
	astByName := map[string]*ast.File{}
	for _, f := range p.Syntax {
		astByName[ix.fset.Position(f.Pos()).Filename] = f
		if f.Doc != nil && pm.Synopsis == "" {
			pm.Synopsis = synopsis(f.Doc.Text())
		}
	}
	var names []string
	ignored := map[string]bool{}
	for _, f := range p.GoFiles {
		names = append(names, f)
	}
	for _, f := range p.IgnoredFiles {
		if strings.HasSuffix(f, ".go") && !strings.HasSuffix(f, "_test.go") {
			names = append(names, f)
			ignored[f] = true
		}
	}
	sort.Slice(names, func(i, j int) bool { return filepath.Base(names[i]) < filepath.Base(names[j]) })

	var outs []fileOut
	for _, name := range names {
		src, err := os.ReadFile(name)
		if err != nil {
			log.Fatal(err)
		}
		fo := ix.indexFile(p, name, src, astByName[name])
		fo.Ignored = ignored[name]
		outs = append(outs, fo)
		pm.Files = append(pm.Files, fileMeta{
			Path:       fo.Path,
			Lines:      bytes.Count(src, []byte("\n")) + 1,
			Ignored:    fo.Ignored,
			Constraint: buildConstraint(src),
		})
	}
	return pm, outs
}

func buildConstraint(src []byte) string {
	for _, line := range strings.SplitN(string(src), "\n", 40) {
		if c, ok := strings.CutPrefix(line, "//go:build "); ok {
			return c
		}
		if strings.HasPrefix(line, "package ") {
			break
		}
	}
	return ""
}

// u16 maps byte offsets to UTF-16 code unit offsets, which is how the browser
// indexes strings.
type u16 []int32

func newU16(src []byte) u16 {
	m := make(u16, len(src)+1)
	var n int32
	for i := 0; i < len(src); {
		r, size := utf8.DecodeRune(src[i:])
		for k := range size {
			m[i+k] = n
		}
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
		i += size
	}
	m[len(src)] = n
	return m
}

var (
	rfcSection = regexp.MustCompile(`RFC ?(\d{3,5}),? (?:[Ss]ection|§) ?(\d+(?:\.\d+)*)|[Ss]ection (\d+(?:\.\d+)*) of RFC ?(\d{3,5})|RFC ?(\d{3,5})`)
	urlish     = regexp.MustCompile(`https?://[^\s)>\]"'` + "`" + `]+[^\s)>\]"'.,;:` + "`" + `]|\b(?:go\.dev|golang\.org)/(?:issue|issues|cl)/\d+|draft-ietf-[a-z0-9]+(?:-[a-z0-9]+)*`)
)

func (ix *indexer) indexFile(p *packages.Package, name string, src []byte, af *ast.File) fileOut {
	rel := ix.rel(name)
	fileIdx := len(ix.files)
	ix.files = append(ix.files, rel)
	conv := newU16(src)

	lineStarts := []int{0}
	for i, b := range src {
		if b == '\n' {
			lineStarts = append(lineStarts, i+1)
		}
	}
	lineCol := func(off int) (int, int) {
		l := sort.SearchInts(lineStarts, off+1) - 1
		return l + 1, int(conv[off]-conv[lineStarts[l]]) + 1
	}

	fo := fileOut{Path: rel, Pkg: p.PkgPath, Text: string(src), Locals: [][]any{}, Outline: [][]any{}}
	refIdx := map[string]int{}
	refOf := func(s string) int {
		if i, ok := refIdx[s]; ok {
			return i
		}
		refIdx[s] = len(fo.Refs)
		fo.Refs = append(fo.Refs, s)
		return len(fo.Refs) - 1
	}
	emit := func(start, end, kind, r int) {
		// Split at newlines so the renderer can treat each line on its own.
		for start < end {
			nl := bytes.IndexByte(src[start:end], '\n')
			stop := end
			if nl >= 0 {
				stop = start + nl
			}
			if stop > start {
				fo.Tokens = append(fo.Tokens, int(conv[start]), int(conv[stop]-conv[start]), kind, r)
			}
			start = stop + 1
		}
	}

	idents := map[int]*ast.Ident{}
	var funcs []funcRange
	info := p.TypesInfo
	if af != nil {
		ast.Inspect(af, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok {
				idents[ix.fset.Position(id.Pos()).Offset] = id
			}
			return true
		})
		for _, d := range af.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			key := ix.keyOf[info.Defs[fd.Name]]
			funcs = append(funcs, funcRange{
				start: ix.fset.Position(fd.Pos()).Offset,
				end:   ix.fset.Position(fd.End()).Offset,
				key:   key,
			})
			if fd.Body != nil && key != "" {
				ix.calls[key] = ix.callees(info, fd.Body)
			}
		}
		ix.outline(af, info, &fo, refOf)
	}
	enclosing := func(off int) string {
		i := sort.Search(len(funcs), func(i int) bool { return funcs[i].end >= off })
		if i < len(funcs) && funcs[i].start <= off {
			return funcs[i].key
		}
		return ""
	}

	localIdx := map[types.Object]int{}
	localOf := func(obj types.Object) int {
		if i, ok := localIdx[obj]; ok {
			return i
		}
		pos := ix.fset.Position(obj.Pos())
		if pos.Filename != name {
			return -1
		}
		l, c := lineCol(pos.Offset)
		sig := types.ObjectString(obj, func(q *types.Package) string {
			if q == p.Types {
				return ""
			}
			return q.Name()
		})
		localIdx[obj] = len(fo.Locals)
		fo.Locals = append(fo.Locals, []any{l, c, sig})
		return len(fo.Locals) - 1
	}

	sfset := token.NewFileSet()
	tf := sfset.AddFile(name, -1, len(src))
	var sc scanner.Scanner
	sc.Init(tf, src, nil, scanner.ScanComments)
	for {
		pos, tok, lit := sc.Scan()
		if tok == token.EOF {
			break
		}
		off := tf.Offset(pos)
		switch {
		case tok == token.COMMENT:
			ix.emitComment(src, off, off+len(lit), emit, refOf)
		case tok == token.STRING || tok == token.CHAR:
			emit(off, off+len(lit), kString, -1)
		case tok == token.INT || tok == token.FLOAT || tok == token.IMAG:
			emit(off, off+len(lit), kNumber, -1)
		case tok.IsKeyword():
			emit(off, off+len(tok.String()), kKeyword, -1)
		case tok == token.IDENT:
			kind, r := kIdent, -1
			id := idents[off]
			if id != nil && info != nil {
				obj, isDef := info.Defs[id], true
				if obj == nil {
					obj, isDef = info.Uses[id], false
				}
				// An embedded field's identifier both defines the field and
				// names the type; linking to the type is more useful.
				if isDef {
					if u := info.Uses[id]; u != nil {
						obj, isDef = u, false
					}
				}
				if obj != nil {
					kind = kindOf(obj)
					if key, ok := ix.keyOf[obj]; ok {
						r = refOf(key)
						if !isDef {
							l, c := lineCol(off)
							ix.refs[key] = append(ix.refs[key], ref{fileIdx, l, c, enclosing(off)})
							if !ix.isIndex[obj.Pkg().Path()] {
								ix.external[key] = true
							}
						}
					} else if pn, ok := obj.(*types.PkgName); ok {
						r = refOf("pkg:" + pn.Imported().Path())
					} else if obj.Pkg() != nil && obj.Pkg().Path() == "unsafe" {
						r = refOf("ext:unsafe." + obj.Name())
					} else if obj.Pkg() != nil && obj.Parent() != obj.Pkg().Scope() {
						if li := localOf(obj); li >= 0 {
							r = refOf("L:" + strconv.Itoa(li))
						}
					}
					if isDef {
						kind |= defBit
					}
				}
			}
			emit(off, off+len(lit), kind, r)
		}
	}
	if fo.Refs == nil {
		fo.Refs = []string{}
	}
	return fo
}

func kindOf(obj types.Object) int {
	switch o := obj.(type) {
	case *types.PkgName:
		return kPackage
	case *types.Const:
		return kConst
	case *types.TypeName:
		if o.Parent() != nil && o.Pkg() != nil && o.Parent() != o.Pkg().Scope() {
			if _, ok := o.Type().(*types.TypeParam); ok {
				return kLocal
			}
		}
		return kType
	case *types.Var:
		if o.IsField() {
			return kField
		}
		if o.Pkg() != nil && o.Parent() == o.Pkg().Scope() {
			return kVar
		}
		return kLocal
	case *types.Func:
		if sig, ok := o.Type().(*types.Signature); ok && sig.Recv() != nil {
			return kMethod
		}
		return kFunc
	case *types.Builtin, *types.Nil:
		return kBuiltin
	case *types.Label:
		return kLabel
	}
	return kIdent
}

func (ix *indexer) emitComment(src []byte, start, end int, emit func(int, int, int, int), refOf func(string) int) {
	text := string(src[start:end])
	type span struct {
		s, e int
		ref  string
	}
	var spans []span
	for _, m := range rfcSection.FindAllStringSubmatchIndex(text, -1) {
		g := func(i int) string {
			if m[2*i] < 0 {
				return ""
			}
			return text[m[2*i]:m[2*i+1]]
		}
		var r string
		switch {
		case g(1) != "":
			r = "rfc:" + g(1) + "#" + g(2)
		case g(4) != "":
			r = "rfc:" + g(4) + "#" + g(3)
		default:
			r = "rfc:" + g(5)
		}
		spans = append(spans, span{m[0], m[1], r})
	}
	for _, m := range urlish.FindAllStringIndex(text, -1) {
		u := text[m[0]:m[1]]
		switch {
		case strings.HasPrefix(u, "draft-ietf-"):
			u = "https://datatracker.ietf.org/doc/" + strings.TrimRight(u, "-")
		case !strings.HasPrefix(u, "http"):
			u = "https://" + u
		}
		overlaps := false
		for _, s := range spans {
			if m[0] < s.e && s.s < m[1] {
				overlaps = true
			}
		}
		if !overlaps {
			spans = append(spans, span{m[0], m[1], "url:" + u})
		}
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].s < spans[j].s })
	cur := 0
	for _, s := range spans {
		if s.s < cur {
			continue
		}
		emit(start+cur, start+s.s, kComment, -1)
		emit(start+s.s, start+s.e, kLink, refOf(s.ref))
		cur = s.e
	}
	emit(start+cur, end, kComment, -1)
}

// callees lists, in source order and without repeats, the functions and
// methods a body refers to.
func (ix *indexer) callees(info *types.Info, body *ast.BlockStmt) []string {
	seen := map[string]bool{}
	out := []string{}
	ast.Inspect(body, func(n ast.Node) bool {
		id, ok := n.(*ast.Ident)
		if !ok {
			return true
		}
		if fn, ok := info.Uses[id].(*types.Func); ok {
			if key, ok := ix.keyOf[fn]; ok && !seen[key] {
				seen[key] = true
				out = append(out, key)
			}
		}
		return true
	})
	return out
}

func (ix *indexer) outline(af *ast.File, info *types.Info, fo *fileOut, refOf func(string) int) {
	push := func(id *ast.Ident, end token.Pos) {
		key, ok := ix.keyOf[info.Defs[id]]
		if !ok {
			return
		}
		s := ix.symbols[key]
		fo.Outline = append(fo.Outline, []any{s.Line, ix.fset.Position(end).Line, refOf(key), s.Kind})
	}
	for _, d := range af.Decls {
		switch d := d.(type) {
		case *ast.FuncDecl:
			push(d.Name, d.End())
		case *ast.GenDecl:
			if d.Tok != token.TYPE {
				continue
			}
			for _, spec := range d.Specs {
				if ts, ok := spec.(*ast.TypeSpec); ok {
					push(ts.Name, ts.End())
				}
			}
		}
	}
}

func (ix *indexer) writeSymbols(out string) {
	var list []*symbol
	for key, s := range ix.symbols {
		switch {
		case ix.isIndex[s.Pkg]:
		case ix.external[key]:
			s.External = 1
			s.Doc = synopsis(s.Doc)
		default:
			continue
		}
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Key < list[j].Key })
	writeJSON(filepath.Join(out, "symbols.json"), map[string]any{"files": ix.files, "symbols": list})
}

// writeRefs splits references by the package that declares the symbol, so the
// browser only fetches the slice it needs.
func (ix *indexer) writeRefs(out string) {
	byPkg := map[string]map[string][][]any{}
	for key, rs := range ix.refs {
		s := ix.symbols[key]
		if s == nil {
			continue
		}
		pkg := s.Pkg
		if !ix.isIndex[pkg] {
			pkg = "external"
		}
		m := byPkg[pkg]
		if m == nil {
			m = map[string][][]any{}
			byPkg[pkg] = m
		}
		for _, r := range rs {
			m[key] = append(m[key], []any{r.file, r.line, r.col, r.enclosing})
		}
	}
	for pkg, m := range byPkg {
		writeJSON(filepath.Join(out, "refs", RefsFile(pkg)), m)
	}
}

// RefsFile is the file name holding references to symbols of pkg; the web app
// computes the same name.
func RefsFile(pkg string) string {
	return strings.ReplaceAll(pkg, "/", "_") + ".json"
}

func trimDoc(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 1600 {
		cut := strings.LastIndex(s[:1600], "\n")
		if cut < 800 {
			cut = 1600
		}
		s = s[:cut] + "\n…"
	}
	return s
}

func synopsis(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "\n\n"); i >= 0 {
		s = s[:i]
	}
	s = strings.Join(strings.Fields(s), " ")
	if i := strings.Index(s, ". "); i >= 0 {
		s = s[:i+1]
	}
	return s
}

func writeJSON(path string, v any) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Fatal(err)
	}
	b, err := json.Marshal(v)
	if err != nil {
		log.Fatal(fmt.Errorf("%s: %w", path, err))
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		log.Fatal(err)
	}
}
