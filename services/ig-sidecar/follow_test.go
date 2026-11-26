package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
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

func TestFollowTargetLookup(t *testing.T) {
	type step struct {
		name   string
		status int
		body   string
	}
	const searchPrefix = `{"data":{"xfb_combinedIGSearchQuery":{"search_messenger_contact_v2":`
	search := step{"search", 200, searchPrefix + `[{"username":"DOCERIA_TESTE","pk":"12345"}]}}}`}
	searchWithFBID := step{"search", 200, searchPrefix + `[{"username":"doceria_teste","pk":"12345","interop_messaging_user_fbid":"456"}]}}}`}
	miss := step{"search", 200, searchPrefix + `[]}}}`}
	page := step{"public", 200, `<script type="application/json">{"data":{"xig_user_by_username":{"username":"doceria_teste","pk":"12345"}}}</script>`}
	profile := func(friendship string) step {
		return step{"profile", 200, `{"data":{"user":{"username":"doceria_teste","pk":"12345","friendship_status":` + friendship + `}}}`}
	}
	dmUser := step{"dm user", 200, `{"data":{"xig_user_from_messaging_user_fbid":{"username":"doceria_teste","pk":"12345"}}}`}
	follow := step{"follow", 200, `{"status":"ok","friendship_status":{"following":true}}`}

	for _, tc := range []struct {
		name     string
		steps    []step
		status   int
		code     string
		ownIGID  string
		useFBID  bool
		wantFBID string
		already  bool
		request  bool
	}{
		{name: "exact username with only Instagram ID", steps: []step{search, profile(`{"following":false}`), follow}, status: 200},
		{name: "exact username with a messaging ID", steps: []step{searchWithFBID, dmUser, follow}, status: 200, wantFBID: "456"},
		{name: "explicit messaging ID", steps: []step{dmUser, follow}, status: 200, useFBID: true, wantFBID: "456"},
		{name: "public ID verified by connected session", steps: []step{miss, page, profile(`{}`), follow}, status: 200},
		{name: "public ID alone cannot authorize a follow", steps: []step{miss, page, {"profile", 200, `{"data":{"user":null}}`}}, status: 502, code: "profile_unavailable"},
		{name: "both sources miss", steps: []step{miss, {"public", 404, ""}}, status: 404, code: "follow_target_not_found"},
		{name: "already following", steps: []step{search, profile(`{"following":true}`)}, status: 200, already: true},
		{name: "pending request", steps: []step{search, profile(`{"outgoing_request":true}`)}, status: 200, already: true, request: true},
		{name: "blocked relationship", steps: []step{search, profile(`{"blocking":true}`)}, status: 409, code: "blocking"},
		{name: "connected account itself", steps: []step{search}, status: 422, code: "self", ownIGID: "12345"},
		{name: "rate limited during preflight", steps: []step{search, {"profile", 429, ""}}, status: 429, code: "rate_limited"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := testManager()
			jar := &cookies.Cookies{}
			jar.UpdateValues(map[cookies.MetaCookieName]string{
				cookies.IGCookieSessionID: "test-session",
				cookies.IGCookieDSUserID:  tc.ownIGID,
			})
			cli, err := m.newClient(jar, nil, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			m.client, m.state = cli, stateOpen
			calls := 0
			cli.GetHTTP().SetTransportOverride(profileTestTransport(func(req *http.Request) (*http.Response, error) {
				var name string
				switch req.Header.Get("x-fb-friendly-name") {
				case "IGDOmniPickerSearchResultsListQuery":
					name = "search"
				case "PolarisProfilePageContentQuery":
					name = "profile"
					if !strings.Contains(req.FormValue("variables"), `"id":"12345"`) {
						t.Fatal("profile check used the wrong Instagram ID")
					}
				case "useIGDCreateOptimisticThreadUserQuery":
					name = "dm user"
				default:
					if req.Method == http.MethodGet && req.URL.Path == "/doceria_teste/" {
						name = "public"
					} else if req.Method == http.MethodPost && req.URL.Path == "/api/v1/friendships/create/12345/" && req.FormValue("user_id") == "12345" {
						name = "follow"
					}
				}
				if name == "" || calls >= len(tc.steps) || tc.steps[calls].name != name {
					t.Fatalf("unexpected request at step %d: %s %s (%s)", calls+1, req.Method, req.URL.Path, name)
				}
				if name != "public" && !strings.Contains(req.Header.Get("Cookie"), "sessionid=test-session") {
					t.Fatal("follow check or action skipped the connected session")
				}
				stub := tc.steps[calls]
				calls++
				return &http.Response{StatusCode: stub.status, Request: req, Body: io.NopCloser(strings.NewReader(stub.body))}, nil
			}))
			body := `{"username":"@Doceria_Teste"}`
			if tc.useFBID {
				body = `{"fbid":"456"}`
			}
			req := httptest.NewRequest(http.MethodPost, "/v1/follow", strings.NewReader(body))
			req.Header.Set("authorization", "Bearer s")
			rec := httptest.NewRecorder()
			newAPI(config{Secret: "s"}, m, zerolog.Nop()).routes().ServeHTTP(rec, req)
			if rec.Code != tc.status || calls != len(tc.steps) {
				t.Fatalf("got HTTP %d after %d requests: %s", rec.Code, calls, rec.Body.String())
			}
			if tc.code != "" {
				if !strings.Contains(rec.Body.String(), `"code":"`+tc.code+`"`) {
					t.Fatalf("want %s, got %s", tc.code, rec.Body.String())
				}
				return
			}
			var res FollowResult
			if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
				t.Fatal(err)
			}
			if res.IGID != "12345" || res.FBID != tc.wantFBID || res.Already != tc.already || res.Following == tc.request || res.Requested != tc.request {
				t.Fatalf("unexpected follow result: %+v", res)
			}
		})
	}
}
