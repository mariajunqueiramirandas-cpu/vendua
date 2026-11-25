package main

import (
	"cmp"
	"context"
	"time"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"go.mau.fi/mautrix-meta/pkg/instameow/slidetypes"
)

type readRequest struct {
	threadID string
	receipt  slidetypes.ReadReceipt
}

func otherParticipant(r slidetypes.ReadReceipt, own int64) bool {
	return own > 0 && r.ParticipantFBID > 0 && r.ParticipantFBID != own && r.WatermarkTimestampMS.UnixMilli() > 0
}

func (m *Manager) queueReadReceipt(gen uint64, reads chan<- readRequest, threadID string, receipt slidetypes.ReadReceipt) {
	m.mu.Lock()
	valid := gen == m.gen && !m.groups[threadID] && otherParticipant(receipt, m.ownFBID)
	m.mu.Unlock()
	if !valid || threadID == "" {
		return
	}
	select {
	case reads <- readRequest{threadID, receipt}:
	default:
		m.log.Warn().Msg("read receipt queue full")
	}
}

// The delta carries a timestamp watermark. Fetch the thread to match Instagram's
// own message timestamps to ids without relying on the CRM's compose times.
func (m *Manager) runReadReceipts(ctx context.Context, gen uint64, cli *instameow.Client, reads <-chan readRequest) {
	for ctx.Err() == nil {
		select {
		case <-ctx.Done():
			return
		case req := <-reads:
			requestCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			resp, err := cli.GetThread(requestCtx, slidetypes.MakeGetThreadInfoRequest(req.threadID))
			cancel()
			if err != nil || resp == nil || resp.ThreadInfo.AsIGDirectThread == nil {
				m.log.Debug().Err(err).Msg("read receipt thread lookup failed")
				continue
			}
			thread := resp.ThreadInfo.AsIGDirectThread
			m.mu.Lock()
			if gen == m.gen {
				m.groups[req.threadID] = thread.IsGroup
			}
			own := m.ownFBID
			m.mu.Unlock()
			m.forwardSeen(gen, thread, own, &req.receipt)
		}
	}
}

func (m *Manager) forwardSeen(gen uint64, thread *slidetypes.ThreadInfo, own int64, receipt *slidetypes.ReadReceipt) {
	ids := seenMessageIDs(thread, own, receipt)
	m.mu.Lock()
	defer m.mu.Unlock()
	if gen == m.gen && m.client != nil && len(ids) != 0 {
		m.sink.emit(Event{Type: "seen", MessageIDs: ids})
	}
}

func seenMessageIDs(thread *slidetypes.ThreadInfo, own int64, receipt *slidetypes.ReadReceipt) []string {
	if thread.IsGroup || thread.SlideMessages == nil || own <= 0 {
		return nil
	}
	var watermark int64
	if receipt != nil && otherParticipant(*receipt, own) {
		watermark = receipt.WatermarkTimestampMS.UnixMilli()
	}
	for _, r := range thread.SlideReadReceipts {
		if otherParticipant(r, own) {
			watermark = max(watermark, r.WatermarkTimestampMS.UnixMilli())
		}
	}
	if watermark <= 0 {
		return nil
	}
	var ids []string
	for _, edge := range thread.SlideMessages.Edges {
		msg := edge.Node
		if msg == nil || msg.SenderFBID != own {
			continue
		}
		sentAt := msg.TimestampMS.UnixMilli()
		id := cmp.Or(msg.ID, msg.MessageID)
		if sentAt > 0 && sentAt <= watermark && id != "" && len(id) <= 200 {
			ids = append(ids, id)
			if len(ids) == 50 {
				break
			}
		}
	}
	return ids
}
