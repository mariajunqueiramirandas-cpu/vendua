package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/rs/zerolog"

	"go.mau.fi/mautrix-meta/pkg/messagix/types"
)

const (
	maxBody = 128 << 10
	// Instagram rejects longer DMs
	maxTextRunes = 1000
)

type api struct {
	cfg config
	mgr *Manager
	log zerolog.Logger
}

func newAPI(cfg config, mgr *Manager, log zerolog.Logger) *api {
	return &api{cfg: cfg, mgr: mgr, log: log.With().Str("mod", "api").Logger()}
}

func (a *api) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /v1/status", a.auth(a.status))
	mux.HandleFunc("PUT /v1/session", a.auth(a.putSession))
	mux.HandleFunc("DELETE /v1/session", a.auth(a.deleteSession))
	mux.HandleFunc("POST /v1/login/start", a.auth(a.loginStart))
	mux.HandleFunc("POST /v1/login/submit", a.auth(a.loginSubmit))
	mux.HandleFunc("POST /v1/login/cookies", a.auth(a.loginCookies))
	mux.HandleFunc("POST /v1/login/cancel", a.auth(a.loginCancel))
	mux.HandleFunc("POST /v1/resolve", a.auth(a.resolve))
	mux.HandleFunc("POST /v1/send", a.auth(a.send))
	return mux
}

func (a *api) auth(next http.HandlerFunc) http.HandlerFunc {
	want := []byte("Bearer " + a.cfg.Secret)
	return func(w http.ResponseWriter, r *http.Request) {
		if a.cfg.Secret == "" {
			writeErr(w, http.StatusServiceUnavailable, "no_secret", "IG_SIDECAR_SECRET ausente no sidecar")
			return
		}
		got := []byte(r.Header.Get("authorization"))
		if subtle.ConstantTimeCompare(got, want) != 1 {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]errInfo{"error": {Code: code, Message: msg}})
}

func (a *api) fail(w http.ResponseWriter, err error) {
	var le *LoginError
	switch {
	case errors.As(err, &le):
		writeErr(w, le.Status, le.Code, le.Message)
	case errors.Is(err, errNotConnected):
		writeErr(w, http.StatusConflict, "not_connected", err.Error())
	case errors.Is(err, errUserNotFound):
		writeErr(w, http.StatusNotFound, "user_not_found", err.Error())
	case errors.Is(err, errBadUsername):
		writeErr(w, http.StatusUnprocessableEntity, "bad_username", err.Error())
	case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
		writeErr(w, http.StatusGatewayTimeout, "timeout", "tempo esgotado")
	default:
		a.log.Warn().Err(err).Msg("request failed")
		writeErr(w, http.StatusBadGateway, "upstream_error", err.Error())
	}
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(r.Body).Decode(into); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return false
	}
	return true
}

func (a *api) status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.mgr.Status())
}

func (a *api) putSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Session Session `json:"session"`
		SinceMS int64   `json:"sinceMs"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := a.mgr.Start(body.Session, body.SinceMS); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, "bad_session", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.mgr.Status())
}

func (a *api) deleteSession(w http.ResponseWriter, _ *http.Request) {
	a.mgr.LoginCancel()
	a.mgr.Stop()
	writeJSON(w, http.StatusOK, a.mgr.Status())
}

func (a *api) loginStart(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device *types.InstagramLoginDevice `json:"device"`
	}
	if !decode(w, r, &body) {
		return
	}
	step, err := a.mgr.LoginStart(body.Device)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, step)
}

func (a *api) loginSubmit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input map[string]string `json:"input"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Input == nil {
		body.Input = map[string]string{}
	}
	step, err := a.mgr.LoginSubmit(r.Context(), body.Input)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, step)
}

func (a *api) loginCookies(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cookies string                      `json:"cookies"`
		Device  *types.InstagramLoginDevice `json:"device"`
	}
	if !decode(w, r, &body) {
		return
	}
	step, err := a.mgr.LoginCookies(r.Context(), body.Cookies, body.Device)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, step)
}

func (a *api) loginCancel(w http.ResponseWriter, _ *http.Request) {
	a.mgr.LoginCancel()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *api) resolve(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
	}
	if !decode(w, r, &body) {
		return
	}
	res, err := a.mgr.Resolve(r.Context(), body.Username)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *api) send(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FBID     string `json:"fbid"`
		Username string `json:"username"`
		Text     string `json:"text"`
	}
	if !decode(w, r, &body) {
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" {
		writeErr(w, http.StatusUnprocessableEntity, "empty_text", "texto vazio")
		return
	}
	if utf8.RuneCountInString(text) > maxTextRunes {
		writeErr(w, http.StatusUnprocessableEntity, "text_too_long", "o Instagram aceita até 1000 caracteres por mensagem")
		return
	}
	if body.FBID == "" && body.Username == "" {
		writeErr(w, http.StatusUnprocessableEntity, "no_recipient", "fbid ou username obrigatório")
		return
	}
	res, err := a.mgr.Send(r.Context(), body.FBID, body.Username, text)
	if err != nil {
		a.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}
