//go:build tlstrace

package main

import (
	"bytes"
	"crypto/tls"
	"encoding/hex"
	"io"
	"net"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	client = 0
	server = 1
)

// Event kinds, shared with the web app (src/capture/types.ts).
const (
	evEnter  = 0 // [0, side, fn, callerFile, callerLine]
	evLeave  = 1 // [1, side, fn]
	evWrite  = 2 // [2, side, write]
	evRead   = 3 // [3, side, bytes]
	evSecret = 4 // [4, side, secret]
	evMark   = 5 // [5, side, mark]
)

type secretEv struct {
	Side  int    `json:"side"`
	Event int    `json:"ev"`
	Op    string `json:"op"`
	Label string `json:"label"`
	In1   string `json:"in1"`
	In2   string `json:"in2"`
	Out   string `json:"out"`
}

type keylogLine struct {
	Side   int    `json:"side"`
	Event  int    `json:"ev"`
	Label  string `json:"label"`
	Random string `json:"random"`
	Secret string `json:"secret"`
}

type writeEv struct {
	Side   int `json:"side"`
	Event  int `json:"ev"`
	Offset int `json:"off"`
	Len    int `json:"len"`
}

// recorder collects one ordered log of everything both endpoints do. The pipe
// lets only one endpoint run at a time, so the order is the causal order.
type recorder struct {
	mu      sync.Mutex
	on      bool
	goroot  string
	sides   map[uint64]int
	fnIdx   map[string]int
	fns     []string
	fileIdx map[string]int
	files   []string
	events  [][]any
	writes  []writeEv
	streams [2]bytes.Buffer // bytes written by each side
	secrets []secretEv
	keylog  []keylogLine
}

func newRecorder(goroot string) *recorder {
	r := &recorder{goroot: filepath.Join(goroot, "src") + "/"}
	r.reset()
	tls.TLSCompanionTraceHook = r.trace
	tls.TLSCompanionSecretHook = r.secret
	return r
}

func (r *recorder) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.on = false
	r.sides = map[uint64]int{}
	r.fnIdx = map[string]int{}
	r.fns = nil
	r.fileIdx = map[string]int{}
	r.files = nil
	r.events = nil
	r.writes = nil
	r.streams = [2]bytes.Buffer{}
	r.secrets = nil
	r.keylog = nil
}

func (r *recorder) start() { r.mu.Lock(); r.on = true; r.mu.Unlock() }
func (r *recorder) stop()  { r.mu.Lock(); r.on = false; r.mu.Unlock() }

// register binds the calling goroutine to an endpoint.
func (r *recorder) register(side int) {
	r.mu.Lock()
	r.sides[goid()] = side
	r.mu.Unlock()
}

func (r *recorder) side() (int, bool) {
	s, ok := r.sides[goid()]
	return s, ok && r.on
}

func (r *recorder) trace(enter bool, key string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	side, ok := r.side()
	if !ok {
		return
	}
	fn, ok := r.fnIdx[key]
	if !ok {
		fn = len(r.fns)
		r.fnIdx[key] = fn
		r.fns = append(r.fns, key)
	}
	if !enter {
		r.events = append(r.events, []any{evLeave, side, fn})
		return
	}
	file, line := r.callSite()
	r.events = append(r.events, []any{evEnter, side, fn, file, line})
}

// callSite returns where the instrumented function was called from: the first
// frame past the hook plumbing and the function itself.
func (r *recorder) callSite() (int, int) {
	pcs := make([]uintptr, 16)
	n := runtime.Callers(3, pcs)
	frames := runtime.CallersFrames(pcs[:n])
	seenSelf := false
	for {
		f, more := frames.Next()
		if strings.HasSuffix(f.File, "zz_tlscompanion.go") || strings.HasPrefix(f.Function, "main.(*recorder)") {
			if !more {
				break
			}
			continue
		}
		if !seenSelf {
			seenSelf = true
		} else {
			return r.file(f.File), f.Line
		}
		if !more {
			break
		}
	}
	return -1, 0
}

func (r *recorder) file(abs string) int {
	rel := abs
	if i := strings.Index(abs, "/build/overlay/"); i >= 0 {
		rel = abs[i+len("/build/overlay/"):]
	} else if strings.HasPrefix(abs, r.goroot) {
		rel = strings.TrimPrefix(abs, r.goroot)
	} else if strings.Contains(abs, "/cmd/tlscapture/") {
		rel = "app:" + filepath.Base(abs)
	}
	i, ok := r.fileIdx[rel]
	if !ok {
		i = len(r.files)
		r.fileIdx[rel] = i
		r.files = append(r.files, rel)
	}
	return i
}

