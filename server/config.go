package main

// Self-sufficient runtime config. Operator-tunable settings (event name, email
// webhook, admin passphrase) live in <CONTENT_DIR>/config.json so the binary no
// longer depends on its launch environment for them. On first boot the file is
// seeded from the env vars (EVENT_NAME / EMAIL_WEBHOOK_URL / ADMIN_PASSPHRASE)
// so existing deployments keep working, then it becomes the source of truth.
//
// Bootstrap-only settings (PORT, CONTENT_DIR) and the auth MODE (passphrase vs
// Entra SSO) stay env-driven — they're needed before config loads, or change how
// you'd reach this page at all.
//
// The passphrase is never stored in plaintext: it's a salted, iterated SHA-256
// digest (stdlib only — no bcrypt dependency). Adequate for a low-value booth
// gate; constant-time compared on verify.

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

type resourceLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type appConfig struct {
	mu             sync.RWMutex
	eventName      string
	emailWebhook   string
	passphraseHash string // "s2$<iter>$<saltB64>$<hashB64>"; empty = no config passphrase
	emailNextSteps []string       // "Go further" actions shown in the plan email
	emailResources []resourceLink // resource links shown in the plan email
	path           string
	writeMu        sync.Mutex // serializes persist() so concurrent writes never share the .tmp
}

// validWebhookURL guards the email webhook against SSRF. The webhook is the one
// URL the server makes outbound requests to with caller-influenced bodies, so
// require https to a public host and reject loopback / private / link-local
// targets and obvious internal names. It's admin-set, so this is defense in
// depth (a literal-IP / localhost check, not a DNS-rebinding–proof resolver).
func validWebhookURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return false
		}
	}
	return true
}

type configFile struct {
	EventName      string         `json:"eventName"`
	EmailWebhook   string         `json:"emailWebhookUrl"`
	PassphraseHash string         `json:"passphraseHash"`
	EmailNextSteps []string       `json:"emailNextSteps,omitempty"`
	EmailResources []resourceLink `json:"emailResources,omitempty"`
}

// Built-in defaults for the plan email's "Go further" + "Resources" sections.
// Kept generic (no region-specific links) so any booth can use them as-is; the
// operator can override them in the admin Config tab. When the operator's list
// is empty these are used, so the email always carries useful next steps.
var defaultEmailNextSteps = []string{
	"Make a family communication plan — agree on how you'll reach each other and where you'll meet.",
	"Learn the evacuation routes out of your neighborhood.",
	"Sign up for emergency alerts from your local authorities.",
	"Re-check your kit twice a year and replace anything expired.",
}

var defaultEmailResources = []resourceLink{
	{Label: "Ready.gov", URL: "https://www.ready.gov"},
	{Label: "Red Cross — How to Prepare", URL: "https://www.redcross.org/get-help/how-to-prepare-for-emergencies.html"},
	{Label: "FEMA app", URL: "https://www.fema.gov/about/news-multimedia/mobile-products"},
}

// loadConfig reads config.json, seeding it from env defaults the first time so an
// env-based deployment transparently becomes self-sufficient.
func loadConfig(dir, envEvent, envEmail, envPassphrase string) *appConfig {
	c := &appConfig{path: filepath.Join(dir, "config.json"), eventName: envEvent, emailWebhook: envEmail}
	if data, err := os.ReadFile(c.path); err == nil {
		var f configFile
		if json.Unmarshal(data, &f) == nil {
			if f.EventName != "" {
				c.eventName = f.EventName
			}
			c.emailWebhook = f.EmailWebhook // authoritative once the file exists (empty = disabled)
			c.passphraseHash = f.PassphraseHash
			c.emailNextSteps = f.EmailNextSteps // empty → accessor falls back to defaults
			c.emailResources = f.EmailResources
		}
		return c
	}
	// First run — seed from env. Hash the env passphrase so it's never on disk plain.
	if envPassphrase != "" {
		c.passphraseHash = hashPassphrase(envPassphrase)
	}
	_ = c.persist() // best-effort; we still run from these in-memory values if it fails
	return c
}

func (c *appConfig) EventName() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.eventName == "" {
		return "booth"
	}
	return c.eventName
}

func (c *appConfig) EmailWebhook() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.emailWebhook
}

func (c *appConfig) EmailEnabled() bool { return c.EmailWebhook() != "" }

// EmailNextSteps / EmailResources return the operator's list, or the built-in
// defaults when none is set, so the plan email always has content.
func (c *appConfig) EmailNextSteps() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.emailNextSteps) == 0 {
		return defaultEmailNextSteps
	}
	return c.emailNextSteps
}

func (c *appConfig) EmailResources() []resourceLink {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.emailResources) == 0 {
		return defaultEmailResources
	}
	return c.emailResources
}

func (c *appConfig) passphraseSet() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.passphraseHash != ""
}

func (c *appConfig) verifyPassphrase(tok string) bool {
	c.mu.RLock()
	h := c.passphraseHash
	c.mu.RUnlock()
	if h == "" {
		return false
	}
	return verifyPassphrase(tok, h)
}

func (c *appConfig) persist() error {
	// Serialize writers so two concurrent persists can't interleave on the shared
	// ".tmp" path; the snapshot is still read under the data lock.
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.mu.RLock()
	f := configFile{
		EventName:      c.eventName,
		EmailWebhook:   c.emailWebhook,
		PassphraseHash: c.passphraseHash,
		EmailNextSteps: c.emailNextSteps,
		EmailResources: c.emailResources,
	}
	path := c.path
	c.mu.RUnlock()
	data, _ := json.MarshalIndent(f, "", "  ")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil { // 0600 — holds the webhook + passphrase hash
		return err
	}
	return os.Rename(tmp, path)
}

