// ig-sidecar — Instagram DM transport for Venduá Core, built on mautrix-meta's
// instameow client. Licensed AGPL-3.0 (see LICENSE); Core talks to it over HTTP only.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
)

type config struct {
	Addr      string
	Secret    string
	EventsURL string
	// http(s):// or socks5:// — Instagram flags logins from datacenter IPs
	Proxy        string
	MinSendGap   time.Duration
	MinFollowGap time.Duration
}

func loadConfig() (config, error) {
	cfg := config{
		Addr:      envOr("IG_SIDECAR_ADDR", ":8790"),
		Secret:    os.Getenv("IG_SIDECAR_SECRET"),
		EventsURL: os.Getenv("CORE_EVENTS_URL"),
		Proxy:     os.Getenv("IG_PROXY"),
	}
	var err error
	if cfg.MinSendGap, err = envSeconds("IG_MIN_SEND_GAP_SECONDS", 20); err != nil {
		return cfg, err
	}
	// follow bursts are what Instagram's Action Blocked watches for most
	if cfg.MinFollowGap, err = envSeconds("IG_MIN_FOLLOW_GAP_SECONDS", 60); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func envSeconds(key string, def int) (time.Duration, error) {
	n := def
	if v := os.Getenv(key); v != "" {
		var err error
		if n, err = strconv.Atoi(v); err != nil || n < 0 {
			return 0, errors.New(key + " must be a non-negative integer")
		}
	}
	return time.Duration(n) * time.Second, nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	level, err := zerolog.ParseLevel(strings.ToLower(envOr("LOG_LEVEL", "info")))
	if err != nil {
		level = zerolog.InfoLevel
	}
	log := zerolog.New(os.Stdout).Level(level).With().Timestamp().Str("svc", "ig-sidecar").Logger()

	cfg, err := loadConfig()
	if err != nil {
		log.Fatal().Err(err).Msg("bad config")
	}
	if cfg.Secret == "" {
		// idle rather than crash-loop on deploys that don't use instagram yet
		log.Warn().Msg("IG_SIDECAR_SECRET unset — every API call is refused")
	}
	if cfg.EventsURL == "" {
		log.Warn().Msg("CORE_EVENTS_URL unset — inbound messages and session updates are only logged")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	sink := newEventSink(cfg.EventsURL, cfg.Secret, log)
	go sink.run(ctx)
	mgr := newManager(cfg, log, sink)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           newAPI(cfg, mgr, log).routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		mgr.Stop()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Info().Str("addr", cfg.Addr).Msg("listening")
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal().Err(err).Msg("server failed")
	}
}
