package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"go.mau.fi/mautrix-meta/pkg/instameow/slidetypes"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
)

func TestParseWebProfileInfo(t *testing.T) {
	body := `{
		"status": "ok",
		"data": {
			"user": {
				"id": "99887766",
				"username": "torbolariadapreta",
				"full_name": "Torbolaria da Preta/Confeitaria Cabo frio",
				"biography": "Bolos Decorados • Kit festa\nPara orçamentos e encomenda link👇",
				"external_url": "https://torbolariadapreta.pages.dev/",
				"bio_links": [
					{
						"title": "Cardápio e Reservas",
						"lynx_url": "https://l.instagram.com/?u=https%3A%2F%2Ftorbolariadapreta.pages.dev%2F&e=1",
						"url": "https://torbolariadapreta.pages.dev/",
						"link_type": "external"
					},
					{
						"title": "WhatsApp",
						"lynx_url": "https://l.instagram.com/?u=https%3A%2F%2Fwa.me%2F5522988459183&e=2",
						"url": "",
						"link_type": "external"
					}
				],
				"edge_followed_by": { "count": 23200 },
				"edge_owner_to_timeline_media": {
					"count": 1984,
					"edges": [
						{
							"node": {
								"shortcode": "PIN1",
								"taken_at_timestamp": 1700000000,
								"pinned_for_users": [{"id": "99887766"}],
								"edge_media_to_caption": { "edges": [{ "node": { "text": "Post fixado antigo" } }] }
							}
						},
						{
							"node": {
								"shortcode": "NEW1",
								"taken_at_timestamp": 1764000000,
								"pinned_for_users": [],
								"edge_media_to_caption": { "edges": [{ "node": { "text": "Bolo de morango hoje!" } }] }
							}
						}
					]
				},
				"category_name": "Bakery",
				"is_private": false,
				"is_business_account": true,
				"business_email": "contato@torbolaria.example",
				"contact_phone_number": "+5522988459183",
				"whatsapp_number": "+5522988459183"
			}
		}
	}`
	p, err := parseWebProfileInfo("torbolariadapreta", []byte(body), http.StatusOK, nil)
	if err != nil {
		t.Fatalf("parse ok profile: %v", err)
	}
	if p.Username != "torbolariadapreta" || p.IGID != "99887766" {
		t.Fatalf("identity: %+v", p)
	}
	if p.ExternalURL != "https://torbolariadapreta.pages.dev/" {
		t.Fatalf("externalUrl: %q", p.ExternalURL)
	}
	if len(p.ExternalURLs) != 2 || p.ExternalURLs[0].Title != "Cardápio e Reservas" || p.ExternalURLs[1].URL != "https://wa.me/5522988459183" {
		t.Fatalf("externalUrls: %+v", p.ExternalURLs)
	}
	if p.FollowersCount == nil || *p.FollowersCount != 23200 {
		t.Fatalf("followers: %v", p.FollowersCount)
	}
	if p.PostsCount == nil || *p.PostsCount != 1984 {
		t.Fatalf("postsCount: %v", p.PostsCount)
	}
	if len(p.LatestPosts) != 2 || !p.LatestPosts[0].IsPinned || p.LatestPosts[1].Caption != "Bolo de morango hoje!" {
		t.Fatalf("latestPosts: %+v", p.LatestPosts)
	}
	if p.PublicEmail != "contato@torbolaria.example" || p.WhatsappNumber != "+5522988459183" || !p.IsBusinessAccount {
		t.Fatalf("business fields: %+v", p)
	}

	// Null user with status=ok or 404 → user not found
	if _, err := parseWebProfileInfo("nobody", []byte(`{"status":"ok","data":{"user":null}}`), http.StatusOK, nil); !errors.Is(err, errUserNotFound) {
		t.Fatalf("want errUserNotFound on null user, got %v", err)
	}
	if _, err := parseWebProfileInfo("nobody", nil, http.StatusNotFound, nil); !errors.Is(err, errUserNotFound) {
		t.Fatalf("want errUserNotFound on 404, got %v", err)
	}

	// Rate-limited responses
	for _, tc := range []struct {
		code int
		body string
		err  error
	}{
		{http.StatusTooManyRequests, `{"message":"Please wait a few minutes","status":"fail"}`, nil},
		{http.StatusBadRequest, `{"message":"feedback_required","spam":true,"status":"fail"}`, fmt.Errorf("%w 400", httpclient.ErrUnexpectedError)},
		{0, ``, fmt.Errorf("%w: %w", httpclient.ErrMaxRetriesReached, httpclient.ErrRateLimited)},
	} {
		if _, err := parseWebProfileInfo("x", []byte(tc.body), tc.code, tc.err); !errors.Is(err, errProfileRateLimited) {
			t.Fatalf("rate limit (%d %q %v): got %v", tc.code, tc.body, tc.err, err)
		}
	}

	// Session-killing errors must stay classifiable
	if _, err := parseWebProfileInfo("x", []byte(`{"message":"challenge_required"}`), http.StatusBadRequest, httpclient.ErrChallengeRequired); !errors.Is(err, httpclient.ErrChallengeRequired) {
		t.Fatalf("want ErrChallengeRequired preserved, got %v", err)
	}
}

func TestParseGraphQLProfileAndFeed(t *testing.T) {
	u := &slidetypes.User{
		Username: "vendua.digital",
		FullName: "Venduá",
		PK:       "123456",
		Unrecognized: map[string]any{
			"biography":       "Loja online pra negócios de comida",
			"external_url":    "https://vendua.com.br",
			"follower_count":  float64(512),
			"media_count":     float64(34),
			"category":        "Software",
			"is_business":     true,
			"public_email":    "oi@vendua.com.br",
			"whatsapp_number": "+5511999990000",
			"bio_links": []any{
				map[string]any{"url": "https://vendua.com.br", "title": "Site"},
				map[string]any{"lynx_url": "https://l.instagram.com/?u=https%3A%2F%2Flinktr.ee%2Fvendua", "title": "Links"},
			},
		},
	}
	p := parseGraphQLProfile("vendua.digital", u)
	if p.Username != "vendua.digital" || p.IGID != "123456" || p.ExternalURL != "https://vendua.com.br" {
		t.Fatalf("graphql profile: %+v", p)
	}
	if len(p.ExternalURLs) != 2 || p.ExternalURLs[1].URL != "https://linktr.ee/vendua" {
		t.Fatalf("graphql bio_links: %+v", p.ExternalURLs)
	}
	if p.FollowersCount == nil || *p.FollowersCount != 512 || p.PostsCount == nil || *p.PostsCount != 34 {
		t.Fatalf("graphql counts: %+v", p)
	}

	posts := parseUserFeed([]byte(`{
		"items": [
			{"taken_at": 1764000000, "code": "ABC", "caption": {"text": "Novidade"}, "timeline_pinned_user_ids": [123456]},
			{"taken_at": 1763000000, "code": "DEF", "caption": {"text": "Post 2"}}
		]
	}`))
	if len(posts) != 2 || !posts[0].IsPinned || posts[0].Caption != "Novidade" || posts[1].IsPinned {
		t.Fatalf("feed posts: %+v", posts)
	}
}

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
