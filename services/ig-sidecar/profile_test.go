package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
)

func TestProfileCacheAndHourlyLimiter(t *testing.T) {
	now := time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)
	cache := newProfileCache(time.Hour, 2)
	cache.set("a", &ProfileResult{Username: "a", Biography: "bio a"}, now)
	cache.set("b", &ProfileResult{Username: "b", Biography: "bio b"}, now.Add(time.Minute))
	got, ok := cache.get("a", now.Add(30*time.Minute))
	if !ok || got.Biography != "bio a" {
		t.Fatalf("cache hit: %v %+v", ok, got)
	}
	// mutating returned copy does not corrupt cache
	got.Biography = "mutated"
	got2, _ := cache.get("a", now.Add(30*time.Minute))
	if got2.Biography != "bio a" {
		t.Fatalf("cache should return a clone, got %q", got2.Biography)
	}
	// inserting a third evicts oldest ("a")
	cache.set("c", &ProfileResult{Username: "c"}, now.Add(2*time.Minute))
	if _, ok := cache.get("a", now.Add(3*time.Minute)); ok {
		t.Fatalf("expected oldest entry 'a' to be evicted")
	}
	// expired entry returns miss
	if _, ok := cache.get("b", now.Add(2*time.Hour)); ok {
		t.Fatalf("expected expired entry 'b' to miss")
	}

	lim := newHourlyLimiter(2)
	if !lim.allow(now) || !lim.allow(now.Add(10*time.Minute)) {
		t.Fatalf("first two within hour should pass")
	}
	if lim.allow(now.Add(20 * time.Minute)) {
		t.Fatalf("third within same hour should be refused")
	}
	if !lim.allow(now.Add(61 * time.Minute)) {
		t.Fatalf("after oldest expires past 1h, should allow again")
	}
}

