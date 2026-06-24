package main

// Anonymous booth analytics. The phone surface POSTs small funnel events to
// /api/event; the server appends them as NDJSON to <CONTENT_DIR>/events.ndjson.
// /api/stats (auth-gated, same Bearer credential as publishing) reads that log
// back and returns aggregates for the admin "Report" tab.
//
// Privacy: NO personally-identifying data is accepted or stored. `sid` is an
// opaque per-device random id used only to dedupe refreshes within the funnel;
// household numbers are anonymous counts. Unknown event types and prop keys are
// dropped, so a malicious client can't bloat or poison the log.

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The only funnel events we record. Anything else is rejected.
var eventTypes = map[string]bool{
	"plan_open":      true, // phone landed on the planner (reach)
	"plan_generated": true, // form submitted, list shown (engagement)
	"pdf_download":   true, // downloaded the PDF (takeaway)
	"email_sent":     true, // emailed the list (takeaway)
}

type inEvent struct {
	Type  string         `json:"type"`
	Sid   string         `json:"sid"`
	Props map[string]any `json:"props,omitempty"`
}

type storedEvent struct {
	Ts    string         `json:"ts"`
	Event string         `json:"event"`
	Type  string         `json:"type"`
	Sid   string         `json:"sid"`
	Props map[string]any `json:"props,omitempty"`
}

// eventHandler appends one sanitized event line per request. Best-effort and
// always cheap: the client fires these fire-and-forget, so we never block or
// error loudly — a bad body is a quiet 400, a full disk a quiet 500.
func eventHandler(eventsFile string, eventName func() string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cors(w)
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<10)) // 4 KB is plenty
		if err != nil {
			http.Error(w, `{"error":"body too large"}`, http.StatusRequestEntityTooLarge)
			return
		}
		var ev inEvent
		if json.Unmarshal(body, &ev) != nil || !eventTypes[ev.Type] {
			http.Error(w, `{"error":"bad event"}`, http.StatusBadRequest)
			return
		}
		rec := storedEvent{
			Ts:    time.Now().UTC().Format(time.RFC3339),
			Event: eventName(),
			Type:  ev.Type,
			Sid:   sanitizeSid(ev.Sid),
			Props: sanitizeProps(ev.Props),
		}
		line, _ := json.Marshal(rec)
		if err := os.MkdirAll(filepath.Dir(eventsFile), 0o755); err != nil {
			http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
			return
		}
		// Disk guard: this route is public + unauthenticated, so cap the log so a
		// flood can't fill the disk. Past the ceiling we silently drop new events
		// (the admin can clear the log from the Report tab → DELETE /api/stats).
		const maxEventsBytes = 25 << 20 // 25 MB
		if fi, statErr := os.Stat(eventsFile); statErr == nil && fi.Size() >= maxEventsBytes {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		f, err := os.OpenFile(eventsFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			http.Error(w, `{"error":"storage unavailable"}`, http.StatusInternalServerError)
			return
		}
		_, _ = f.Write(append(line, '\n'))
		_ = f.Close()
		w.WriteHeader(http.StatusNoContent)
	}
}

// sanitizeSid keeps an opaque id short and free of anything log-breaking.
func sanitizeSid(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 64 {
		s = s[:64]
	}
	clean := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		default:
			return -1
		}
	}, s)
	if clean == "" {
		return "anon"
	}
	return clean
}

// sanitizeProps allows only the known anonymous household fields, clamping
// counts to a sane range so the log can't be inflated with junk.
func sanitizeProps(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := map[string]any{}
	for _, k := range []string{"people", "children", "infants", "pets"} {
		if v, ok := in[k].(float64); ok {
			n := int(v)
			if n < 0 {
				n = 0
			}
			if n > 99 {
				n = 99
			}
			out[k] = n
		}
	}
	if v, ok := in["medical"].(bool); ok {
		out["medical"] = v
	}
	if raw, ok := in["hazards"].([]any); ok {
		var hz []string
		for i, h := range raw {
			if i >= 12 {
				break
			}
			if s, ok := h.(string); ok && len(s) <= 32 {
				hz = append(hz, s)
			}
		}
		if hz != nil {
			out["hazards"] = hz
		}
	}
	// Anonymous per-item Have-it/Need data on a takeaway: lists of planner item
	// ids (not PII — they're config keys like "water-case"). Capped in count and
	// length so the log can't be inflated.
	for _, key := range []string{"plan", "have"} {
		if raw, ok := in[key].([]any); ok {
			var ids []string
			for i, v := range raw {
				if i >= 80 {
					break
				}
				if s, ok := v.(string); ok && len(s) <= 48 {
					ids = append(ids, s)
				}
			}
			if ids != nil {
				out[key] = ids
			}
		}
	}
	return out
}

