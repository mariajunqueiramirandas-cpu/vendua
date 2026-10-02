package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewer(t *testing.T) {
	cases := []struct {
		cand, cur string
		want      bool
	}{
		{"0.1.1", "0.1.0", true},
		{"0.2.0", "0.1.9", true},
		{"1.0.0", "0.99.99", true},
		{"0.10.0", "0.9.0", true},
		{"0.1.0", "0.1.0", false},
		{"v0.1.0", "0.1.0", false},
		{"0.1.0", "0.2.0", false},
		{"1.0.0", "1.0.0-rc.1", true},
		{"1.0.0-rc.1", "1.0.0", false},
		{"1.0.0-rc.2", "1.0.0-rc.1", true},
		{"1.0.0-rc.10", "1.0.0-rc.9", true},
		{"1.0.0-beta", "1.0.0-alpha.1", true},
		{"1.0.0-alpha.1", "1.0.0-alpha", true},
		{"1.0.0-alpha.beta", "1.0.0-alpha.1", true},
		{"1.0.0+build.2", "1.0.0+build.1", false},
		{"0.1.0", "dev", true},
		{"0.1.0", "0.0.0-dev", true},
		{"garbage", "0.1.0", false},
		{"01.0.0", "0.1.0", false},
		{"1.0", "0.1.0", false},
	}
	for _, c := range cases {
		if got := Newer(c.cand, c.cur); got != c.want {
			t.Errorf("Newer(%q, %q) = %v, want %v", c.cand, c.cur, got, c.want)
		}
	}
}

func TestLatest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			_, _ = w.Write([]byte(`{"version":"0.2.0"}`))
		case "/bad":
			_, _ = w.Write([]byte(`{"version":"latest"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	if v, err := Latest(ctx, srv.Client(), srv.URL+"/ok"); err != nil || v != "0.2.0" {
		t.Fatalf("ok = %q, %v", v, err)
	}
	if _, err := Latest(ctx, srv.Client(), srv.URL+"/bad"); err == nil {
		t.Fatal("accepted an invalid version")
	}
	if _, err := Latest(ctx, srv.Client(), srv.URL+"/missing"); err == nil {
		t.Fatal("accepted a 404")
	}
}
