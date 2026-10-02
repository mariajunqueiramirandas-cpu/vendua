// Package update checks GitHub Releases for a newer agent.
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	releases       = "https://github.com/mariajunqueiramirandas-cpu/vendua/releases/latest/download/"
	VersionURL     = releases + "version.json"
	DownloadURL    = releases + "vendua-impressora.exe"
	CheckInterval  = 6 * time.Hour
	requestTimeout = 30 * time.Second
)

// Latest fetches the published version from url (VersionURL in production).
func Latest(ctx context.Context, client *http.Client, url string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("update: %s: HTTP %d", url, resp.StatusCode)
	}
	var v struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&v); err != nil {
		return "", fmt.Errorf("update: %w", err)
	}
	if _, ok := parse(v.Version); !ok {
		return "", fmt.Errorf("update: invalid version %q", v.Version)
	}
	return v.Version, nil
}

// Newer reports whether candidate is a higher semver than current.
// An unparsable current (a dev build) is older than any release.
func Newer(candidate, current string) bool {
	c, ok := parse(candidate)
	if !ok {
		return false
	}
	cur, ok := parse(current)
	if !ok {
		return true
	}
	return compare(c, cur) > 0
}

type semver struct {
	core [3]uint64
	pre  []string
}

func parse(s string) (semver, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	s, _, _ = strings.Cut(s, "+")
	s, pre, hasPre := strings.Cut(s, "-")
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return semver{}, false
	}
	var v semver
	for i, p := range parts {
		n, err := strconv.ParseUint(p, 10, 64)
		if err != nil || (len(p) > 1 && p[0] == '0') {
			return semver{}, false
		}
		v.core[i] = n
	}
	if hasPre {
		v.pre = strings.Split(pre, ".")
		for _, id := range v.pre {
			if id == "" {
				return semver{}, false
			}
		}
	}
	return v, true
}

func compare(a, b semver) int {
	for i := range a.core {
		if a.core[i] != b.core[i] {
			if a.core[i] > b.core[i] {
				return 1
			}
			return -1
		}
	}
	switch {
	case len(a.pre) == 0 && len(b.pre) == 0:
		return 0
	case len(a.pre) == 0:
		return 1
	case len(b.pre) == 0:
		return -1
	}
	for i := 0; i < len(a.pre) && i < len(b.pre); i++ {
		if c := comparePre(a.pre[i], b.pre[i]); c != 0 {
			return c
		}
	}
	return cmpInt(len(a.pre), len(b.pre))
}

func comparePre(a, b string) int {
	an, aerr := strconv.ParseUint(a, 10, 64)
	bn, berr := strconv.ParseUint(b, 10, 64)
	switch {
	case aerr == nil && berr == nil:
		return cmpInt(an, bn)
	case aerr == nil:
		return -1 // numeric identifiers sort before alphanumeric ones
	case berr == nil:
		return 1
	}
	return strings.Compare(a, b)
}

func cmpInt[T int | uint64](a, b T) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}