type dayAgg struct {
	planOpens, plansGenerated int
	takeawaySids              map[string]bool
	peopleBySid               map[string]int
}

// statsHandler reads the event log and returns the report aggregates. Dedupes
// "takeaways" and "people covered" by sid so a refresh or a download-then-email
// in one session counts once. Optional query params scope the report:
// `event` (exact booth-event name), `from`/`to` (YYYY-MM-DD, inclusive). The
// full list of distinct event names is always returned for the picker.
func statsHandler(eventsFile string, eventName func() string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		q := r.URL.Query()
		filterEvent := q.Get("event")
		from := q.Get("from")
		to := q.Get("to")
		scope := eventName()
		if filterEvent != "" {
			scope = filterEvent
		}

		f, err := os.Open(eventsFile)
		if err != nil {
			// No events yet — return an empty-but-valid report.
			_, _ = w.Write([]byte(`{"event":` + jsonString(scope) + `,"totals":{},"byDay":[],"byHour":[],"items":[],"hazards":[],"events":[]}`))
			return
		}
		defer f.Close()

		var totalOpens, totalGen, totalPdf, totalEmail int
		genSids := map[string]bool{}
		takeawaySids := map[string]bool{}
		kidSids := map[string]bool{}
		infantSids := map[string]bool{}
		petSids := map[string]bool{}
		medicalSids := map[string]bool{}
		peopleBySid := map[string]int{}
		days := map[string]*dayAgg{}
		hours := map[string]*[2]int{}          // "HH" -> {opens, plans}
		hazardSids := map[string]map[string]bool{} // hazard id -> set of sids
		planBySid := map[string][]string{}     // takeaway: item ids in the plan
		haveBySid := map[string][]string{}     // takeaway: item ids marked "Have it"
		eventsSet := map[string]bool{}
		var first, last string

		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
		for sc.Scan() {
			var e storedEvent
			if json.Unmarshal(sc.Bytes(), &e) != nil {
				continue
			}
			if e.Event != "" {
				eventsSet[e.Event] = true // collect ALL events for the picker, pre-filter
			}
			if filterEvent != "" && e.Event != filterEvent {
				continue
			}
			date := e.Ts
			if len(date) >= 10 {
				date = date[:10]
			}
			if (from != "" && date < from) || (to != "" && date > to) {
				continue
			}
			hour := ""
			if len(e.Ts) >= 13 {
				hour = e.Ts[11:13]
			}
			if first == "" || e.Ts < first {
				first = e.Ts
			}
			if e.Ts > last {
				last = e.Ts
			}
			d := days[date]
			if d == nil {
				d = &dayAgg{takeawaySids: map[string]bool{}, peopleBySid: map[string]int{}}
				days[date] = d
			}
			h := hours[hour]
			if h == nil {
				h = &[2]int{}
				hours[hour] = h
			}
			switch e.Type {
			case "plan_open":
				totalOpens++
				d.planOpens++
				h[0]++
			case "plan_generated":
				totalGen++
				d.plansGenerated++
				h[1]++
				genSids[e.Sid] = true
				people := propInt(e.Props, "people")
				peopleBySid[e.Sid] = people // last write wins → dedupes refreshes
				d.peopleBySid[e.Sid] = people
				if propInt(e.Props, "children")+propInt(e.Props, "infants") > 0 {
					kidSids[e.Sid] = true
				}
				if propInt(e.Props, "infants") > 0 {
					infantSids[e.Sid] = true
				}
				if propInt(e.Props, "pets") > 0 {
					petSids[e.Sid] = true
				}
				if b, ok := e.Props["medical"].(bool); ok && b {
					medicalSids[e.Sid] = true
				}
				for _, hz := range propStrings(e.Props, "hazards") {
					if hazardSids[hz] == nil {
						hazardSids[hz] = map[string]bool{}
					}
					hazardSids[hz][e.Sid] = true
				}
			case "pdf_download", "email_sent":
				if e.Type == "pdf_download" {
					totalPdf++
				} else {
					totalEmail++
				}
				takeawaySids[e.Sid] = true
				d.takeawaySids[e.Sid] = true
				if p := propStrings(e.Props, "plan"); p != nil {
					planBySid[e.Sid] = p // last takeaway wins
					haveBySid[e.Sid] = propStrings(e.Props, "have")
				}
			}
		}

		peopleCovered := 0
		for _, n := range peopleBySid {
			peopleCovered += n
		}
		families := len(genSids)
		takeaways := len(takeawaySids)
		rate := 0.0
		if families > 0 {
			rate = float64(takeaways) / float64(families)
		}

		// Per-item Have-vs-Need across families that left with a plan.
		itemAppeared := map[string]int{}
		itemHave := map[string]int{}
		for sid, plan := range planBySid {
			haveSet := map[string]bool{}
			for _, id := range haveBySid[sid] {
				haveSet[id] = true
			}
			for _, id := range plan {
				itemAppeared[id]++
				if haveSet[id] {
					itemHave[id]++
				}
			}
		}

		type dayRow struct {
			Date           string `json:"date"`
			PlanOpens      int    `json:"planOpens"`
			PlansGenerated int    `json:"plansGenerated"`
			Takeaways      int    `json:"takeaways"`
			PeopleCovered  int    `json:"peopleCovered"`
		}
		dates := sortedKeys(days)
		byDay := make([]dayRow, 0, len(dates))
		for _, dt := range dates {
			d := days[dt]
			p := 0
			for _, n := range d.peopleBySid {
				p += n
			}
			byDay = append(byDay, dayRow{dt, d.planOpens, d.plansGenerated, len(d.takeawaySids), p})
		}

		byHour := make([]map[string]any, 0, len(hours))
		for _, hh := range sortedKeysHours(hours) {
			byHour = append(byHour, map[string]any{"hour": hh, "planOpens": hours[hh][0], "plansGenerated": hours[hh][1]})
		}

		items := make([]map[string]any, 0, len(itemAppeared))
		for _, id := range sortedKeysInt(itemAppeared) {
			items = append(items, map[string]any{"id": id, "appeared": itemAppeared[id], "have": itemHave[id]})
		}

		hazards := make([]map[string]any, 0, len(hazardSids))
		for _, id := range sortedKeysSet(hazardSids) {
			hazards = append(hazards, map[string]any{"id": id, "count": len(hazardSids[id])})
		}

		eventsList := make([]string, 0, len(eventsSet))
		for e := range eventsSet {
			eventsList = append(eventsList, e)
		}
		sort.Strings(eventsList)

		out := map[string]any{
			"event":  scope,
			"events": eventsList,
			"range":  map[string]string{"from": first, "to": last},
			"totals": map[string]any{
				"planOpens":           totalOpens,
				"plansGenerated":      totalGen,
				"pdfDownloads":        totalPdf,
				"emailsSent":          totalEmail,
				"takeaways":           takeaways,
				"takeawayRate":        rate,
				"peopleCovered":       peopleCovered,
				"families":            families,
				"familiesWithKids":    len(kidSids),
				"familiesWithInfants": len(infantSids),
				"familiesWithPets":    len(petSids),
				"familiesWithMedical": len(medicalSids),
			},
			"byDay":   byDay,
			"byHour":  byHour,
			"items":   items,
			"hazards": hazards,
		}
		_ = json.NewEncoder(w).Encode(out)
	}
}

// propStrings reads a string-array prop (stored as []any after JSON round-trip).
func propStrings(p map[string]any, k string) []string {
	if p == nil {
		return nil
	}
	raw, ok := p[k].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func sortedKeys(m map[string]*dayAgg) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}
func sortedKeysHours(m map[string]*[2]int) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}
func sortedKeysInt(m map[string]int) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}
func sortedKeysSet(m map[string]map[string]bool) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// clearHandler deletes the events file, resetting the report to zero. Auth-gated
// (same credential as publishing). The file is removed rather than truncated so
// that a fresh event write recreates it cleanly.
func clearHandler(eventsFile string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		err := os.Remove(eventsFile)
		if err != nil && !os.IsNotExist(err) {
			http.Error(w, `{"error":"could not clear events"}`, http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func propInt(p map[string]any, k string) int {
	if p == nil {
		return 0
	}
	switch v := p[k].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return 0
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