func TestProfileRoute(t *testing.T) {
	m, _ := testManager()
	srv := newAPI(config{Secret: "s"}, m, zerolog.Nop()).routes()
	call := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/profile", strings.NewReader(body))
		req.Header.Set("authorization", "Bearer s")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		return rec
	}
	if rec := call(`{"username":"not a valid handle!!"}`); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "bad_username") {
		t.Fatalf("bad username: %d %s", rec.Code, rec.Body)
	}
	if rec := call(`{"username":"@vendua.digital"}`); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "not_connected") {
		t.Fatalf("no session: %d %s", rec.Code, rec.Body)
	}
	// cached hit returns even before session lookup
	m.profileCache.set("vendua.digital", &ProfileResult{Username: "vendua.digital", Biography: "cached bio"}, time.Now())
	if rec := call(`{"username":"@vendua.digital"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "cached bio") {
		t.Fatalf("cached hit: %d %s", rec.Code, rec.Body)
	}
}

type profileTestTransport func(*http.Request) (*http.Response, error)

func (fn profileTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestProfileLookupRoute(t *testing.T) {
	const username = "doceria_teste"
	const user = `{
		"username":"doceria_teste","pk":"12345","id":"not-the-profile-id",
		"full_name":"Doceria Teste","biography":"Bolos artesanais",
		"external_url":"https://example.com/bolos",
		"bio_links":[{"url":"https://example.com/bolos","title":"Cardápio"},
		             {"lynx_url":"https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2Fcontato","title":"Contato"}],
		"follower_count":5108,"all_media_count":297,"is_business":true,"public_email":"bolos@example.com"
	}`

	type upstreamResponse struct {
		request string
		status  int
		body    string
	}
	searchMatch := upstreamResponse{"search", 200, `{"data":{"xfb_combinedIGSearchQuery":{
		"search_messenger_contact_v2":[{"username":"doceria_teste2","pk":"999"},{"username":"DOCERIA_TESTE","pk":"12345"}]
	}}}`}
	searchMiss := upstreamResponse{"search", 200, `{"data":{"xfb_combinedIGSearchQuery":{
		"search_messenger_contact_v2":[{"username":"doceria_teste2","pk":"999"}]
	}}}`}
	profileMatch := upstreamResponse{"profile", 200, `for (;;);{"data":{"user":` + user + `}}`}
	profileMiss := upstreamResponse{"profile", 200, `{"data":{"user":null}}`}
	publicMatch := upstreamResponse{"public", 200, `<!doctype html>
		<script type="application/json">{"xig_user_by_username":{"username":"different","pk":"999"}}</script>
		<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",null,["profile",{"__bbox":{"result":{"data":{"xig_user_by_username":` + user + `}}}}]]]}</script>`}
	publicMiss := upstreamResponse{"public", 404, `<title>Page Not Found • Instagram</title>`}
	feed := upstreamResponse{"feed", 200, `{"items":[{"taken_at":1764000000,"code":"ABC",
		"caption":{"text":"Novidade"},"timeline_pinned_user_ids":[12345]}]}`}

	for _, tc := range []struct {
		name      string
		upstream  []upstreamResponse
		status    int
		code      string
		wantPosts bool
	}{
		{
			name: "signed-in exact match without messaging ID", upstream: []upstreamResponse{searchMatch, profileMatch, feed},
			status: 200, wantPosts: true,
		},
		{
			name:     "public data survives an empty signed-in search and failed feed",
			upstream: []upstreamResponse{searchMiss, publicMatch, {"feed", 404, ""}}, status: 200,
		},
		{
			name:     "public page recovers when a resolved profile query has no user",
			upstream: []upstreamResponse{searchMatch, profileMiss, publicMatch, feed}, status: 200, wantPosts: true,
		},
		{
			name: "clean search and page both miss", upstream: []upstreamResponse{searchMiss, publicMiss},
			status: 404, code: "user_not_found",
		},
		{
			name: "known profile with unavailable details is inconclusive", upstream: []upstreamResponse{searchMatch, profileMiss, publicMiss},
			status: 502, code: "profile_unavailable",
		},
		{
			name: "failed search cannot corroborate 404", upstream: []upstreamResponse{{"search", 404, ""}, publicMiss},
			status: 502, code: "profile_unavailable",
		},
		{
			name: "login wall is inconclusive", upstream: []upstreamResponse{searchMiss, {"public", 302, ""}},
			status: 502, code: "profile_unavailable",
		},
		{
			name: "Instagram rate limit stops lookup", upstream: []upstreamResponse{{"search", 429, ""}},
			status: 429, code: "rate_limited",
		},
		{
			name: "Instagram feedback limit stops lookup", upstream: []upstreamResponse{searchMatch, {"profile", 400, `{"message":"feedback_required"}`}},
			status: 429, code: "rate_limited",
		},
		{
			name: "signed-in challenge stops lookup", upstream: []upstreamResponse{{"search", 400, `{"message":"challenge_required"}`}},
			status: 502, code: "upstream_error",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := testManager()
			jar := &cookies.Cookies{}
			jar.UpdateValues(map[cookies.MetaCookieName]string{cookies.IGCookieSessionID: "test-session"})
			cli, err := m.newClient(jar, nil, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			m.client, m.state = cli, stateOpen
			calls := 0
			cli.GetHTTP().SetTransportOverride(profileTestTransport(func(req *http.Request) (*http.Response, error) {
				var request string
				switch {
				case req.Method == http.MethodPost && req.Header.Get("x-fb-friendly-name") == "IGDOmniPickerSearchResultsListQuery":
					request = "search"
				case req.Method == http.MethodPost && req.Header.Get("x-fb-friendly-name") == "PolarisProfilePageContentQuery":
					request = "profile"
				case req.Method == http.MethodGet && req.URL.Path == "/"+username+"/":
					request = "public"
				case req.Method == http.MethodGet && req.URL.Path == "/api/v1/feed/user/12345/":
					request = "feed"
				default:
					t.Fatalf("unexpected request %s %s", req.Method, req.URL.Path)
				}
				if calls >= len(tc.upstream) || tc.upstream[calls].request != request {
					t.Fatalf("unexpected %s request at step %d", request, calls+1)
				}
				hasSession := strings.Contains(req.Header.Get("Cookie"), "sessionid=test-session")
				if request == "public" {
					if req.Header.Get("Cookie") != "" || req.Header.Get("Sec-Fetch-Mode") != "navigate" {
						t.Fatal("public page should use a guest navigation")
					}
				} else if !hasSession {
					t.Fatal("signed-in request has no Instagram session")
				}
				stub := tc.upstream[calls]
				calls++
				headers := make(http.Header)
				if stub.status == http.StatusFound {
					headers.Set("Location", "/accounts/login/")
				}
				return &http.Response{StatusCode: stub.status, Request: req, Header: headers, Body: io.NopCloser(strings.NewReader(stub.body))}, nil
			}))
			srv := newAPI(config{Secret: "s"}, m, zerolog.Nop()).routes()
			call := func() *httptest.ResponseRecorder {
				req := httptest.NewRequest(http.MethodPost, "/v1/profile", strings.NewReader(`{"username":"@Doceria_Teste"}`))
				req.Header.Set("authorization", "Bearer s")
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, req)
				return rec
			}
			rec := call()
			if calls != len(tc.upstream) || rec.Code != tc.status {
				t.Fatalf("got HTTP %d after %d upstream calls: %s", rec.Code, calls, rec.Body.String())
			}
			if tc.code != "" {
				if !strings.Contains(rec.Body.String(), `"code":"`+tc.code+`"`) {
					t.Fatalf("expected code %s, got %s", tc.code, rec.Body.String())
				}
				return
			}
			var p ProfileResult
			if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
				t.Fatal(err)
			}
			if p.Username != username || p.IGID != "12345" || p.Biography != "Bolos artesanais" || p.FullName != "Doceria Teste" {
				t.Fatalf("invalid profile identity or biography: %+v", p)
			}
			if p.ExternalURL != "https://example.com/bolos" || len(p.ExternalURLs) != 2 || p.ExternalURLs[0].Title != "Cardápio" || p.ExternalURLs[1].URL != "https://example.com/contato" {
				t.Fatalf("lost bio links: %+v", p.ExternalURLs)
			}
			if p.FollowersCount == nil || *p.FollowersCount != 5108 || p.PostsCount == nil || *p.PostsCount != 297 || !p.IsBusinessAccount || p.PublicEmail != "bolos@example.com" {
				t.Fatalf("lost profile fields: %+v", p)
			}
			if tc.wantPosts && (len(p.LatestPosts) != 1 || !p.LatestPosts[0].IsPinned || p.LatestPosts[0].Caption != "Novidade") {
				t.Fatalf("lost recent posts: %+v", p.LatestPosts)
			}
			if cached := call(); cached.Code != http.StatusOK || cached.Body.String() != rec.Body.String() {
				t.Fatalf("cache did not return the same profile: %d %s", cached.Code, cached.Body.String())
			}
		})
	}
}
