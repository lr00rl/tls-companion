//go:build tlstrace

// Command tlscapture runs real crypto/tls handshakes between a client and a
// server in one process and records, for each scenario, everything the
// workbench replays: the bytes on the wire, every record decrypted with the key
// log, every secret the key schedule derived, and the call trace of both
// endpoints through crypto/tls.
//
// It only builds against the overlay written by tlsinstrument:
//
//	go run ./cmd/tlsinstrument -out ../build/overlay
//	go run -tags tlstrace -overlay ../build/overlay/overlay.json ./cmd/tlscapture -out ../public/data/captures
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"crypto/tls"
)

const serverName = "tls-companion.example"

// now pins certificate validity checks, so captures do not depend on the date
// they were taken.
var now = time.Date(2026, 10, 17, 8, 0, 0, 0, time.UTC)

type scenario struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Brief string `json:"brief"`

	rsa bool
	// prime runs one unrecorded connection first, so the recorded one can
	// resume its session.
	prime  bool
	client func(p *pki, c *tls.Config)
	server func(p *pki, c *tls.Config)
	check  func(c, s tls.ConnectionState) error
}

var scenarios = []scenario{
	{
		ID: "tls13-full", Title: "TLS 1.3 full handshake", Brief: "X25519MLKEM768 hybrid key exchange, an ECDSA chain, 1-RTT, then one HTTP/1.1 request and a session ticket",
		client: func(p *pki, c *tls.Config) { c.ClientSessionCache = tls.NewLRUClientSessionCache(4) },
		check: func(c, s tls.ConnectionState) error {
			return want(c.Version == tls.VersionTLS13 && c.CurveID == tls.X25519MLKEM768 && !c.DidResume, "TLS 1.3 with X25519MLKEM768", c)
		},
	},
	{
		ID: "tls13-hrr", Title: "TLS 1.3 HelloRetryRequest", Brief: "The server accepts only P-256, the guessed key_share misses, and a second ClientHello costs a round trip",
		server: func(p *pki, c *tls.Config) { c.CurvePreferences = []tls.CurveID{tls.CurveP256} },
		check: func(c, s tls.ConnectionState) error {
			return want(c.Version == tls.VersionTLS13 && c.CurveID == tls.CurveP256 && c.HelloRetryRequest, "TLS 1.3 HRR to P-256", c)
		},
	},
	{
		ID: "tls13-resume", Title: "TLS 1.3 PSK resumption", Brief: "Resumes with the NewSessionTicket from the previous connection, psk_dhe_ke, and sends no certificate",
		prime:  true,
		client: func(p *pki, c *tls.Config) { c.ClientSessionCache = tls.NewLRUClientSessionCache(4) },
		check: func(c, s tls.ConnectionState) error {
			return want(c.Version == tls.VersionTLS13 && c.DidResume, "TLS 1.3 resumption", c)
		},
	},
	{
		ID: "tls12-ecdhe", Title: "TLS 1.2 ECDHE handshake", Brief: "ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, X25519, extended master secret, 2-RTT",
		client: func(p *pki, c *tls.Config) {
			c.MaxVersion = tls.VersionTLS12
			c.CipherSuites = []uint16{tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256}
			c.CurvePreferences = []tls.CurveID{tls.X25519}
		},
		check: func(c, s tls.ConnectionState) error {
			return want(c.Version == tls.VersionTLS12 && c.CipherSuite == tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, "TLS 1.2 ECDHE", c)
		},
	},
	{
		ID: "tls12-rsa", Title: "TLS 1.2 RSA key transport", Brief: "TLS_RSA_WITH_AES_128_GCM_SHA256: the premaster secret is encrypted to the server public key, with no forward secrecy",
		rsa: true,
		client: func(p *pki, c *tls.Config) {
			c.MaxVersion = tls.VersionTLS12
			c.CipherSuites = []uint16{tls.TLS_RSA_WITH_AES_128_GCM_SHA256}
		},
		server: func(p *pki, c *tls.Config) { c.CipherSuites = []uint16{tls.TLS_RSA_WITH_AES_128_GCM_SHA256} },
		check: func(c, s tls.ConnectionState) error {
			return want(c.Version == tls.VersionTLS12 && c.CipherSuite == tls.TLS_RSA_WITH_AES_128_GCM_SHA256, "TLS 1.2 RSA kex", c)
		},
	},
}

func want(ok bool, what string, c tls.ConnectionState) error {
	if ok {
		return nil
	}
	return fmt.Errorf("expected %s, got version %#x suite %s curve %v resumed %v",
		what, c.Version, tls.CipherSuiteName(c.CipherSuite), c.CurveID, c.DidResume)
}

const request = "GET / HTTP/1.1\r\nHost: " + serverName + "\r\nUser-Agent: tls-companion/1.0\r\nAccept: */*\r\n\r\n"

const body = "hello from crypto/tls\n"

var response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " +
	strconv.Itoa(len(body)) + "\r\n\r\n" + body

