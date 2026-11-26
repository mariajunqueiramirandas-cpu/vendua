package main

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"go.mau.fi/mautrix-meta/pkg/instameow/slidetypes"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
)

const (
	profileCacheTTL = 6 * time.Hour
	profileCacheMax = 500
	profilePostCap  = 12
)

var errProfileRateLimited = errors.New("limite de consultas de perfil no instagram atingido por enquanto")

type BioLink struct {
	URL      string `json:"url"`
	Title    string `json:"title,omitempty"`
	LinkType string `json:"linkType,omitempty"`
}

type ProfilePost struct {
	Timestamp int64  `json:"timestamp"`
	Caption   string `json:"caption,omitempty"`
	Shortcode string `json:"shortcode,omitempty"`
	IsPinned  bool   `json:"isPinned,omitempty"`
}

type ProfileResult struct {
	Username             string        `json:"username"`
	FullName             string        `json:"fullName,omitempty"`
	IGID                 string        `json:"igid,omitempty"`
	Biography            string        `json:"biography"`
	ExternalURL          string        `json:"externalUrl,omitempty"`
	ExternalURLs         []BioLink     `json:"externalUrls,omitempty"`
	FollowersCount       *int          `json:"followersCount,omitempty"`
	PostsCount           *int          `json:"postsCount,omitempty"`
	BusinessCategoryName string        `json:"businessCategoryName,omitempty"`
	IsPrivate            bool          `json:"isPrivate"`
	IsBusinessAccount    bool          `json:"isBusinessAccount"`
	PublicEmail          string        `json:"publicEmail,omitempty"`
	ContactPhoneNumber   string        `json:"contactPhoneNumber,omitempty"`
	WhatsappNumber       string        `json:"whatsappNumber,omitempty"`
	LatestPosts          []ProfilePost `json:"latestPosts,omitempty"`
}

type cachedProfile struct {
	value     *ProfileResult
	expiresAt time.Time
}

type profileCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	max     int
	entries map[string]cachedProfile
}

func newProfileCache(ttl time.Duration, max int) *profileCache {
	return &profileCache{ttl: ttl, max: max, entries: map[string]cachedProfile{}}
}

func (c *profileCache) get(username string, now time.Time) (*ProfileResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[username]
	if !ok {
		return nil, false
	}
	if !now.Before(e.expiresAt) {
		delete(c.entries, username)
		return nil, false
	}
	return cloneProfile(e.value), true
}

func (c *profileCache) set(username string, p *ProfileResult, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= c.max {
		var oldestKey string
		var oldestExp time.Time
		for k, e := range c.entries {
			if !now.Before(e.expiresAt) {
				delete(c.entries, k)
				continue
			}
			if oldestKey == "" || e.expiresAt.Before(oldestExp) {
				oldestKey, oldestExp = k, e.expiresAt
			}
		}
		if len(c.entries) >= c.max && oldestKey != "" {
			delete(c.entries, oldestKey)
		}
	}
	c.entries[username] = cachedProfile{value: cloneProfile(p), expiresAt: now.Add(c.ttl)}
}

func cloneProfile(p *ProfileResult) *ProfileResult {
	if p == nil {
		return nil
	}
	cp := *p
	if p.FollowersCount != nil {
		v := *p.FollowersCount
		cp.FollowersCount = &v
	}
	if p.PostsCount != nil {
		v := *p.PostsCount
		cp.PostsCount = &v
	}
	if len(p.ExternalURLs) > 0 {
		cp.ExternalURLs = append([]BioLink(nil), p.ExternalURLs...)
	}
	if len(p.LatestPosts) > 0 {
		cp.LatestPosts = append([]ProfilePost(nil), p.LatestPosts...)
	}
	return &cp
}

// hourlyLimiter caps live Instagram profile reads on a rolling 1-hour window
// so discovery never burns the DM account's rate budget. limit <= 0 disables it.
type hourlyLimiter struct {
	mu    sync.Mutex
	limit int
	hits  []time.Time
}

