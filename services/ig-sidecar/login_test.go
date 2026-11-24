package main

import (
	"encoding/json"
	"testing"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"maunium.net/go/mautrix/bridgev2"
)

func TestBridgeCaptchaStep(t *testing.T) {
	const instance = "537fc7aa-1977-4a25-9720-acc5ad47a636"
	for _, tc := range []struct {
		name    string
		frame   string
		wantErr error
	}{
		{"provider iframe", "https://www.fbsbx.com/captcha/recaptcha/iframe/?locale=en_US", nil},
		{"other origin", "https://example.com/captcha/recaptcha/iframe/", errCheckpointUnsupported},
		{"other path", "https://www.fbsbx.com/", errCheckpointUnsupported},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := Captcha{IframeURL: tc.frame, Instance: instance}
			data, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			step, err := fromBridgeStep(&bridgev2.LoginStep{
				Type:   bridgev2.LoginStepTypeCookies,
				StepID: instameow.InstagramWebCaptchaStepID,
				CookiesParams: &bridgev2.LoginCookiesParams{
					URL:       "https://www.instagram.com/accounts/login/",
					ExtractJS: "(config => Promise.resolve(config)\n)(" + string(data) + ")",
					Fields: []bridgev2.LoginCookieField{{
						ID: "captcha_token", Required: true,
						Sources: []bridgev2.LoginCookieFieldSource{{Type: bridgev2.LoginCookieTypeSpecial, Name: "captcha_token"}},
					}},
				},
			})
			if err != tc.wantErr {
				t.Fatalf("got error %v, want %v", err, tc.wantErr)
			}
			if err == nil && (step.Type != "captcha" || step.Captcha == nil || *step.Captcha != config) {
				t.Fatalf("unexpected CAPTCHA step: %+v", step)
			}
		})
	}
}
