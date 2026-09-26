package main

import (
	"reflect"
	"testing"
)

func TestParseCookieInput(t *testing.T) {
	want := map[string]string{"sessionid": "S%3Aabc", "csrftoken": "tok", "ds_user_id": "42", "mid": "M1"}
	cases := map[string]string{
		"json object": `{"sessionid":"S%3Aabc","csrftoken":"tok","ds_user_id":"42","mid":"M1","junk":"x"}`,
		"export array": `[{"name":"sessionid","value":"S%3Aabc","domain":".instagram.com"},{"name":"csrftoken","value":"tok"},
			{"name":"ds_user_id","value":"42"},{"name":"mid","value":"M1"}]`,
		"curl bash": "curl 'https://www.instagram.com/api/graphql' \\\n  -H 'accept: */*' \\\n" +
			"  -H 'cookie: mid=M1; csrftoken=tok; ds_user_id=42; sessionid=S%3Aabc; other=1' \\\n  --data-raw 'x=1'",
		"curl -b":    `curl 'https://www.instagram.com/' -b 'sessionid=S%3Aabc; csrftoken=tok; ds_user_id=42; mid=M1'`,
		"curl cmd":   "curl \"https://www.instagram.com/\" ^\n  -H \"cookie: sessionid=S^%3Aabc; csrftoken=tok; ds_user_id=42; mid=M1\"",
		"raw header": `Cookie: sessionid=S%3Aabc; csrftoken=tok; ds_user_id=42; mid=M1`,
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := parseCookieInput(in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %v, want %v", got, want)
			}
		})
	}
}

func TestParseCookieInputMissing(t *testing.T) {
	if _, err := parseCookieInput(`{"sessionid":"a"}`); err == nil {
		t.Fatal("expected missing-cookie error")
	}
	if _, err := parseCookieInput(`curl 'https://x' -H 'accept: */*'`); err == nil {
		t.Fatal("expected no-cookie-header error")
	}
	if _, err := parseCookieInput("   "); err == nil {
		t.Fatal("expected empty-input error")
	}
}

func TestNormalizeUsername(t *testing.T) {
	ok := map[string]string{
		"@Doceria.Aurora":                         "doceria.aurora",
		"https://www.instagram.com/brasa_burger/": "brasa_burger",
		"instagram.com/forn?igsh=1":               "forn",
		" plain ":                                 "plain",
	}
	for in, want := range ok {
		got, err := normalizeUsername(in)
		if err != nil || got != want {
			t.Errorf("normalizeUsername(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "@", "has space", "ümlaut", "way.too.long.username.for.instagram.x"} {
		if _, err := normalizeUsername(bad); err == nil {
			t.Errorf("normalizeUsername(%q) should fail", bad)
		}
	}
}

func TestSign(t *testing.T) {
	// fixed vector — Core's verifier (packages/core) must produce the same hex
	got := sign("secret", 1700000000, []byte(`{"type":"state"}`))
	if got != "2ed197af43a338c079a4fcfabaceeebaea12b645a8f18a6543e2765a7a729b86" {
		t.Fatalf("unexpected signature %q", got)
	}
}