type stateInfo struct {
	Version     string   `json:"version"`
	CipherSuite string   `json:"cipherSuite"`
	Curve       string   `json:"curve"`
	ALPN        string   `json:"alpn"`
	ServerName  string   `json:"serverName"`
	Resumed     bool     `json:"resumed"`
	HRR         bool     `json:"hrr"`
	PeerCerts   []string `json:"peerCerts,omitempty"`
}

type capture struct {
	scenario
	Go       string         `json:"go"`
	Taken    string         `json:"taken"`
	Addrs    [2]string      `json:"addrs"`
	Fns      []string       `json:"fns"`
	Files    []string       `json:"files"`
	Events   [][]any        `json:"events"`
	Writes   []writeEv      `json:"writes"`
	Records  []record       `json:"records"`
	Messages []message      `json:"messages"`
	Secrets  []secretEv     `json:"secrets"`
	Keylog   []keylogLine   `json:"keylog"`
	Certs    []certInfo     `json:"certs"`
	State    [2]stateInfo   `json:"state"`
	Config   [2][]string    `json:"config"`
	Stats    map[string]int `json:"stats"`
}

func main() {
	out := flag.String("out", "../public/data/captures", "output directory")
	only := flag.String("only", "", "run only this scenario")
	flag.Parse()
	log.SetFlags(0)

	b, err := exec.Command("go", "env", "GOROOT", "GOVERSION").Output()
	must(err)
	env := strings.Fields(string(b))
	rec := newRecorder(env[0])
	must(os.MkdirAll(*out, 0o755))

	var index []map[string]any
	for _, sc := range scenarios {
		if *only != "" && sc.ID != *only {
			continue
		}
		c, err := run(rec, sc)
		if err != nil {
			log.Fatalf("%s: %v", sc.ID, err)
		}
		c.Go = env[1]
		c.Taken = time.Now().UTC().Format(time.RFC3339)
		writeJSON(filepath.Join(*out, sc.ID+".json"), c)
		index = append(index, map[string]any{
			"id": sc.ID, "title": sc.Title, "brief": sc.Brief,
			"records": len(c.Records), "messages": len(c.Messages), "events": len(c.Events),
		})
		log.Printf("%-13s %3d records %3d messages %5d events %3d secrets  %s / %s",
			sc.ID, len(c.Records), len(c.Messages), len(c.Events), len(c.Secrets), c.State[0].Version, c.State[0].CipherSuite)
	}
	if *only == "" {
		writeJSON(filepath.Join(*out, "index.json"), index)
	}
}

func run(rec *recorder, sc scenario) (*capture, error) {
	p := newPKI(sc.rsa, now)
	cc := &tls.Config{
		ServerName:   serverName,
		RootCAs:      p.roots,
		NextProtos:   []string{"h2", "http/1.1"},
		Time:         func() time.Time { return now },
		KeyLogWriter: keylogWriter{r: rec, side: client},
	}
	scfg := &tls.Config{
		Certificates: []tls.Certificate{p.chain},
		NextProtos:   []string{"http/1.1"},
		Time:         func() time.Time { return now },
	}
	if sc.client != nil {
		sc.client(p, cc)
	}
	if sc.server != nil {
		sc.server(p, scfg)
	}
	// The server keeps its session ticket keys across connections only if it
	// is the same Config, which is what resumption needs.
	rec.reset()
	if sc.prime {
		if _, _, err := connect(rec, cc, scfg); err != nil {
			return nil, fmt.Errorf("priming connection: %w", err)
		}
		rec.reset()
	}
	rec.start()
	cs, ss, err := connect(rec, cc, scfg)
	rec.stop()
	if err != nil {
		return nil, err
	}
	if err := sc.check(cs, ss); err != nil {
		return nil, err
	}
	recs, msgs, _, err := decode(rec)
	if err != nil {
		return nil, err
	}
	if err := crossCheck(rec, recs); err != nil {
		return nil, err
	}
	c := &capture{
		scenario: sc,
		Addrs:    [2]string{addrs[0].String(), addrs[1].String()},
		Fns:      rec.fns,
		Files:    rec.files,
		Events:   rec.events,
		Writes:   rec.writes,
		Records:  recs,
		Messages: msgs,
		Secrets:  rec.secrets,
		Keylog:   rec.keylog,
		Certs:    p.info(),
		State:    [2]stateInfo{state(cs), state(ss)},
		Config:   [2][]string{describe(cc, true), describe(scfg, false)},
		Stats:    map[string]int{},
	}
	for _, e := range rec.events {
		if e[0] == evEnter {
			c.Stats["calls"]++
		}
	}
	return c, nil
}