func newHourlyLimiter(limit int) *hourlyLimiter {
	return &hourlyLimiter{limit: limit}
}

func (l *hourlyLimiter) allow(now time.Time) bool {
	if l.limit <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := now.Add(-time.Hour)
	keep := l.hits[:0]
	for _, ts := range l.hits {
		if ts.After(cutoff) {
			keep = append(keep, ts)
		}
	}
	l.hits = keep
	if len(l.hits) >= l.limit {
		return false
	}
	l.hits = append(l.hits, now)
	return true
}

// Profile fetches a public (or visible) Instagram profile using the connected session.
// Results are cached in memory and live fetches are paced + hourly-capped.
func (m *Manager) Profile(ctx context.Context, raw string) (*ProfileResult, error) {
	u, err := normalizeUsername(raw)
	if err != nil {
		return nil, err
	}
	if cached, ok := m.profileCache.get(u, time.Now()); ok {
		return cached, nil
	}
	cli, gen, _, err := m.liveSession()
	if err != nil {
		return nil, err
	}
	var out *ProfileResult
	err = m.profilePace.do(ctx, func() error {
		// Re-check after acquiring the pacer lock so parallel lookups for the same
		// handle collapse into one upstream request.
		if cached, ok := m.profileCache.get(u, time.Now()); ok {
			out = cached
			return nil
		}
		if !m.profileQuota.allow(time.Now()) {
			return errProfileRateLimited
		}
		p, fetchErr := lookupProfile(
			func() (*ProfileResult, error) { return fetchWebProfileInfo(ctx, cli, u) },
			func() (*ProfileResult, error) { return m.fetchProfileViaGraphQL(ctx, cli, u) },
		)
		if fetchErr != nil {
			return fetchErr
		}
		m.profileCache.set(u, p, time.Now())
		out = p
		return nil
	})
	if err != nil {
		if e, permanent := classify(err); permanent {
			m.fail(gen, e)
		}
		return nil, err
	}
	return out, nil
}

// lookupProfile tries web_profile_info, then PolarisProfilePageContentQuery (found by the same
// search DMs and follows use). The web endpoint answers 404 / user:null for accounts that exist,
// so its "not found" stands only when the search agrees; a rate limit or a dead session doesn't
// get a second request.
func lookupProfile(web, graph func() (*ProfileResult, error)) (*ProfileResult, error) {
	p, err := web()
	if err == nil || errors.Is(err, errProfileRateLimited) {
		return p, err
	}
	if _, permanent := classify(err); permanent {
		return nil, err
	}
	fb, fbErr := graph()
	if fbErr == nil {
		return fb, nil
	}
	if errors.Is(err, errUserNotFound) {
		return nil, fbErr
	}
	return nil, err
}

func fetchWebProfileInfo(ctx context.Context, cli *instameow.Client, username string) (*ProfileResult, error) {
	base := cli.GetEndpoint("base_url")
	h := cli.GetHTTP().BuildHeaders(true, false)
	h.Set("x-requested-with", "XMLHttpRequest")
	h.Set("referer", base+"/"+url.PathEscape(username)+"/")
	h.Set("sec-fetch-dest", "empty")
	h.Set("sec-fetch-mode", "cors")
	h.Set("sec-fetch-site", "same-origin")
	endpoint := base + "/api/v1/users/web_profile_info/?username=" + url.QueryEscape(username)
	resp, body, err := cli.GetHTTP().MakeRequest(ctx, endpoint, http.MethodGet, h, nil, types.NONE)
	if resp != nil {
		cli.GetCookies().UpdateFromResponse(resp)
	}
	statusCode := 0
	if resp != nil {
		statusCode = resp.StatusCode
	}
	return parseWebProfileInfo(username, body, statusCode, err)
}

