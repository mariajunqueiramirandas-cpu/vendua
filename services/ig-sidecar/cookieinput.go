package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
)

const maxCookieInput = 64 << 10

// parseCookieInput accepts what staff can copy from a logged-in browser: a JSON
// object, a cookie-export array, a devtools "Copy as cURL" command, or a raw
// Cookie header. Only Instagram's known cookie names are kept.
func parseCookieInput(raw string) (map[string]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("cole os cookies ou o comando cURL")
	}
	if len(raw) > maxCookieInput {
		return nil, errors.New("entrada grande demais")
	}
	all := map[string]string{}
	switch {
	case strings.HasPrefix(raw, "{"):
		if err := json.Unmarshal([]byte(raw), &all); err != nil {
			return nil, errors.New("JSON inválido — esperado {\"sessionid\": \"…\", …}")
		}
	case strings.HasPrefix(raw, "["):
		var list []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}
		if err := json.Unmarshal([]byte(raw), &list); err != nil {
			return nil, errors.New("JSON inválido — esperado [{\"name\": …, \"value\": …}]")
		}
		for _, c := range list {
			all[c.Name] = c.Value
		}
	case strings.HasPrefix(strings.ToLower(raw), "curl"):
		header, ok := cookieFromCurl(raw)
		if !ok {
			return nil, errors.New("o comando cURL não tem cabeçalho de cookie")
		}
		parseCookieHeader(header, all)
	default:
		parseCookieHeader(strings.TrimPrefix(strings.TrimPrefix(raw, "Cookie:"), "cookie:"), all)
	}

	out := map[string]string{}
	for _, name := range append(append([]cookies.MetaCookieName{}, cookies.IGRequiredCookies...), cookies.IGOptionalCookies...) {
		if v := strings.TrimSpace(all[string(name)]); v != "" {
			out[string(name)] = v
		}
	}
	var missing []string
	for _, name := range cookies.IGRequiredCookies {
		if out[string(name)] == "" {
			missing = append(missing, string(name))
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("faltam cookies obrigatórios: %s", strings.Join(missing, ", "))
	}
	return out, nil
}

func parseCookieHeader(header string, into map[string]string) {
	for _, part := range strings.Split(header, ";") {
		name, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && name != "" {
			into[strings.TrimSpace(name)] = strings.TrimSpace(value)
		}
	}
}

// cookieFromCurl pulls the cookie header out of `-H 'cookie: …'` or `-b '…'`
// (Chrome and Firefox, bash or cmd quoting).
func cookieFromCurl(cmd string) (string, bool) {
	args := shellSplit(cmd)
	for i := 0; i < len(args)-1; i++ {
		switch args[i] {
		case "-H", "--header":
			name, value, ok := strings.Cut(args[i+1], ":")
			if ok && strings.EqualFold(strings.TrimSpace(name), "cookie") {
				return strings.TrimSpace(value), true
			}
		case "-b", "--cookie":
			return args[i+1], true
		}
	}
	return "", false
}

// shellSplit is a small POSIX-ish splitter: single quotes literal, double quotes
// with backslash escapes, `\`+newline continuations and Windows `^` continuations dropped.
func shellSplit(s string) []string {
	var args []string
	var cur strings.Builder
	inArg := false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case ch == '\'':
			inArg = true
			j := strings.IndexByte(s[i+1:], '\'')
			if j < 0 {
				cur.WriteString(s[i+1:])
				i = len(s)
			} else {
				cur.WriteString(s[i+1 : i+1+j])
				i += j + 1
			}
		case ch == '"':
			inArg = true
			for i++; i < len(s) && s[i] != '"'; i++ {
				if s[i] == '\\' && i+1 < len(s) {
					i++
				} else if s[i] == '^' && i+1 < len(s) {
					// cmd.exe escape inside Chrome's "Copy as cURL (cmd)"
					i++
				}
				cur.WriteByte(s[i])
			}
		case ch == '\\' && i+1 < len(s) && (s[i+1] == '\n' || s[i+1] == '\r'):
			i++
		case ch == '^' && i+1 < len(s) && (s[i+1] == '\n' || s[i+1] == '\r'):
			i++
		case ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r':
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			inArg = true
			cur.WriteByte(ch)
		}
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args
}