// connect runs one connection: handshake, one HTTP/1.1 exchange, close.
func connect(rec *recorder, cc, scfg *tls.Config) (tls.ConnectionState, tls.ConnectionState, error) {
	p := newPipe()
	var cs, ss tls.ConnectionState
	done := make(chan error, 2)
	go p.run(rec, server, func(nc net.Conn) error {
		conn := tls.Server(nc, scfg)
		rec.mark(server, "handshake")
		if err := conn.Handshake(); err != nil {
			return fmt.Errorf("server handshake: %w", err)
		}
		rec.mark(server, "handshake:done")
		ss = conn.ConnectionState()
		rec.mark(server, "app:read")
		br := bufio.NewReader(conn)
		for {
			line, err := br.ReadString('\n')
			if err != nil {
				return fmt.Errorf("server read request: %w", err)
			}
			if line == "\r\n" {
				break
			}
		}
		rec.mark(server, "app:write")
		if _, err := io.WriteString(conn, response); err != nil {
			return err
		}
		rec.mark(server, "close")
		if _, err := io.Copy(io.Discard, br); err != nil {
			return fmt.Errorf("server drain: %w", err)
		}
		return conn.Close()
	}, done)
	<-p.parked
	go p.run(rec, client, func(nc net.Conn) error {
		conn := tls.Client(nc, cc)
		rec.mark(client, "handshake")
		if err := conn.Handshake(); err != nil {
			return fmt.Errorf("client handshake: %w", err)
		}
		rec.mark(client, "handshake:done")
		cs = conn.ConnectionState()
		rec.mark(client, "app:write")
		if _, err := io.WriteString(conn, request); err != nil {
			return err
		}
		rec.mark(client, "app:read")
		got := make([]byte, len(response))
		if _, err := io.ReadFull(conn, got); err != nil {
			return fmt.Errorf("client read response: %w", err)
		}
		if !bytes.Equal(got, []byte(response)) {
			return errors.New("client got a different response")
		}
		rec.mark(client, "close")
		return conn.Close()
	}, done)
	for range 2 {
		if err := <-done; err != nil {
			return cs, ss, err
		}
	}
	return cs, ss, nil
}

// crossCheck compares the keys the decoder derived on its own with the ones
// crypto/tls derived, as reported through the secret hook.
func crossCheck(rec *recorder, recs []record) error {
	derived := map[string]bool{}
	for _, s := range rec.secrets {
		if s.Op == "HKDF-Expand-Label" && (s.Label == "key" || s.Label == "iv") {
			derived[s.Out] = true
		}
		if s.Op == "PRF" && s.Label == "key expansion" {
			derived[s.Out] = true
		}
	}
	for i, r := range recs {
		if r.Prot == nil {
			continue
		}
		if r.Prot.Secret == "CLIENT_RANDOM" {
			ok := false
			for k := range derived {
				if strings.Contains(k, r.Prot.Key) {
					ok = true
				}
			}
			if !ok {
				return fmt.Errorf("record %d: TLS 1.2 key not found in crypto/tls key block", i)
			}
			continue
		}
		if !derived[r.Prot.Key] || !derived[r.Prot.IV] {
			return fmt.Errorf("record %d: decoder key/iv differ from crypto/tls", i)
		}
	}
	return nil
}

func state(s tls.ConnectionState) stateInfo {
	st := stateInfo{
		Version:     tls.VersionName(s.Version),
		CipherSuite: tls.CipherSuiteName(s.CipherSuite),
		Curve:       s.CurveID.String(),
		ALPN:        s.NegotiatedProtocol,
		ServerName:  s.ServerName,
		Resumed:     s.DidResume,
		HRR:         s.HelloRetryRequest,
	}
	for _, c := range s.PeerCertificates {
		st.PeerCerts = append(st.PeerCerts, c.Subject.CommonName)
	}
	return st
}

// describe lists the settings that differ from a zero Config, as Go code.
func describe(c *tls.Config, isClient bool) []string {
	var out []string
	if isClient {
		out = append(out, fmt.Sprintf("ServerName: %q", c.ServerName), "RootCAs: pool(TLS Companion Root CA)")
	} else {
		out = append(out, "Certificates: []tls.Certificate{leaf, intermediate}")
	}
	out = append(out, fmt.Sprintf("NextProtos: %q", c.NextProtos))
	if c.MaxVersion != 0 {
		out = append(out, "MaxVersion: tls.VersionTLS"+strings.ReplaceAll(strings.TrimPrefix(tls.VersionName(c.MaxVersion), "TLS "), ".", ""))
	}
	if len(c.CipherSuites) > 0 {
		var names []string
		for _, s := range c.CipherSuites {
			names = append(names, "tls."+tls.CipherSuiteName(s))
		}
		out = append(out, "CipherSuites: []uint16{"+strings.Join(names, ", ")+"}")
	}
	if len(c.CurvePreferences) > 0 {
		var names []string
		for _, id := range c.CurvePreferences {
			names = append(names, "tls."+id.String())
		}
		out = append(out, "CurvePreferences: []tls.CurveID{"+strings.Join(names, ", ")+"}")
	}
	if c.ClientSessionCache != nil {
		out = append(out, "ClientSessionCache: tls.NewLRUClientSessionCache(4)")
	}
	if c.KeyLogWriter != nil {
		out = append(out, "KeyLogWriter: keylog")
	}
	return out
}

func writeJSON(path string, v any) {
	b, err := json.Marshal(v)
	must(err)
	must(os.WriteFile(path, b, 0o644))
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
