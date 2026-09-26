package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog"
)

// Event is what Core receives on CORE_EVENTS_URL.
type Event struct {
	Type string `json:"type"` // message | state | session

	// message
	Message *InboundMessage `json:"message,omitempty"`

	// state
	State   string   `json:"state,omitempty"`
	Error   *errInfo `json:"error,omitempty"`
	Account *Account `json:"account,omitempty"`

	// session
	Session *Session `json:"session,omitempty"`
}

type InboundMessage struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
	FromFBID string `json:"fromFbid"`
	Username string `json:"username,omitempty"`
	Name     string `json:"name,omitempty"`
	IGID     string `json:"igid,omitempty"`
	Text     string `json:"text"`
	SentAtMS int64  `json:"sentAtMs"`
}

type errInfo struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// sign is the Core-side contract: hex(HMAC-SHA256(secret, "<unix ts>.<body>")).
func sign(secret string, ts int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(ts, 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// eventSink delivers in order on one worker so a session update can't overtake
// the state change it belongs to; each event retries with backoff, then drops.
type eventSink struct {
	url    string
	secret string
	log    zerolog.Logger
	queue  chan Event
	http   *http.Client
}

const maxEventAttempts = 8

func newEventSink(url, secret string, log zerolog.Logger) *eventSink {
	return &eventSink{
		url:    url,
		secret: secret,
		log:    log.With().Str("mod", "events").Logger(),
		queue:  make(chan Event, 1000),
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *eventSink) emit(evt Event) {
	if s.url == "" {
		s.log.Info().Str("type", evt.Type).Msg("event (no CORE_EVENTS_URL)")
		return
	}
	select {
	case s.queue <- evt:
	default:
		s.log.Error().Str("type", evt.Type).Msg("event queue full — dropped")
	}
}

func (s *eventSink) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case evt := <-s.queue:
			s.deliver(ctx, evt)
		}
	}
}

func (s *eventSink) deliver(ctx context.Context, evt Event) {
	body, err := json.Marshal(evt)
	if err != nil {
		s.log.Err(err).Msg("marshal event")
		return
	}
	backoff := time.Second
	for attempt := 1; attempt <= maxEventAttempts; attempt++ {
		err = s.post(ctx, body)
		if err == nil {
			return
		}
		s.log.Warn().Err(err).Str("type", evt.Type).Int("attempt", attempt).Msg("event delivery failed")
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, time.Minute)
	}
	s.log.Error().Str("type", evt.Type).Msg("event dropped after retries")
}

func (s *eventSink) post(ctx context.Context, body []byte) error {
	ts := time.Now().Unix()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-ig-timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("x-ig-signature", sign(s.secret, ts, body))
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	// 4xx other than 429 won't improve on retry
	if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
		s.log.Error().Int("status", resp.StatusCode).Msg("core rejected event")
		return nil
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("core responded %d", resp.StatusCode)
	}
	return nil
}
