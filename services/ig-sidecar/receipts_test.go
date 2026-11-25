package main

import (
	"encoding/json"
	"slices"
	"testing"

	"go.mau.fi/mautrix-meta/pkg/instameow/slidetypes"
)

func TestSeenMessageIDs(t *testing.T) {
	var thread slidetypes.ThreadInfo
	err := json.Unmarshal([]byte(`{
		"slide_read_receipts": [
			{"participant_fbid":"10", "watermark_timestamp_ms":"1700000005000"},
			{"participant_fbid":"20", "watermark_timestamp_ms":"1700000002000"}
		],
		"slide_messages": {"edges":[
			{"node":{"id":"new", "sender_fbid":"10", "timestamp_ms":"1700000004000"}},
			{"node":{"id":"inbound", "sender_fbid":"20", "timestamp_ms":"1700000002000"}},
			{"node":{"id":"seen", "sender_fbid":"10", "timestamp_ms":"1700000002000"}},
			{"node":{"id":"unknown-time", "sender_fbid":"10"}}
		]}
	}`), &thread)
	if err != nil {
		t.Fatal(err)
	}
	if ids := seenMessageIDs(&thread, 10, nil); !slices.Equal(ids, []string{"seen"}) {
		t.Fatalf("snapshot seen ids = %v", ids)
	}
	var event slidetypes.ReadReceipt
	if err := json.Unmarshal([]byte(`{"participant_fbid":"20","watermark_timestamp_ms":"1700000004000"}`), &event); err != nil {
		t.Fatal(err)
	}
	if ids := seenMessageIDs(&thread, 10, &event); !slices.Equal(ids, []string{"new", "seen"}) {
		t.Fatalf("live event seen ids = %v", ids)
	}
	thread.IsGroup = true
	if ids := seenMessageIDs(&thread, 10, &event); len(ids) != 0 {
		t.Fatalf("group seen ids = %v", ids)
	}
}