func (m *Manager) fetchProfileViaGraphQL(ctx context.Context, cli *instameow.Client, username string) (*ProfileResult, error) {
	resolved, err := m.Resolve(ctx, username)
	if err != nil {
		return nil, err
	}
	igid := cmp.Or(resolved.IGID, resolved.FBID)
	if igid == "" {
		return nil, errUserNotFound
	}
	resp, err := cli.GetProfile(ctx, igid)
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.User == nil {
		return nil, errUserNotFound
	}
	out := parseGraphQLProfile(username, resp.User)
	if len(out.LatestPosts) == 0 && !out.IsPrivate && out.IGID != "" {
		if posts, feedErr := fetchUserFeed(ctx, cli, out.IGID, username); feedErr == nil && len(posts) > 0 {
			out.LatestPosts = posts
		}
	}
	return out, nil
}

func fetchUserFeed(ctx context.Context, cli *instameow.Client, igid, username string) ([]ProfilePost, error) {
	base := cli.GetEndpoint("base_url")
	h := cli.GetHTTP().BuildHeaders(true, false)
	h.Set("x-requested-with", "XMLHttpRequest")
	h.Set("referer", base+"/"+url.PathEscape(username)+"/")
	h.Set("sec-fetch-dest", "empty")
	h.Set("sec-fetch-mode", "cors")
	h.Set("sec-fetch-site", "same-origin")
	endpoint := base + "/api/v1/feed/user/" + url.PathEscape(igid) + "/?count=12"
	resp, body, err := cli.GetHTTP().MakeRequest(ctx, endpoint, http.MethodGet, h, nil, types.NONE)
	if resp != nil {
		cli.GetCookies().UpdateFromResponse(resp)
	}
	if err != nil {
		return nil, err
	}
	return parseUserFeed(body), nil
}

func unwrapLynxURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	u, err := url.Parse(s)
	if err != nil {
		return s
	}
	host := strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
	if host == "l.instagram.com" || host == "lm.instagram.com" || host == "l.facebook.com" || host == "lm.facebook.com" {
		if inner := strings.TrimSpace(u.Query().Get("u")); strings.HasPrefix(inner, "http://") || strings.HasPrefix(inner, "https://") {
			return inner
		}
	}
	return s
}

func mergeBioLinks(externalURL string, links []BioLink) (string, []BioLink) {
	seen := map[string]bool{}
	var out []BioLink
	add := func(l BioLink) {
		u := unwrapLynxURL(l.URL)
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		out = append(out, BioLink{
			URL:      u,
			Title:    strings.TrimSpace(l.Title),
			LinkType: strings.TrimSpace(l.LinkType),
		})
	}
	for _, l := range links {
		add(l)
	}
	primary := unwrapLynxURL(externalURL)
	if primary != "" && !seen[primary] {
		out = append([]BioLink{{URL: primary}}, out...)
	}
	if primary == "" && len(out) > 0 {
		primary = out[0].URL
	}
	return primary, out
}

func parseWebProfileInfo(username string, body []byte, statusCode int, reqErr error) (*ProfileResult, error) {
	var envelope struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Spam    bool   `json:"spam"`
		Data    *struct {
			User *webProfileUser `json:"user"`
		} `json:"data"`
	}
	parsed := len(body) > 0 && json.Unmarshal(body, &envelope) == nil

	if statusCode == http.StatusTooManyRequests || envelope.Spam ||
		envelope.Message == "feedback_required" ||
		errors.Is(reqErr, httpclient.ErrRateLimited) {
		return nil, errProfileRateLimited
	}
	if statusCode == http.StatusNotFound {
		return nil, errUserNotFound
	}
	if reqErr != nil {
		if _, permanent := classify(reqErr); permanent {
			return nil, reqErr
		}
		if envelope.Message != "" {
			return nil, fmt.Errorf("%w: %s", reqErr, envelope.Message)
		}
		return nil, reqErr
	}
	if !parsed {
		return nil, errors.New("resposta inesperada ao ler perfil do instagram")
	}
	if envelope.Data == nil || envelope.Data.User == nil {
		if envelope.Status == "ok" {
			return nil, errUserNotFound
		}
		return nil, fmt.Errorf("perfil não carregou: %s", cmp.Or(envelope.Message, envelope.Status, "resposta vazia"))
	}
	return envelope.Data.User.toProfile(username), nil
}

type webProfileUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	FullName    string `json:"full_name"`
	Biography   string `json:"biography"`
	ExternalURL string `json:"external_url"`
	BioLinks    []struct {
		Title    string `json:"title"`
		LynxURL  string `json:"lynx_url"`
		URL      string `json:"url"`
		LinkType string `json:"link_type"`
	} `json:"bio_links"`
	EdgeFollowedBy *struct {
		Count int `json:"count"`
	} `json:"edge_followed_by"`
	EdgeTimeline          *webTimelineEdge `json:"edge_owner_to_timeline_media"`
	CategoryName          string           `json:"category_name"`
	BusinessCategoryName  string           `json:"business_category_name"`
	IsPrivate             bool             `json:"is_private"`
	IsBusinessAccount     bool             `json:"is_business_account"`
	IsProfessionalAccount bool             `json:"is_professional_account"`
	BusinessEmail         string           `json:"business_email"`
	PublicEmail           string           `json:"public_email"`
	BusinessPhone         string           `json:"business_phone_number"`
	ContactPhone          string           `json:"contact_phone_number"`
	PublicPhone           string           `json:"public_phone_number"`
	WhatsappNumber        string           `json:"whatsapp_number"`
}

type webTimelineEdge struct {
	Count int `json:"count"`
	Edges []struct {
		Node struct {
			Shortcode        string `json:"shortcode"`
			TakenAtTimestamp int64  `json:"taken_at_timestamp"`
			PinnedForUsers   []any  `json:"pinned_for_users"`
			Caption          *struct {
				Edges []struct {
					Node struct {
						Text string `json:"text"`
					} `json:"node"`
				} `json:"edges"`
			} `json:"edge_media_to_caption"`
		} `json:"node"`
	} `json:"edges"`
}

func (u *webProfileUser) toProfile(fallbackUsername string) *ProfileResult {
	var links []BioLink
	for _, bl := range u.BioLinks {
		raw := cmp.Or(strings.TrimSpace(bl.URL), strings.TrimSpace(bl.LynxURL))
		if raw == "" {
			continue
		}
		links = append(links, BioLink{URL: raw, Title: bl.Title, LinkType: bl.LinkType})
	}
	primaryURL, allLinks := mergeBioLinks(u.ExternalURL, links)

	var posts []ProfilePost
	var postsCount *int
	if u.EdgeTimeline != nil {
		c := u.EdgeTimeline.Count
		postsCount = &c
		for _, e := range u.EdgeTimeline.Edges {
			if len(posts) >= profilePostCap {
				break
			}
			if e.Node.TakenAtTimestamp <= 0 {
				continue
			}
			caption := ""
			if e.Node.Caption != nil && len(e.Node.Caption.Edges) > 0 {
				caption = strings.TrimSpace(e.Node.Caption.Edges[0].Node.Text)
			}
			posts = append(posts, ProfilePost{
				Timestamp: e.Node.TakenAtTimestamp,
				Caption:   caption,
				Shortcode: e.Node.Shortcode,
				IsPinned:  len(e.Node.PinnedForUsers) > 0,
			})
		}
	}

	var followers *int
	if u.EdgeFollowedBy != nil {
		c := u.EdgeFollowedBy.Count
		followers = &c
	}

	return &ProfileResult{
		Username:             cmp.Or(strings.TrimSpace(u.Username), fallbackUsername),
		FullName:             strings.TrimSpace(u.FullName),
		IGID:                 strings.TrimSpace(u.ID),
		Biography:            u.Biography,
		ExternalURL:          primaryURL,
		ExternalURLs:         allLinks,
		FollowersCount:       followers,
		PostsCount:           postsCount,
		BusinessCategoryName: cmp.Or(strings.TrimSpace(u.CategoryName), strings.TrimSpace(u.BusinessCategoryName)),
		IsPrivate:            u.IsPrivate,
		IsBusinessAccount:    u.IsBusinessAccount || u.IsProfessionalAccount,
		PublicEmail:          cmp.Or(strings.TrimSpace(u.PublicEmail), strings.TrimSpace(u.BusinessEmail)),
		ContactPhoneNumber:   cmp.Or(strings.TrimSpace(u.ContactPhone), strings.TrimSpace(u.BusinessPhone), strings.TrimSpace(u.PublicPhone)),
		WhatsappNumber:       strings.TrimSpace(u.WhatsappNumber),
		LatestPosts:          posts,
	}
}

