package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
)

// A cold DM (no thread yet) names its recipient by Instagram user ID. The messaging FBID that
// names threads made Instagram answer "Query Error - Error performing query" on every first
// contact.
func TestColdDMRecipientIsTheInstagramUserID(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   int
		body     string
		searched string
		want     string
		notFound bool
	}{
		{name: "lookup by messaging ID", status: 200, body: `{"data":{"xig_user_from_messaging_user_fbid":{"username":"doceria_teste","id":"12345","pk":"12345"}}}`, want: "12345"},
		{name: "pk when id is not numeric", status: 200, body: `{"data":{"xig_user_from_messaging_user_fbid":{"username":"doceria_teste","id":"x","pk":"12345"}}}`, want: "12345"},
		{name: "search ID when the lookup answers nothing", status: 200, body: `{"data":{"xig_user_from_messaging_user_fbid":null}}`, searched: "777", want: "777"},
		{name: "search ID when the lookup fails", status: 200, body: `{"errors":[{"message":"Query Error","summary":"Error performing query."}],"data":null}`, searched: "777", want: "777"},
		{name: "no ID anywhere", status: 200, body: `{"data":{"xig_user_from_messaging_user_fbid":null}}`, notFound: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := testManager()
			jar := &cookies.Cookies{}
			jar.UpdateValues(map[cookies.MetaCookieName]string{cookies.IGCookieSessionID: "test-session"})
			cli, err := m.newClient(jar, nil, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			cli.GetHTTP().SetTransportOverride(profileTestTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Header.Get("x-fb-friendly-name") != "useIGDCreateOptimisticThreadUserQuery" {
					t.Fatalf("unexpected request: %s %s", req.Method, req.URL.Path)
				}
				if !strings.Contains(req.FormValue("variables"), `"messaging_user_fbid":"456"`) {
					t.Fatalf("lookup used the wrong messaging ID: %s", req.FormValue("variables"))
				}
				return &http.Response{StatusCode: tc.status, Request: req, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			}))
			got, err := recipientIGID(context.Background(), cli, 456, tc.searched)
			if calls == 0 {
				t.Fatal("the recipient was never looked up")
			}
			if tc.notFound {
				if !errors.Is(err, errUserNotFound) {
					t.Fatalf("want user not found, got %q %v", got, err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %q %v, want %q", got, err, tc.want)
			}
		})
	}
}
