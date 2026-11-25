package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"maunium.net/go/mautrix/bridgev2"
)

func TestBridgeApproveStep(t *testing.T) {
	approve := func(stepID string, params *bridgev2.LoginDisplayAndWaitParams) *bridgev2.LoginStep {
		return &bridgev2.LoginStep{Type: bridgev2.LoginStepTypeDisplayAndWait, StepID: stepID,
			Instructions: "Approve this login in the Instagram app.", DisplayAndWaitParams: params}
	}
	for _, tc := range []struct {
		name     string
		step     *bridgev2.LoginStep
		wantCode string
		wantBack bool
		wantErr  error
	}{
		{"no code", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeNothing}), "", false, nil},
		{"number to tap", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeCode, Data: "42"}), "42", false, nil},
		{"another method offered", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeNothing, CanCancel: true}), "", true, nil},
		{"odd code", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeCode, Data: "<b>42</b>"}), "", false, errUnsupportedStep},
		{"empty code", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeCode}), "", false, errUnsupportedStep},
		{"data without code type", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeNothing, Data: "42"}), "", false, errUnsupportedStep},
		{"image", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeNothing, ImageURL: "https://example.com/x.png"}), "", false, errUnsupportedStep},
		{"qr", approve(stepApprove, &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeQR, Data: "x"}), "", false, errUnsupportedStep},
		{"no params", approve(stepApprove, nil), "", false, errUnsupportedStep},
		{"code on another wait step", approve("fi.mau.meta.instagram.other", &bridgev2.LoginDisplayAndWaitParams{Type: bridgev2.LoginDisplayTypeCode, Data: "42"}), "", false, errUnsupportedStep},
	} {
		t.Run(tc.name, func(t *testing.T) {
			step, err := fromBridgeStep(tc.step)
			if err != tc.wantErr {
				t.Fatalf("got error %v, want %v", err, tc.wantErr)
			}
			if err != nil {
				return
			}
			if step.Type != "wait" || step.StepID != stepApprove || step.Code != tc.wantCode || step.Back != tc.wantBack {
				t.Fatalf("unexpected step: %+v", step)
			}
			if step.Instructions == tc.step.Instructions {
				t.Fatalf("instameow's English text leaked: %q", step.Instructions)
			}
		})
	}
}

func TestPollApproval(t *testing.T) {
	undecided := func(ctx context.Context) (*bridgev2.LoginStep, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	t.Run("runs out undecided", func(t *testing.T) {
		start := time.Now()
		_, waiting, err := pollApproval(context.Background(), 20*time.Millisecond, undecided)
		if !waiting || err == nil {
			t.Fatalf("waiting=%v err=%v, want a waiting timeout", waiting, err)
		}
		if time.Since(start) > time.Second {
			t.Fatal("poll wasn't bounded")
		}
	})
	t.Run("caller gave up", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, waiting, err := pollApproval(ctx, time.Minute, undecided); waiting || !errors.Is(err, context.Canceled) {
			t.Fatalf("waiting=%v err=%v, want the caller's cancellation", waiting, err)
		}
	})
	t.Run("approved", func(t *testing.T) {
		want := &bridgev2.LoginStep{StepID: "next"}
		step, waiting, err := pollApproval(context.Background(), time.Minute,
			func(context.Context) (*bridgev2.LoginStep, error) { return want, nil })
		if waiting || err != nil || step != want {
			t.Fatalf("step=%v waiting=%v err=%v", step, waiting, err)
		}
	})
	t.Run("expired", func(t *testing.T) {
		_, waiting, err := pollApproval(context.Background(), time.Minute,
			func(context.Context) (*bridgev2.LoginStep, error) {
				return nil, instameow.ErrInstagramAuthPlatformApprovalExpired
			})
		if waiting {
			t.Fatal("an expired approval isn't still waiting")
		}
		if _, err = (&loginProc{}).handleAuthPlatform(context.Background(), nil, err); err != errApprovalExpired {
			t.Fatalf("got %v, want errApprovalExpired", err)
		}
	})
}

func TestStillWaitingKeepsStep(t *testing.T) {
	pending := &Step{Type: "wait", StepID: stepApprove, Code: "42", Back: true, Instructions: "x"}
	again := stillWaiting(pending)
	if again == pending || again.Code != "42" || !again.Back || again.StepID != stepApprove || again.Instructions == "x" || pending.Instructions != "x" {
		t.Fatalf("unexpected: %+v (pending %+v)", again, pending)
	}
}
