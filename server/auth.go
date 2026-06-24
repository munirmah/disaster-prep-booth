package main

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

// entraAuth validates Microsoft Entra (M365) v2.0 ID tokens with the standard
// library only — no JWT/JWKS dependency. It fetches and caches the tenant's
// signing keys, then checks RS256 signature + aud/iss/exp (and optionally a
// security-group membership). This is the SSO path; see checkAuth in main.go.
type entraAuth struct {
	tenantID     string
	clientID     string // expected `aud`
	allowedGroup string // optional `groups` membership requirement
	jwksURL      string
	iss          string

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

func newEntraAuth(tenantID, clientID, allowedGroup string) *entraAuth {
	return &entraAuth{
		tenantID:     tenantID,
		clientID:     clientID,
		allowedGroup: allowedGroup,
		jwksURL:      "https://login.microsoftonline.com/" + tenantID + "/discovery/v2.0/keys",
		iss:          "https://login.microsoftonline.com/" + tenantID + "/v2.0",
		keys:         map[string]*rsa.PublicKey{},
	}
}

// jwksClient fetches the tenant signing keys with a bounded timeout, so a slow
// or hung Microsoft endpoint can't wedge a validation goroutine forever.
var jwksClient = &http.Client{Timeout: 5 * time.Second}

func (e *entraAuth) publicKey(kid string) *rsa.PublicKey {
	// Read the cache under a brief lock, then RELEASE it before the network
	// call — holding the mutex across http.Get would block every concurrent
	// validation if the JWKS endpoint is slow.
	e.mu.Lock()
	cached, ok := e.keys[kid]
	fresh := time.Since(e.fetchedAt) < time.Hour
	// Unknown `kid` arriving soon after we last refreshed the key set is almost
	// always a forged/garbage token: an attacker controls the header and can
	// cycle random kids to force one outbound JWKS fetch per request. Debounce so
	// a flood of bogus kids can't amplify into an outbound-request storm. A real
	// key rollover is still discovered within the window.
	recentlyFetched := !e.fetchedAt.IsZero() && time.Since(e.fetchedAt) < 5*time.Minute
	e.mu.Unlock()
	if ok && fresh {
		return cached
	}
	if !ok && recentlyFetched {
		return nil
	}

	resp, err := jwksClient.Get(e.jwksURL)
	if err != nil {
		e.mu.Lock()
		defer e.mu.Unlock()
		return e.keys[kid] // best effort: use stale key if present
	}
	defer resp.Body.Close()
	var set struct {
		Keys []struct {
			Kid, N, E, Kty string
		} `json:"keys"`
	}
	if json.NewDecoder(resp.Body).Decode(&set) != nil {
		e.mu.Lock()
		defer e.mu.Unlock()
		return e.keys[kid]
	}
	next := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		nb, err1 := base64.RawURLEncoding.DecodeString(k.N)
		eb, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		exp := 0
		for _, b := range eb {
			exp = exp<<8 | int(b)
		}
		next[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: exp}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(next) > 0 {
		e.keys = next
		e.fetchedAt = time.Now()
	}
	return e.keys[kid]
}

// valid reports whether token is a genuine, unexpired Entra ID token for this
// app + tenant (and group, if required).
func (e *entraAuth) valid(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	var hdr struct{ Alg, Kid string }
	if json.Unmarshal(headerJSON, &hdr) != nil || hdr.Alg != "RS256" {
		return false
	}
	pub := e.publicKey(hdr.Kid)
	if pub == nil {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig) != nil {
		return false
	}
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	var c struct {
		Aud    string   `json:"aud"`
		Iss    string   `json:"iss"`
		Exp    int64    `json:"exp"`
		Groups []string `json:"groups"`
	}
	if json.Unmarshal(payloadJSON, &c) != nil {
		return false
	}
	// Allow a small clock-skew grace on expiry (NTP / hardware drift between
	// the booth host and Microsoft) — reject once we're 1 min past exp.
	if c.Aud != e.clientID || c.Iss != e.iss || time.Now().Add(-1*time.Minute).Unix() >= c.Exp {
		return false
	}
	if e.allowedGroup != "" {
		for _, g := range c.Groups {
			if g == e.allowedGroup {
				return true
			}
		}
		return false
	}
	return true
}
