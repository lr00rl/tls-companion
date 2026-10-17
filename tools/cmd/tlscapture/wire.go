//go:build tlstrace

package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"hash"

	"golang.org/x/crypto/chacha20poly1305"
)

const (
	ctChangeCipherSpec = 20
	ctAlert            = 21
	ctHandshake        = 22
	ctApplicationData  = 23
)

type protection struct {
	Secret        string `json:"secret"`
	Seq           int    `json:"seq"`
	Key           string `json:"key"`
	IV            string `json:"iv"`
	Nonce         string `json:"nonce"`
	AAD           string `json:"aad"`
	Tag           string `json:"tag"`
	ExplicitNonce string `json:"explicitNonce,omitempty"`
}

type record struct {
	Dir     int         `json:"dir"`
	Off     int         `json:"off"`
	Type    int         `json:"type"`
	Version int         `json:"ver"`
	Len     int         `json:"len"`
	Write   int         `json:"write"`
	ReadEv  int         `json:"readEv"`
	Prot    *protection `json:"prot,omitempty"`
	Inner   int         `json:"inner"`
	Plain   string      `json:"plain"`
	Raw     string      `json:"raw"`
	Padding int         `json:"pad,omitempty"`

	plain []byte
}

type message struct {
	Dir   int      `json:"dir"`
	Type  int      `json:"type"`
	Data  string   `json:"data"`
	Parts [][3]int `json:"parts"`
	Epoch string   `json:"epoch"`
}

type aeadSpec struct {
	keyLen int
	hash   func() hash.Hash
	chacha bool
}

var tls13Suites = map[uint16]aeadSpec{
	0x1301: {16, sha256.New, false},
	0x1302: {32, sha512.New384, false},
	0x1303: {32, sha256.New, true},
}

var tls12Suites = map[uint16]aeadSpec{
	0xc02b: {16, sha256.New, false}, 0xc02f: {16, sha256.New, false}, 0x009c: {16, sha256.New, false},
	0xc02c: {32, sha512.New384, false}, 0xc030: {32, sha512.New384, false}, 0x009d: {32, sha512.New384, false},
	0xcca8: {32, sha256.New, true}, 0xcca9: {32, sha256.New, true},
}

func newAEAD(spec aeadSpec, key []byte) cipher.AEAD {
	if spec.chacha {
		a, err := chacha20poly1305.New(key)
		must(err)
		return a
	}
	b, err := aes.NewCipher(key)
	must(err)
	a, err := cipher.NewGCM(b)
	must(err)
	return a
}

// expandLabel is HKDF-Expand-Label from RFC 8446, Section 7.1, written out
// independently of crypto/tls so the capture can cross-check it.
func expandLabel(h func() hash.Hash, secret []byte, label string, context []byte, n int) []byte {
	var l []byte
	l = binary.BigEndian.AppendUint16(l, uint16(n))
	l = append(l, byte(len("tls13 ")+len(label)))
	l = append(l, "tls13 "+label...)
	l = append(l, byte(len(context)))
	l = append(l, context...)
	out, err := hkdf.Expand(h, secret, string(l), n)
	must(err)
	return out
}

// prf12 is the TLS 1.2 PRF from RFC 5246, Section 5.
func prf12(h func() hash.Hash, secret []byte, label string, seed []byte, n int) []byte {
	seed = append([]byte(label), seed...)
	mac := hmac.New(h, secret)
	mac.Write(seed)
	a := mac.Sum(nil)
	var out []byte
	for len(out) < n {
		mac.Reset()
		mac.Write(a)
		mac.Write(seed)
		out = append(out, mac.Sum(nil)...)
		mac.Reset()
		mac.Write(a)
		a = mac.Sum(nil)
	}
	return out[:n]
}

// session holds what the decoder learned from the plaintext handshake.
type session struct {
	version      uint16
	suite        uint16
	clientRandom []byte
	serverRandom []byte
}

var hrrRandom, _ = hex.DecodeString("cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c")

