package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"go.mau.fi/mautrix-meta/pkg/instameow/slidetypes"
	"go.mau.fi/mautrix-meta/pkg/messagix/graphql"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
	"golang.org/x/net/html"
)

const (
	maxProfilePageBytes  = 4 << 20
	profileLookupTimeout = 12 * time.Second
)

func lookupProfile(ctx context.Context, cli *instameow.Client, username string) (*ProfileResult, error) {
	// Leave time for the public page if the signed-in endpoint stalls or retries.
	signedCtx, cancelSigned := context.WithTimeout(ctx, profileLookupTimeout)
	p, signedErr := fetchSignedInProfile(signedCtx, cli, username)
	cancelSigned()
	if signedErr == nil || errors.Is(signedErr, errProfileRateLimited) {
		return p, signedErr
	}
	if _, permanent := classify(signedErr); permanent {
		return nil, signedErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	publicCtx, cancelPublic := context.WithTimeout(ctx, profileLookupTimeout)
	defer cancelPublic()
	p, publicErr := fetchPublicProfile(publicCtx, cli, username)
	// Only a successful search with no exact match can corroborate a public page's 404.
	if errors.Is(publicErr, errUserNotFound) && !errors.Is(signedErr, errUserNotFound) {
		return nil, signedErr
	}
	return p, publicErr
}

type profileSearchResponse struct {
	Data struct {
		Results []struct {
			Username string `json:"username"`
			IGID     string `json:"pk"`
		} `json:"search_messenger_contact_v2"`
	} `json:"xfb_combinedIGSearchQuery"`
}

func fetchSignedInProfile(ctx context.Context, cli *instameow.Client, username string) (*ProfileResult, error) {
	search, err := profileQuery[profileSearchResponse](ctx, cli, "IGDOmniPickerSearchResultsListQuery",
		slidetypes.SearchRequest{SearchText: username})
	if err != nil {
		return nil, err
	}
	if search.Data.Results == nil {
		return nil, errProfileUnavailable
	}
	var igid string
	found := false
	for _, result := range search.Data.Results {
		if strings.EqualFold(result.Username, username) {
			found = true
			if digitsRe.MatchString(result.IGID) {
				igid = result.IGID
				break
			}
		}
	}
	if !found {
		return nil, errUserNotFound
	}
	if igid == "" {
		return nil, errProfileUnavailable
	}

	// Decode the full user object. Instameow's User type drops additional fields such as
	// biography and bio_links when decoded by encoding/json.
	type profileResponse struct {
		User map[string]any `json:"user"`
	}
	details, err := profileQuery[profileResponse](ctx, cli, "PolarisProfilePageContentQuery", slidetypes.MakeProfilePageRequest(igid))
	if err != nil {
		return nil, err
	}
	name, _ := details.User["username"].(string)
	pk, _ := details.User["pk"].(string)
	if !strings.EqualFold(name, username) || (pk != "" && pk != igid) {
		return nil, errProfileUnavailable
	}
	return parseProfileUser(igid, details.User), nil
}

func profileQuery[T any](ctx context.Context, cli *instameow.Client, name string, params any) (T, error) {
	_, body, err := cli.GetHTTP().MakeGraphQLRequest(ctx, name, params)
	var reply struct {
		graphql.Response[T]
		Message string `json:"message"`
		Spam    bool   `json:"spam"`
	}
	decodeErr := json.Unmarshal(body, &reply)
	if errors.Is(err, httpclient.ErrRateLimited) || reply.Spam || reply.Message == "feedback_required" {
		return reply.Data, errProfileRateLimited
	}
	switch reply.Message {
	case "login_required":
		return reply.Data, httpclient.ErrTokenInvalidated
	case "challenge_required":
		return reply.Data, httpclient.ErrChallengeRequired
	case "checkpoint_required":
		return reply.Data, httpclient.ErrCheckpointRequired
	}
	if err != nil {
		return reply.Data, fmt.Errorf("%w: %w", errProfileUnavailable, err)
	}
	if decodeErr != nil {
		return reply.Data, errProfileUnavailable
	}
	if err := reply.AsError(); err != nil {
		if errors.Is(err, types.ErrPleaseLogIn) {
			return reply.Data, httpclient.ErrTokenInvalidated
		}
		return reply.Data, fmt.Errorf("%w: %w", errProfileUnavailable, err)
	}
	return reply.Data, nil
}

func fetchPublicProfile(ctx context.Context, cli *instameow.Client, username string) (*ProfileResult, error) {
	endpoint := cli.GetEndpoint("base_url") + "/" + url.PathEscape(username) + "/"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	upstream := cli.GetHTTP()
	req.Header = upstream.BuildHeaders(false, true)
	// Read the public document without changing the connected account's cookies or following
	// redirects to a login page or a different account.
	client := *upstream.GetHTTPClient()
	client.Jar = nil
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errProfileUnavailable, err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusNotFound, http.StatusGone:
		return nil, errUserNotFound
	case http.StatusTooManyRequests:
		return nil, errProfileRateLimited
	case http.StatusOK:
	default:
		return nil, fmt.Errorf("%w (HTTP %d)", errProfileUnavailable, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxProfilePageBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errProfileUnavailable, err)
	}
	if len(body) > maxProfilePageBytes {
		return nil, errProfileUnavailable
	}
	if p := parseProfilePage(body, username); p != nil {
		return p, nil
	}
	return nil, errProfileUnavailable
}

func parseProfilePage(body []byte, username string) *ProfileResult {
	page := html.NewTokenizer(bytes.NewReader(body))
	for {
		switch page.Next() {
		case html.ErrorToken:
			return nil
		case html.StartTagToken:
			tag, _ := page.TagName()
			if string(tag) != "script" || page.Next() != html.TextToken {
				continue
			}
			data := page.Text()
			if !bytes.Contains(data, []byte(`"xig_user_by_username"`)) {
				continue
			}
			var payload any
			if json.Unmarshal(data, &payload) == nil {
				if p := embeddedProfile(payload, username); p != nil {
					return p
				}
			}
		}
	}
}

func embeddedProfile(payload any, username string) *ProfileResult {
	switch node := payload.(type) {
	case map[string]any:
		if user, ok := node["xig_user_by_username"].(map[string]any); ok {
			name, _ := user["username"].(string)
			pk, _ := user["pk"].(string)
			if strings.EqualFold(name, username) && digitsRe.MatchString(pk) {
				return parseProfileUser(pk, user)
			}
		}
		for _, child := range node {
			if p := embeddedProfile(child, username); p != nil {
				return p
			}
		}
	case []any:
		for _, child := range node {
			if p := embeddedProfile(child, username); p != nil {
				return p
			}
		}
	}
	return nil
}
