//go:build tlstrace

package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"math/big"
	"time"
)

// pki is a three-level chain like the ones public sites serve: a root the
// client trusts, an intermediate, and the leaf for the server name.
type pki struct {
	roots *x509.CertPool
	chain tls.Certificate
	certs []*x509.Certificate // leaf, intermediate, root
}

type certInfo struct {
	Role      string   `json:"role"`
	Subject   string   `json:"subject"`
	Issuer    string   `json:"issuer"`
	Serial    string   `json:"serial"`
	NotBefore string   `json:"notBefore"`
	NotAfter  string   `json:"notAfter"`
	DNSNames  []string `json:"dnsNames,omitempty"`
	KeyAlg    string   `json:"keyAlg"`
	SigAlg    string   `json:"sigAlg"`
	IsCA      bool     `json:"isCA"`
	SHA256    string   `json:"sha256"`
	DER       string   `json:"der"`
	OnWire    bool     `json:"onWire"`
}

func newPKI(rsaKeys bool, now time.Time) *pki {
	gen := func() crypto.Signer {
		if rsaKeys {
			k, err := rsa.GenerateKey(rand.Reader, 2048)
			must(err)
			return k
		}
		k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		must(err)
		return k
	}
	serial := int64(0x7c1a)
	issue := func(tmpl *x509.Certificate, key crypto.Signer, parent *x509.Certificate, parentKey crypto.Signer) *x509.Certificate {
		serial++
		tmpl.SerialNumber = big.NewInt(serial)
		if parent == nil {
			parent, parentKey = tmpl, key
		}
		der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, key.Public(), parentKey)
		must(err)
		c, err := x509.ParseCertificate(der)
		must(err)
		return c
	}

	rootKey, interKey, leafKey := gen(), gen(), gen()
	root := issue(&x509.Certificate{
		Subject:               pkix.Name{Organization: []string{"TLS Companion"}, CommonName: "TLS Companion Root CA"},
		NotBefore:             now.AddDate(-5, 0, 0),
		NotAfter:              now.AddDate(15, 0, 0),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}, rootKey, nil, nil)
	inter := issue(&x509.Certificate{
		Subject:               pkix.Name{Organization: []string{"TLS Companion"}, CommonName: "TLS Companion Issuing CA E1"},
		NotBefore:             now.AddDate(-1, 0, 0),
		NotAfter:              now.AddDate(4, 0, 0),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLenZero:        true,
	}, interKey, root, rootKey)
	leafUsage := x509.KeyUsageDigitalSignature
	if rsaKeys {
		// RSA key exchange encrypts the premaster secret to the leaf key.
		leafUsage |= x509.KeyUsageKeyEncipherment
	}
	leaf := issue(&x509.Certificate{
		Subject:     pkix.Name{CommonName: serverName},
		DNSNames:    []string{serverName, "www." + serverName},
		NotBefore:   now.AddDate(0, 0, -30),
		NotAfter:    now.AddDate(0, 0, 170),
		KeyUsage:    leafUsage,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}, leafKey, inter, interKey)

	roots := x509.NewCertPool()
	roots.AddCert(root)
	return &pki{
		roots: roots,
		chain: tls.Certificate{Certificate: [][]byte{leaf.Raw, inter.Raw}, PrivateKey: leafKey, Leaf: leaf},
		certs: []*x509.Certificate{leaf, inter, root},
	}
}

func (p *pki) info() []certInfo {
	roles := []string{"leaf", "intermediate", "root"}
	var out []certInfo
	for i, c := range p.certs {
		sum := sha256.Sum256(c.Raw)
		out = append(out, certInfo{
			Role:      roles[i],
			Subject:   c.Subject.String(),
			Issuer:    c.Issuer.String(),
			Serial:    c.SerialNumber.Text(16),
			NotBefore: c.NotBefore.UTC().Format(time.RFC3339),
			NotAfter:  c.NotAfter.UTC().Format(time.RFC3339),
			DNSNames:  c.DNSNames,
			KeyAlg:    c.PublicKeyAlgorithm.String(),
			SigAlg:    c.SignatureAlgorithm.String(),
			IsCA:      c.IsCA,
			SHA256:    hex.EncodeToString(sum[:]),
			DER:       hex.EncodeToString(c.Raw),
			OnWire:    i < 2,
		})
	}
	return out
}