func (r *recorder) secret(op, label string, in1, in2, out []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	side, ok := r.side()
	if !ok {
		return
	}
	r.events = append(r.events, []any{evSecret, side, len(r.secrets)})
	r.secrets = append(r.secrets, secretEv{
		Side: side, Event: len(r.events) - 1, Op: op, Label: label,
		In1: hex.EncodeToString(in1), In2: hex.EncodeToString(in2), Out: hex.EncodeToString(out),
	})
}

func (r *recorder) mark(side int, text string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.on {
		r.events = append(r.events, []any{evMark, side, text})
	}
}

func (r *recorder) write(side int, b []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.on {
		return
	}
	r.events = append(r.events, []any{evWrite, side, len(r.writes)})
	r.writes = append(r.writes, writeEv{Side: side, Event: len(r.events) - 1, Offset: r.streams[side].Len(), Len: len(b)})
	r.streams[side].Write(b)
}

func (r *recorder) read(side, n int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.on {
		r.events = append(r.events, []any{evRead, side, n})
	}
}

// keylogWriter receives NSS key log lines from one endpoint's Config.
type keylogWriter struct {
	r    *recorder
	side int
}

func (w keylogWriter) Write(b []byte) (int, error) {
	w.r.mu.Lock()
	defer w.r.mu.Unlock()
	if !w.r.on {
		return len(b), nil
	}
	f := strings.Fields(string(b))
	if len(f) == 3 {
		w.r.keylog = append(w.r.keylog, keylogLine{Side: w.side, Event: len(w.r.events), Label: f[0], Random: f[1], Secret: f[2]})
	}
	return len(b), nil
}

func goid() uint64 {
	var buf [64]byte
	b := buf[:runtime.Stack(buf[:], false)]
	b = bytes.TrimPrefix(b, []byte("goroutine "))
	id, _ := strconv.ParseUint(string(b[:bytes.IndexByte(b, ' ')]), 10, 64)
	return id
}

// pipe is an in-memory duplex connection whose mutex doubles as a baton: an
// endpoint holds it while running and gives it up only while it waits for
// bytes, so client and server code never interleave arbitrarily.
type pipe struct {
	mu     sync.Mutex
	cond   *sync.Cond
	buf    [2][]byte
	closed [2]bool
	parked chan struct{}
	once   sync.Once
}

func newPipe() *pipe {
	p := &pipe{parked: make(chan struct{})}
	p.cond = sync.NewCond(&p.mu)
	return p
}

// run executes fn as the given endpoint, holding the baton.
func (p *pipe) run(r *recorder, side int, fn func(c net.Conn) error, done chan<- error) {
	p.mu.Lock()
	r.register(side)
	err := fn(&end{p: p, side: side, r: r})
	p.closed[side] = true
	p.cond.Broadcast()
	p.once.Do(func() { close(p.parked) })
	p.mu.Unlock()
	done <- err
}

type end struct {
	p    *pipe
	side int
	r    *recorder
}

func (e *end) Read(b []byte) (int, error) {
	for len(e.p.buf[e.side]) == 0 {
		if e.p.closed[1-e.side] {
			return 0, io.EOF
		}
		e.p.once.Do(func() { close(e.p.parked) })
		e.p.cond.Wait()
	}
	n := copy(b, e.p.buf[e.side])
	e.p.buf[e.side] = e.p.buf[e.side][n:]
	e.r.read(e.side, n)
	return n, nil
}

func (e *end) Write(b []byte) (int, error) {
	if e.p.closed[e.side] {
		return 0, net.ErrClosed
	}
	e.r.write(e.side, b)
	e.p.buf[1-e.side] = append(e.p.buf[1-e.side], b...)
	e.p.cond.Broadcast()
	return len(b), nil
}

func (e *end) Close() error {
	e.p.closed[e.side] = true
	e.p.cond.Broadcast()
	return nil
}

var addrs = [2]*net.TCPAddr{
	{IP: net.ParseIP("192.0.2.10"), Port: 52814},
	{IP: net.ParseIP("198.51.100.20"), Port: 443},
}

func (e *end) LocalAddr() net.Addr              { return addrs[e.side] }
func (e *end) RemoteAddr() net.Addr             { return addrs[1-e.side] }
func (e *end) SetDeadline(time.Time) error      { return nil }
func (e *end) SetReadDeadline(time.Time) error  { return nil }
func (e *end) SetWriteDeadline(time.Time) error { return nil }
