package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestPairPollFlow(t *testing.T) {
	var polls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("User-Agent"); got != "VenduaImpressora/1.2.3 ("+Platform+")" {
			t.Errorf("User-Agent = %q", got)
		}
		if r.Header.Get("X-Agent-Platform") != Platform || r.Header.Get("X-Agent-Version") != "1.2.3" {
			t.Errorf("agent headers = %v", r.Header)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Authorization") != "" {
			t.Errorf("pairing must not send Authorization")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		switch r.URL.Path {
		case "/admin/v1/agent/pair":
			if body["platform"] != Platform || body["name"] != "CAIXA-PC" || body["version"] != "1.2.3" {
				t.Errorf("pair body = %v", body)
			}
			_, _ = w.Write([]byte(`{"deviceCode":"dev-secret","userCode":"K7QD-4MXA","approveUrl":"https://x/parear?code=K7QD-4MXA","expiresIn":600,"interval":3}`))
		case "/admin/v1/agent/pair/poll":
			if body["deviceCode"] != "dev-secret" {
				t.Errorf("poll body = %v", body)
			}
			if polls.Add(1) == 1 {
				_, _ = w.Write([]byte(`{"status":"pending"}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":"approved","token":"tok-1","store":{"name":"Quero Pudim"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL+"/", "1.2.3")
	ctx := context.Background()
	pr, err := c.Pair(ctx, "CAIXA-PC")
	if err != nil {
		t.Fatal(err)
	}
	if pr.UserCode != "K7QD-4MXA" || pr.Interval != 3 || pr.ExpiresIn != 600 {
		t.Fatalf("pair = %+v", pr)
	}
	p1, err := c.PollPair(ctx, pr.DeviceCode)
	if err != nil || p1.Status != "pending" {
		t.Fatalf("first poll = %+v, %v", p1, err)
	}
	p2, err := c.PollPair(ctx, pr.DeviceCode)
	if err != nil {
		t.Fatal(err)
	}
	if p2.Status != "approved" || p2.Token != "tok-1" || p2.Store.Name != "Quero Pudim" {
		t.Fatalf("second poll = %+v", p2)
	}
}

func TestErrorsAreDecoded(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/admin/v1/agent/pair/poll":
			w.WriteHeader(http.StatusGone)
			_, _ = w.Write([]byte(`{"error":{"code":"PAIRING_EXPIRED","message":"expired"}}`))
		case "/admin/v1/agent/stream":
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"DEVICE_REVOKED","message":"revoked"}}`))
		default:
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`<html>bad gateway</html>`))
		}
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "1.0.0")
	ctx := context.Background()

	_, err := c.PollPair(ctx, "x")
	var e *Error
	if !errors.As(err, &e) || e.Status != 410 || e.Code != "PAIRING_EXPIRED" {
		t.Fatalf("poll err = %v", err)
	}
	if _, err := c.OpenStream(ctx, "tok"); !IsUnauthorized(err) {
		t.Fatalf("stream err = %v, want unauthorized", err)
	}
	if err := c.DeleteSelf(ctx, "tok"); !HasStatus(err, 502) {
		t.Fatalf("delete err = %v, want 502", err)
	}
}

func TestAuthenticatedCallsSendTokenAndIdempotencyKey(t *testing.T) {
	type seen struct{ method, path, auth, key, body string }
	got := make(chan seen, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var raw json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&raw)
		got <- seen{r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Idempotency-Key"), string(raw)}
		switch r.URL.Path {
		case "/admin/v1/agent/printers":
			_, _ = w.Write([]byte(`{"printers":[{"id":"p1","key":"tcp:10.0.0.9:9100","kind":"tcp","name":"N","address":"10.0.0.9:9100"}]}`))
		case "/admin/v1/agent/printers/p1/test":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"jobId":"j9"}`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "1.0.0")
	ctx := context.Background()

	if err := c.ReportResult(ctx, "tok", "job-1", false, "Impressora não encontrada"); err != nil {
		t.Fatal(err)
	}
	s := <-got
	if s.method != "POST" || s.path != "/admin/v1/agent/jobs/job-1/result" || s.auth != "Bearer tok" || s.key != "job-result-job-1" {
		t.Fatalf("result request = %+v", s)
	}
	if s.body != `{"error":"Impressora não encontrada","ok":false}` {
		t.Fatalf("result body = %s", s.body)
	}

	ps, err := c.PutPrinters(ctx, "tok", "k-1", nil)
	if err != nil || len(ps) != 1 || ps[0].ID != "p1" {
		t.Fatalf("put printers = %+v, %v", ps, err)
	}
	s = <-got
	if s.method != "PUT" || s.key != "k-1" || s.body != `{"printers":[]}` {
		t.Fatalf("put request = %+v", s)
	}

	id, err := c.TestPrinter(ctx, "tok", "p1")
	if err != nil || id != "j9" {
		t.Fatalf("test = %q, %v", id, err)
	}
	s = <-got
	if len(s.key) != 36 {
		t.Fatalf("test idempotency key = %q", s.key)
	}

	if err := c.DeleteSelf(ctx, "tok"); err != nil {
		t.Fatal(err)
	}
	if s = <-got; s.method != "DELETE" || s.key == "" {
		t.Fatalf("delete request = %+v", s)
	}
}