// ── passphrase hashing (stdlib salted-iterated SHA-256) ──────────────────

const passIter = 200_000

func derive(pass string, salt []byte, iter int) []byte {
	seed := append(append([]byte{}, salt...), []byte(pass)...)
	cur := sha256.Sum256(seed)
	for i := 1; i < iter; i++ {
		cur = sha256.Sum256(cur[:])
	}
	return cur[:]
}

func hashPassphrase(pass string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	h := derive(pass, salt, passIter)
	enc := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("s2$%d$%s$%s", passIter, enc(salt), enc(h))
}

func verifyPassphrase(pass, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "s2" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 || iter > 5_000_000 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	return subtle.ConstantTimeCompare(derive(pass, salt, iter), want) == 1
}

// maskURL shows just enough of a webhook to recognize it, never the full secret.
func maskURL(u string) string {
	if u == "" {
		return ""
	}
	if len(u) <= 12 {
		return "••••"
	}
	host := u
	if i := strings.Index(u, "://"); i >= 0 {
		rest := u[i+3:]
		if j := strings.IndexByte(rest, '/'); j >= 0 {
			host = u[:i+3+j]
		}
	}
	return host + "/…" + u[len(u)-5:]
}

// ── HTTP handlers (wired behind authOK in main.go) ───────────────────────

func configGetHandler(cfg *appConfig, authMode, port, dir string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"eventName":          cfg.EventName(),
			"emailWebhookSet":    cfg.EmailEnabled(),
			"emailWebhookMasked": maskURL(cfg.EmailWebhook()),
			"emailNextSteps":     cfg.EmailNextSteps(),
			"emailResources":     cfg.EmailResources(),
			"passphraseSet":      cfg.passphraseSet(),
			"authMode":           authMode,
			"port":               port,
			"contentDir":         dir,
		})
	}
}

type configUpdate struct {
	EventName         *string         `json:"eventName"`
	EmailWebhookURL   *string         `json:"emailWebhookUrl"`
	EmailNextSteps    *[]string       `json:"emailNextSteps"`
	EmailResources    *[]resourceLink `json:"emailResources"`
	CurrentPassphrase *string         `json:"currentPassphrase"`
	NewPassphrase     *string         `json:"newPassphrase"`
}

// cleanStrings trims, drops blanks, caps length and count.
func cleanStrings(in []string, maxN, maxLen int) []string {
	out := []string{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if len(s) > maxLen {
			s = s[:maxLen]
		}
		out = append(out, s)
		if len(out) >= maxN {
			break
		}
	}
	return out
}

// cleanResources keeps only well-formed http(s) links, trimmed and capped.
func cleanResources(in []resourceLink, maxN int) []resourceLink {
	out := []resourceLink{}
	for _, r := range in {
		label := strings.TrimSpace(r.Label)
		u := strings.TrimSpace(r.URL)
		if label == "" || u == "" {
			continue
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			continue
		}
		if len(label) > 80 {
			label = label[:80]
		}
		if len(u) > 300 {
			u = u[:300]
		}
		out = append(out, resourceLink{Label: label, URL: u})
		if len(out) >= maxN {
			break
		}
	}
	return out
}

// configPostHandler applies a partial update (only the fields present in the
// body). Changing the passphrase requires proving the current one.
func configPostHandler(cfg *appConfig, envPassphrase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if err != nil {
			http.Error(w, `{"error":"body too large"}`, http.StatusRequestEntityTooLarge)
			return
		}
		var u configUpdate
		if json.Unmarshal(body, &u) != nil {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}

		// Reject an unsafe webhook before touching state (empty = disable email).
		if u.EmailWebhookURL != nil {
			if wh := strings.TrimSpace(*u.EmailWebhookURL); wh != "" && !validWebhookURL(wh) {
				http.Error(w, `{"error":"email webhook must be an https:// URL to a public host"}`, http.StatusBadRequest)
				return
			}
		}

		if u.NewPassphrase != nil && *u.NewPassphrase != "" {
			cur := ""
			if u.CurrentPassphrase != nil {
				cur = *u.CurrentPassphrase
			}
			// Verify against the config hash, or the env passphrase if not yet set in config.
			ok := cfg.verifyPassphrase(cur)
			if !cfg.passphraseSet() && envPassphrase != "" {
				ok = subtle.ConstantTimeCompare([]byte(cur), []byte(envPassphrase)) == 1
			}
			if !ok {
				http.Error(w, `{"error":"current passphrase is incorrect"}`, http.StatusForbidden)
				return
			}
			if len(*u.NewPassphrase) < 6 {
				http.Error(w, `{"error":"new passphrase must be at least 6 characters"}`, http.StatusBadRequest)
				return
			}
			cfg.mu.Lock()
			cfg.passphraseHash = hashPassphrase(*u.NewPassphrase)
			cfg.mu.Unlock()
		}

		cfg.mu.Lock()
		if u.EventName != nil {
			cfg.eventName = strings.TrimSpace(*u.EventName)
		}
		if u.EmailWebhookURL != nil {
			cfg.emailWebhook = strings.TrimSpace(*u.EmailWebhookURL)
		}
		if u.EmailNextSteps != nil {
			cfg.emailNextSteps = cleanStrings(*u.EmailNextSteps, 8, 300)
		}
		if u.EmailResources != nil {
			cfg.emailResources = cleanResources(*u.EmailResources, 8)
		}
		cfg.mu.Unlock()

		if err := cfg.persist(); err != nil {
			http.Error(w, `{"error":"could not save config"}`, http.StatusInternalServerError)
			return
		}
		w.Write([]byte(`{"status":"ok"}`))
	}
}
