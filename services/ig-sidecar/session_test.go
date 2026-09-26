package main

import (
	"context"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/util/jsontime"

	"go.mau.fi/mautrix-meta/pkg/instameow/slidetypes"
)

func testManager() (*Manager, *eventSink) {
	sink := newEventSink("http://core.invalid/events", "s", zerolog.Nop())
	m := newManager(config{Secret: "s"}, zerolog.Nop(), sink)
	m.gen = 1
	m.ownFBID = 100
	m.groups = map[string]bool{"dm": false, "grp": true}
	return m, sink
}

func msg(sender int64, text string) *slidetypes.Message {
	return &slidetypes.Message{
		ID:          "mid.1",
		SenderFBID:  sender,
		TextBody:    text,
		TimestampMS: jsontime.UnixMilliString{Time: time.UnixMilli(1_700_000_000_000)},
		Sender: &slidetypes.MessageSender{
			Name: "Doceria", IGID: "555",
			UserDict: slidetypes.User{Username: "doceria.aurora", FullName: "Doceria Aurora"},
		},
	}
}

func drain(s *eventSink) []Event {
	var out []Event
	for {
		select {
		case e := <-s.queue:
			out = append(out, e)
		default:
			return out
		}
	}
}

func TestForwardRelaysDirectText(t *testing.T) {
	m, sink := testManager()
	m.forward(context.Background(), 1, nil, "dm", msg(200, "  oi, quero saber mais  "))
	evts := drain(sink)
	if len(evts) != 1 || evts[0].Type != "message" {
		t.Fatalf("want one message event, got %+v", evts)
	}
	in := evts[0].Message
	if in.Text != "oi, quero saber mais" || in.FromFBID != "200" || in.Username != "doceria.aurora" ||
		in.Name != "Doceria Aurora" || in.IGID != "555" || in.ThreadID != "dm" || in.SentAtMS != 1_700_000_000_000 {
		t.Fatalf("unexpected payload %+v", in)
	}
	if m.lastInboundMS != 1_700_000_000_000 {
		t.Fatalf("catch-up floor not advanced: %d", m.lastInboundMS)
	}
}

func TestForwardSkips(t *testing.T) {
	cases := map[string]struct {
		gen    uint64
		thread string
		m      *slidetypes.Message
	}{
		"own echo":      {1, "dm", msg(100, "enviado por nós")},
		"group":         {1, "grp", msg(200, "oi grupo")},
		"media only":    {1, "dm", msg(200, "   ")},
		"stale gen":     {0, "dm", msg(200, "oi")},
		"no sender":     {1, "dm", msg(0, "oi")},
		"no message id": {1, "dm", func() *slidetypes.Message { x := msg(200, "oi"); x.ID = ""; return x }()},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			m, sink := testManager()
			m.forward(context.Background(), c.gen, nil, c.thread, c.m)
			if evts := drain(sink); len(evts) != 0 {
				t.Fatalf("expected nothing forwarded, got %+v", evts)
			}
		})
	}
}

func TestStateEventsDedupe(t *testing.T) {
	m, sink := testManager()
	m.setState(1, stateOpen, nil)
	m.setState(1, stateOpen, nil)
	m.setState(2, stateError, &errInfo{"x", "y"}) // stale gen — ignored
	evts := drain(sink)
	if len(evts) != 1 || evts[0].State != stateOpen {
		t.Fatalf("want a single open event, got %+v", evts)
	}
}
