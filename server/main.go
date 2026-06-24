// Command disasterprep is the single-binary host for the Humanity First
// disaster-preparedness booth app. It embeds the built SPA and exposes a tiny
// content API:
//
//	GET  /api/content  -> the published content JSON (public; booth + phones read it)
//	POST /api/content  -> replace the content (auth required; the admin publishes)
//	POST /api/email    -> proxy email request to the Power Automate webhook (EMAIL_WEBHOOK_URL)
//	GET  /api/health   -> liveness
//	GET  /*            -> the embedded SPA (HashRouter, so index.html serves all routes)
//
// Content is a single JSON blob persisted to a file on disk, with a timestamped
// backup on every write. The server treats it as opaque JSON — all schema
// validation lives in the frontend (sanitize*), which runs on every load.
//
// Auth is a shared passphrase for now (ADMIN_PASSPHRASE); Entra/M365 SSO is a
// drop-in replacement for the checkAuth function later.
package main

import (
	"bytes"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var webFS embed.FS

// contentMu serializes content writes (backup + temp-file + rename) so two
// concurrent POST /api/content calls can't race on the shared ".tmp" path or
// collide on a backup filename.
var contentMu sync.Mutex

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	var (
		port         = env("PORT", "8080")
		contentDir   = env("CONTENT_DIR", "data")
		passphrase   = os.Getenv("ADMIN_PASSPHRASE")  // bootstrap seed for the admin gate
		eventName    = env("EVENT_NAME", "booth")     // first-run default for the analytics label
		emailWebhook = os.Getenv("EMAIL_WEBHOOK_URL") // first-run default for the email webhook
		maxBody      = int64(2 << 20)                 // 2 MB cap on a content document
		// Entra/M365 SSO config — if tenant + client are set, SSO is used and
		// the passphrase is ignored.
		entraTenant = os.Getenv("ENTRA_TENANT_ID")
		entraClient = os.Getenv("ENTRA_CLIENT_ID")
		entraGroup  = os.Getenv("ENTRA_ALLOWED_GROUP") // optional
	)
	contentFile := filepath.Join(contentDir, "content.json")
	backupDir := filepath.Join(contentDir, "backups")
	eventsFile := filepath.Join(contentDir, "events.ndjson")

	// Operator-tunable settings (event name, email webhook, passphrase) live in
	// config.json, seeded from the env vars above on first run.
	cfg := loadConfig(contentDir, eventName, emailWebhook, passphrase)

	// Auto-select the auth mode from what's configured (mode stays env-driven).
	ssoEnabled := entraTenant != "" && entraClient != ""
	var entra *entraAuth
	if ssoEnabled {
		entra = newEntraAuth(entraTenant, entraClient, entraGroup)
	}
	writesEnabled := func() bool { return ssoEnabled || cfg.passphraseSet() || passphrase != "" }

	// authOK validates the request's Bearer credential per the active mode. In
	// passphrase mode the credential is checked against the config hash, falling
	// back to the (un-seeded) env passphrase.
	authOK := func(r *http.Request) bool {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if ssoEnabled {
			return entra.valid(tok)
		}
		if cfg.passphraseSet() {
			return cfg.verifyPassphrase(tok)
		}
		if passphrase == "" {
			return false
		}
		return subtle.ConstantTimeCompare([]byte(tok), []byte(passphrase)) == 1
	}
	authMode := "none"
	if ssoEnabled {
		authMode = "sso"
	} else if cfg.passphraseSet() || passphrase != "" {
		authMode = "passphrase"
	}

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}
	fileServer := http.FileServer(http.FS(sub))
	indexHTML, _ := fs.ReadFile(sub, "index.html")

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})

	// Public app config — the SPA reads this to pick the sign-in UI and to
	// discover whether email sending is enabled. tenantId/clientId are not secrets.
	mux.HandleFunc("GET /api/config", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		w.Header().Set("Content-Type", "application/json")
		// emailNextSteps / emailResources are public content (the plan email's
		// "Go further" + "Resources" sections), read by the phone to build the
		// email body. No secrets here — the webhook URL is never exposed.
		resp := map[string]any{
			"emailEnabled":   cfg.EmailEnabled(),
			"emailNextSteps": cfg.EmailNextSteps(),
			"emailResources": cfg.EmailResources(),
		}
		switch {
		case ssoEnabled:
			resp["mode"] = "sso"
			resp["tenantId"] = entraTenant
			resp["clientId"] = entraClient
		case cfg.passphraseSet() || passphrase != "":
			resp["mode"] = "passphrase"
		default:
			resp["mode"] = "none"
		}
		_ = json.NewEncoder(w).Encode(resp)
	})

	// Email proxy — the SPA POSTs the plan payload here; we forward it to the
	// Power Automate webhook. Keeping the webhook URL server-side means no
	// rebuild is needed to change it, and it never appears in the JS bundle.
	// We forward as text/plain so the existing Power Automate Parse JSON action
	// keeps working unchanged.
	emailClient := &http.Client{Timeout: 30 * time.Second}
	mux.HandleFunc("OPTIONS /api/email", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/email", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if !cfg.EmailEnabled() {
			http.Error(w, `{"error":"email not configured"}`, http.StatusServiceUnavailable)
			return
		}
		// 10 MB: generous for base64 PDF + embedded logo data URI + HTML.
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 10<<20))
		if err != nil {
			http.Error(w, `{"error":"body too large"}`, http.StatusRequestEntityTooLarge)
			return
		}
		if !json.Valid(body) {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), "POST", cfg.EmailWebhook(), bytes.NewReader(body))
		if err != nil {
			http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
			return
		}
		// text/plain avoids a CORS preflight that Power Automate can't answer,
		// and matches the Parse JSON action's expectation of a string body.
		req.Header.Set("Content-Type", "text/plain;charset=UTF-8")
		resp, err := emailClient.Do(req)
		if err != nil {
			http.Error(w, `{"error":"upstream unreachable"}`, http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, resp.Body) // drain so the connection is reusable
		w.Header().Set("Content-Type", "application/json")
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			w.Write([]byte(`{"status":"sent"}`))
		} else {
			w.WriteHeader(http.StatusBadGateway)
			w.Write([]byte(`{"error":"upstream error"}`))
		}
	})

	mux.HandleFunc("OPTIONS /api/content", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /api/content", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		data, err := os.ReadFile(contentFile)
		if err != nil {
			// No published content yet — the client falls back to its built-in default.
			http.Error(w, `{"error":"no content published"}`, http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(data)
	})

	mux.HandleFunc("POST /api/content", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if !writesEnabled() {
			http.Error(w, `{"error":"writes disabled (set ADMIN_PASSPHRASE or ENTRA_* )"}`, http.StatusForbidden)
			return
		}
		if !authOK(r) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			http.Error(w, `{"error":"body too large"}`, http.StatusRequestEntityTooLarge)
			return
		}
		if !json.Valid(body) {
			http.Error(w, `{"error":"body is not valid JSON"}`, http.StatusBadRequest)
			return
		}
		// Serialize the backup + temp-write + rename against concurrent publishes.
		contentMu.Lock()
		defer contentMu.Unlock()
		if err := os.MkdirAll(contentDir, 0o755); err != nil {
			http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
			return
		}
		// Back up the current content before overwriting.
		if old, err := os.ReadFile(contentFile); err == nil {
			_ = os.MkdirAll(backupDir, 0o755)
			ts := time.Now().UTC().Format("20060102-150405")
			_ = os.WriteFile(filepath.Join(backupDir, "content-"+ts+".json"), old, 0o644)
		}
		// Atomic write: temp file then rename.
		tmp := contentFile + ".tmp"
		if err := os.WriteFile(tmp, body, 0o644); err != nil {
			http.Error(w, `{"error":"write failed"}`, http.StatusInternalServerError)
			return
		}
		if err := os.Rename(tmp, contentFile); err != nil {
			http.Error(w, `{"error":"commit failed"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Anonymous booth analytics — phones POST funnel events here (public, like
	// reading content); the admin reads aggregates back from /api/stats. See
	// stats.go for the privacy model.
	mux.HandleFunc("OPTIONS /api/event", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/event", eventHandler(eventsFile, cfg.EventName))

	mux.HandleFunc("OPTIONS /api/stats", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/stats", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if !authOK(r) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		statsHandler(eventsFile, cfg.EventName)(w, r)
	})
	mux.HandleFunc("DELETE /api/stats", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if !authOK(r) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		clearHandler(eventsFile)(w, r)
	})

	// Self-sufficient runtime config — operator-editable settings (event name,
	// email webhook, admin passphrase) persisted to config.json. Auth-gated.
	mux.HandleFunc("OPTIONS /api/admin/config", func(w http.ResponseWriter, _ *http.Request) {
		cors(w)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/admin/config", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if !authOK(r) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		configGetHandler(cfg, authMode, port, contentDir)(w, r)
	})
	mux.HandleFunc("POST /api/admin/config", func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		if !writesEnabled() {
			http.Error(w, `{"error":"writes disabled"}`, http.StatusForbidden)
			return
		}
		if !authOK(r) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		configPostHandler(cfg, passphrase)(w, r)
	})

	// Everything else: serve the embedded SPA, falling back to index.html so
	// deep links resolve (HashRouter keeps routes in the fragment anyway).
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p != "" {
			if _, err := fs.Stat(sub, p); err == nil {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("booth server on :%s (content=%s, auth=%s, email=%v)", port, contentFile, authMode, cfg.EmailEnabled())
	log.Fatal(srv.ListenAndServe())
}

// securityHeaders sets conservative baseline headers on every response: stop
// MIME sniffing and disallow framing (the booth/phone/admin are never embedded).
// A full CSP is intentionally omitted — Tailwind v4 injects a <style> and the
// app uses data: images + lazy MSAL, so a CSP needs testing before shipping.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// cors allows the content API to be called from the Vite dev server during
// development. In production the SPA and API share an origin, so this is a no-op.
func cors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
}