// decode splits both streams into records, decrypts them with the key log, and
// reassembles handshake messages.
func decode(r *recorder) ([]record, []message, session, error) {
	var recs []record
	for dir := 0; dir < 2; dir++ {
		s := r.streams[dir].Bytes()
		for off := 0; off < len(s); {
			if len(s)-off < 5 {
				return nil, nil, session{}, fmt.Errorf("dir %d: truncated record header at %d", dir, off)
			}
			n := int(binary.BigEndian.Uint16(s[off+3:]))
			if len(s)-off < 5+n {
				return nil, nil, session{}, fmt.Errorf("dir %d: truncated record at %d", dir, off)
			}
			recs = append(recs, record{
				Dir: dir, Off: off, Type: int(s[off]), Version: int(binary.BigEndian.Uint16(s[off+1:])),
				Len: n, Write: writeAt(r, dir, off), ReadEv: -1, Inner: int(s[off]),
			})
			off += 5 + n
		}
	}
	// Order records by the event that wrote them, then by offset.
	sortRecords(recs, r)
	assignReads(recs, r)

	keys := map[string][]byte{}
	for _, k := range r.keylog {
		b, err := hex.DecodeString(k.Secret)
		must(err)
		keys[k.Label] = b
	}

	var sess session
	var msgs []message
	hsBuf := [2][]byte{}
	hsSrc := [2][][2]int{} // per byte: record index, offset in record plaintext
	epochs := [2][]string{
		{"CLIENT_EARLY_TRAFFIC_SECRET", "CLIENT_HANDSHAKE_TRAFFIC_SECRET", "CLIENT_TRAFFIC_SECRET_0"},
		{"SERVER_HANDSHAKE_TRAFFIC_SECRET", "SERVER_TRAFFIC_SECRET_0"},
	}
	cur := [2]int{}
	seq := [2]int{}
	cipherOn := [2]bool{} // TLS 1.2: after ChangeCipherSpec
	label := [2]string{"plaintext", "plaintext"}

	for i := range recs {
		rec := &recs[i]
		s := r.streams[rec.Dir].Bytes()
		payload := s[rec.Off+5 : rec.Off+5+rec.Len]
		header := s[rec.Off : rec.Off+5]
		rec.plain = payload
		rec.Raw = hex.EncodeToString(s[rec.Off : rec.Off+5+rec.Len])

		switch {
		case sess.version == 0x0304 && rec.Type == ctApplicationData:
			spec := tls13Suites[sess.suite]
			opened := false
			for cur[rec.Dir] < len(epochs[rec.Dir]) {
				name := epochs[rec.Dir][cur[rec.Dir]]
				secret, ok := keys[name]
				if !ok {
					cur[rec.Dir]++
					seq[rec.Dir] = 0
					continue
				}
				key := expandLabel(spec.hash, secret, "key", nil, spec.keyLen)
				iv := expandLabel(spec.hash, secret, "iv", nil, 12)
				nonce := xorSeq(iv, seq[rec.Dir])
				pt, err := newAEAD(spec, key).Open(nil, nonce, payload, header)
				if err != nil {
					cur[rec.Dir]++
					seq[rec.Dir] = 0
					continue
				}
				pad := 0
				for len(pt) > 0 && pt[len(pt)-1] == 0 {
					pt = pt[:len(pt)-1]
					pad++
				}
				rec.Inner = int(pt[len(pt)-1])
				rec.plain = pt[:len(pt)-1]
				rec.Padding = pad
				rec.Prot = &protection{
					Secret: name, Seq: seq[rec.Dir], Key: hex.EncodeToString(key), IV: hex.EncodeToString(iv),
					Nonce: hex.EncodeToString(nonce), AAD: hex.EncodeToString(header),
					Tag: hex.EncodeToString(payload[len(payload)-16:]),
				}
				label[rec.Dir] = name
				seq[rec.Dir]++
				opened = true
				break
			}
			if !opened {
				return nil, nil, sess, fmt.Errorf("record %d (dir %d): no traffic secret opens it", i, rec.Dir)
			}
		case sess.version != 0x0304 && cipherOn[rec.Dir]:
			spec, ok := tls12Suites[sess.suite]
			if !ok {
				return nil, nil, sess, fmt.Errorf("cipher suite %#04x is not supported by the decoder", sess.suite)
			}
			master := keys["CLIENT_RANDOM"]
			kb := prf12(spec.hash, master, "key expansion", append(append([]byte{}, sess.serverRandom...), sess.clientRandom...), 2*spec.keyLen+2*ivLen12(spec))
			key := kb[rec.Dir*spec.keyLen : (rec.Dir+1)*spec.keyLen]
			iv := kb[2*spec.keyLen+rec.Dir*ivLen12(spec) : 2*spec.keyLen+(rec.Dir+1)*ivLen12(spec)]
			var nonce, explicit, ct []byte
			if spec.chacha {
				nonce, ct = xorSeq(iv, seq[rec.Dir]), payload
			} else {
				explicit, ct = payload[:8], payload[8:]
				nonce = append(append([]byte{}, iv...), explicit...)
			}
			aad := binary.BigEndian.AppendUint64(nil, uint64(seq[rec.Dir]))
			aad = append(aad, header[:3]...)
			aad = binary.BigEndian.AppendUint16(aad, uint16(len(ct)-16))
			pt, err := newAEAD(spec, key).Open(nil, nonce, ct, aad)
			if err != nil {
				return nil, nil, sess, fmt.Errorf("record %d (dir %d): TLS 1.2 open: %v", i, rec.Dir, err)
			}
			rec.plain = pt
			rec.Prot = &protection{
				Secret: "CLIENT_RANDOM", Seq: seq[rec.Dir], Key: hex.EncodeToString(key), IV: hex.EncodeToString(iv),
				Nonce: hex.EncodeToString(nonce), AAD: hex.EncodeToString(aad), Tag: hex.EncodeToString(ct[len(ct)-16:]),
				ExplicitNonce: hex.EncodeToString(explicit),
			}
			label[rec.Dir] = "CLIENT_RANDOM"
			seq[rec.Dir]++
		}
		if rec.Type == ctChangeCipherSpec && sess.version != 0x0304 {
			cipherOn[rec.Dir] = true
			seq[rec.Dir] = 0
		}
		rec.Plain = hex.EncodeToString(rec.plain)

		if rec.Inner != ctHandshake {
			continue
		}
		for k := range rec.plain {
			hsSrc[rec.Dir] = append(hsSrc[rec.Dir], [2]int{i, k})
		}
		hsBuf[rec.Dir] = append(hsBuf[rec.Dir], rec.plain...)
		for len(hsBuf[rec.Dir]) >= 4 {
			b := hsBuf[rec.Dir]
			n := 4 + (int(b[1])<<16 | int(b[2])<<8 | int(b[3]))
			if len(b) < n {
				break
			}
			m := message{Dir: rec.Dir, Type: int(b[0]), Data: hex.EncodeToString(b[:n]), Epoch: label[rec.Dir]}
			src := hsSrc[rec.Dir][:n]
			for k := 0; k < n; {
				j := k
				for j < n && src[j][0] == src[k][0] {
					j++
				}
				m.Parts = append(m.Parts, [3]int{src[k][0], src[k][1], src[j-1][1] + 1})
				k = j
			}
			learn(&sess, rec.Dir, b[:n])
			msgs = append(msgs, m)
			hsBuf[rec.Dir] = b[n:]
			hsSrc[rec.Dir] = hsSrc[rec.Dir][n:]
		}
	}
	return recs, msgs, sess, nil
}