func parseGraphQLProfile(fallbackUsername string, u *slidetypes.User) *ProfileResult {
	extra := u.Unrecognized
	strOf := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := extra[k].(string); ok && strings.TrimSpace(v) != "" {
				return strings.TrimSpace(v)
			}
		}
		return ""
	}
	intPtr := func(keys ...string) *int {
		for _, k := range keys {
			switch v := extra[k].(type) {
			case float64:
				n := int(v)
				return &n
			case int:
				n := v
				return &n
			}
		}
		return nil
	}
	boolOf := func(keys ...string) bool {
		for _, k := range keys {
			if v, ok := extra[k].(bool); ok && v {
				return true
			}
		}
		return false
	}

	var links []BioLink
	if rawLinks, ok := extra["bio_links"].([]any); ok {
		for _, item := range rawLinks {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			rawURL := ""
			if s, ok := m["url"].(string); ok && strings.TrimSpace(s) != "" {
				rawURL = s
			} else if s, ok := m["lynx_url"].(string); ok && strings.TrimSpace(s) != "" {
				rawURL = s
			}
			if rawURL == "" {
				continue
			}
			title, _ := m["title"].(string)
			linkType, _ := m["link_type"].(string)
			links = append(links, BioLink{URL: rawURL, Title: title, LinkType: linkType})
		}
	}
	primaryURL, allLinks := mergeBioLinks(strOf("external_url"), links)

	bio, _ := extra["biography"].(string)
	return &ProfileResult{
		Username:             cmp.Or(strings.TrimSpace(u.Username), fallbackUsername),
		FullName:             strings.TrimSpace(u.FullName),
		IGID:                 cmp.Or(strings.TrimSpace(u.PK), strings.TrimSpace(u.ID)),
		Biography:            bio,
		ExternalURL:          primaryURL,
		ExternalURLs:         allLinks,
		FollowersCount:       intPtr("follower_count"),
		PostsCount:           intPtr("media_count"),
		BusinessCategoryName: strOf("category", "category_name", "business_category_name"),
		IsPrivate:            boolOf("is_private"),
		IsBusinessAccount:    boolOf("is_business", "is_business_account", "is_professional_account"),
		PublicEmail:          strOf("public_email", "business_email"),
		ContactPhoneNumber:   strOf("contact_phone_number", "public_phone_number", "business_phone_number"),
		WhatsappNumber:       strOf("whatsapp_number"),
	}
}

func parseUserFeed(body []byte) []ProfilePost {
	var feed struct {
		Items []struct {
			TakenAt int64  `json:"taken_at"`
			Code    string `json:"code"`
			Caption *struct {
				Text string `json:"text"`
			} `json:"caption"`
			PinnedUserIDs []any `json:"timeline_pinned_user_ids"`
		} `json:"items"`
	}
	if len(body) == 0 || json.Unmarshal(body, &feed) != nil {
		return nil
	}
	var out []ProfilePost
	for _, it := range feed.Items {
		if len(out) >= profilePostCap {
			break
		}
		if it.TakenAt <= 0 {
			continue
		}
		caption := ""
		if it.Caption != nil {
			caption = strings.TrimSpace(it.Caption.Text)
		}
		out = append(out, ProfilePost{
			Timestamp: it.TakenAt,
			Caption:   caption,
			Shortcode: it.Code,
			IsPinned:  len(it.PinnedUserIDs) > 0,
		})
	}
	return out
}
