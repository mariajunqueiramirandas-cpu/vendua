package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
)

func TestParseFriendship(t *testing.T) {
	fs, err := parseFriendship([]byte(`{"friendship_status":{"following":true,"outgoing_request":false},"status":"ok"}`), nil)
	if err != nil || !fs.Following || fs.OutgoingRequest {
		t.Fatalf("public follow: %+v %v", fs, err)
	}
	fs, err = parseFriendship([]byte(`{"friendship_status":{"following":false,"outgoing_request":true},"status":"ok"}`), nil)
	if err != nil || fs.Following || !fs.OutgoingRequest {
		t.Fatalf("private request: %+v %v", fs, err)
	}

	blocked := []struct {
		body string
		err  error
	}{
		{`{"message":"feedback_required","spam":true,"feedback_title":"Action Blocked","status":"fail"}`, fmt.Errorf("%w 400", httpclient.ErrUnexpectedError)},
		{`{"message":"feedback_required","status":"fail"}`, nil},
		{``, fmt.Errorf("%w: %w", httpclient.ErrMaxRetriesReached, httpclient.ErrRateLimited)},
	}
	for _, c := range blocked {
		if _, err := parseFriendship([]byte(c.body), c.err); !errors.Is(err, errActionBlocked) {
			t.Fatalf("%q: want action blocked, got %v", c.body, err)
		}
	}

	if _, err := parseFriendship([]byte(`{"message":"challenge_required","status":"fail"}`), httpclient.ErrChallengeRequired); !errors.Is(err, httpclient.ErrChallengeRequired) {
		t.Fatalf("a challenge must stay classifiable, got %v", err)
	} else if e, permanent := classify(err); !permanent || e.Code != "challenge" {
		t.Fatalf("classify: %+v %v", e, permanent)
	}
	for _, body := range []string{`{"status":"fail","message":"nope"}`, `not json`, ``} {
		if _, err := parseFriendship([]byte(body), nil); err == nil {
			t.Fatalf("%q: want an error", body)
		}
	}
}

func TestPacerSpacesActions(t *testing.T) {
	p := &pacer{gap: 40 * time.Millisecond}
	ctx := context.Background()
	start := time.Now()
	for range 3 {
		if err := p.do(ctx, func() error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	// first runs at once, the next two wait ≥ gap each
	if d := time.Since(start); d < 80*time.Millisecond {
		t.Fatalf("3 actions took %v, want ≥ 80ms", d)
	}

	// a caller that gives up never runs fn
	ran := false
	short, cancel := context.WithTimeout(ctx, 5*time.Millisecond)
	defer cancel()
	if err := p.do(short, func() error { ran = true; return nil }); !errors.Is(err, context.DeadlineExceeded) || ran {
		t.Fatalf("want deadline and no run, got %v ran=%v", err, ran)
	}

	// a failed action still counts toward the gap
	fail := &pacer{gap: time.Hour}
	_ = fail.do(ctx, func() error { return errors.New("boom") })
	quick, cancel2 := context.WithTimeout(ctx, 5*time.Millisecond)
	defer cancel2()
	if err := fail.do(quick, func() error { return nil }); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("want the gap to hold after a failure, got %v", err)
	}
}

func TestFollowRoute(t *testing.T) {
	m, _ := testManager()
	srv := newAPI(config{Secret: "s"}, m, zerolog.Nop()).routes()
	call := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/follow", strings.NewReader(body))
		req.Header.Set("authorization", "Bearer s")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		return rec
	}
	if rec := call(`{}`); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "no_recipient") {
		t.Fatalf("no recipient: %d %s", rec.Code, rec.Body)
	}
	if rec := call(`{"username":"doceria.aurora"}`); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "not_connected") {
		t.Fatalf("no session: %d %s", rec.Code, rec.Body)
	}
	if rec := call(`nope`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json: %d", rec.Code)
	}
}