func ivLen12(spec aeadSpec) int {
	if spec.chacha {
		return 12
	}
	return 4
}

func xorSeq(iv []byte, seq int) []byte {
	n := append([]byte{}, iv...)
	var s [8]byte
	binary.BigEndian.PutUint64(s[:], uint64(seq))
	for k := 0; k < 8; k++ {
		n[len(n)-8+k] ^= s[k]
	}
	return n
}

// learn extracts the negotiated version, suite, and randoms from hello
// messages, which is all the decoder needs to pick keys.
func learn(s *session, dir int, m []byte) {
	body := m[4:]
	switch {
	case m[0] == 1 && dir == client:
		s.clientRandom = append([]byte{}, body[2:34]...)
	case m[0] == 2 && dir == server:
		// A HelloRetryRequest is a ServerHello with a fixed random; it fixes
		// the version and suite but not the server random.
		if random := body[2:34]; !bytes.Equal(random, hrrRandom) {
			s.serverRandom = append([]byte{}, random...)
		}
		p := 34
		p += 1 + int(body[p])
		s.suite = binary.BigEndian.Uint16(body[p:])
		s.version = binary.BigEndian.Uint16(body[0:])
		p += 3
		if p+2 > len(body) {
			return
		}
		ext := body[p+2:]
		for len(ext) >= 4 {
			typ := binary.BigEndian.Uint16(ext)
			n := int(binary.BigEndian.Uint16(ext[2:]))
			if typ == 43 && n == 2 {
				s.version = binary.BigEndian.Uint16(ext[4:])
			}
			ext = ext[4+n:]
		}
	}
}

func writeAt(r *recorder, dir, off int) int {
	for i, w := range r.writes {
		if w.Side == dir && off >= w.Offset && off < w.Offset+w.Len {
			return i
		}
	}
	return -1
}

func sortRecords(recs []record, r *recorder) {
	key := func(x record) int { return r.writes[x.Write].Event }
	for i := 1; i < len(recs); i++ {
		for j := i; j > 0; j-- {
			a, b := recs[j-1], recs[j]
			if key(a) > key(b) || (key(a) == key(b) && a.Off > b.Off) {
				recs[j-1], recs[j] = b, a
			} else {
				break
			}
		}
	}
}

// assignReads finds, for every record, the read event during which the
// receiver had consumed its last byte.
func assignReads(recs []record, r *recorder) {
	consumed := [2]int{}
	for ev, e := range r.events {
		if e[0] != evRead {
			continue
		}
		side := e[1].(int)
		consumed[side] += e[2].(int)
		for i := range recs {
			if recs[i].Dir == 1-side && recs[i].ReadEv < 0 && recs[i].Off+5+recs[i].Len <= consumed[side] {
				recs[i].ReadEv = ev
			}
		}
	}
}
